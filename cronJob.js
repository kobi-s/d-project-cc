const cron = require('node-cron');
const axios = require('axios');
const { admin } = require("./db")
// Initialize Firebase Admin (assuming it's not already initialized in your main app)
// const serviceAccount = require('./d-project-firebase-adminsdk.json');
// if (!admin.apps.length) {
//   admin.initializeApp({
//     credential: admin.credential.cert(serviceAccount)
//   });
// }

const db = admin.firestore();
const instancesCollection = db.collection('instances');

// Function to check instance availability
async function checkInstanceAvailability(instanceId, ipAddress) {
  try {
    // Try to ping the instance
    const response = await axios.get(`http://${ipAddress}/health`, {
      timeout: 10000 // 10 second timeout
    });
    
    return response.status === 200;
  } catch (error) {
    console.error(`Error pinging instance ${instanceId}:`, error.message);
    return false;
  }
}

// Main cron job function
async function monitorInstances() {
  try {
    // Get all instances from Firestore
    const snapshot = await instancesCollection
        .where("status", '==', "online")    
        .get();
    
    // Process each instance
    const checks = snapshot.docs.map(async (doc) => {
      const instance = doc.data();
      const instanceId = doc.id;
      
      // Check if instance is responsive
      const isAvailable = await checkInstanceAvailability(instanceId, instance.ipAddress);
      
      // Update instance status if it's not available
      if (!isAvailable && instance.status !== 'offline') {
        await instancesCollection.doc(instanceId).update({
          status: 'offline',
          lastUpdated: new Date().getTime()
        });
        console.log(`Instance ${instanceId} marked as offline`);
      }
    });
    
    // Wait for all checks to complete
    await Promise.all(checks);
    
  } catch (error) {
    console.error('Error in monitor instances cron job:', error);
  }
}

// Schedule cron job to run every 2 minutes
cron.schedule('*/1 * * * *', async () => {
  console.log('Running instance availability check...');
  await monitorInstances();
});

// Export for use in main application
module.exports = {
  monitorInstances
};