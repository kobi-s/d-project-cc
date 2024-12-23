const express = require('express');
const admin = require('firebase-admin');
const app = express();

// Initialize Firebase Admin
const serviceAccount = require('./d-project-firebase-adminsdk.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const instancesCollection = db.collection('instances');

// Middleware to parse JSON bodies
app.use(express.json());

// Connect endpoint
app.post('/connect', async (req, res) => {
  try {
    // Get IP address from request
    const ipAddress = req.ip || req.connection.remoteAddress;
    
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

// {
//     "instanceId": "your-instance-id",
//     "rps": 150,
//     "gps": 75
//   }

// Update endpoint
app.post('/update', async (req, res) => {
  try {
    const { instanceId, rps, gps } = req.body;

    // Validate required fields
    if (!instanceId) {
      return res.status(400).json({
        status: 'error',
        message: 'Instance ID is required'
      });
    }

    // Update instance metrics
    const updateData = {
      lastSeen: new Date().getTime()
    };

    // Only update RPS and GPS if provided
    if (typeof rps === 'number') updateData.rps = rps;
    if (typeof gps === 'number') updateData.gps = gps;

    // Update instance in Firestore
    await instancesCollection.doc(instanceId).update(updateData);

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

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});