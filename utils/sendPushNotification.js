const axios = require('axios');

module.exports = async (token, title, body) => {
  try {
    const message = {
      to: token,
      title,
      body,
      sound: 'default',
      data: { 
        type: 'test-notification',
        timestamp: new Date().toISOString()
      }
    };
    
    const response = await axios.post('https://exp.host/--/api/v2/push/send', message, {
      headers: {
        'Accept': 'application/json',
        'Accept-encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      }
    });
    
    console.log('Push notification sent:', response.data);
    return response.data;
  } catch (error) {
    console.error('Error sending push notification:', error.response?.data || error.message);
    throw error;
  }
};
