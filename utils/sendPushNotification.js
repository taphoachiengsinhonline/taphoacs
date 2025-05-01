// utils/sendPushNotification.js
const axios = require('axios');

const sendPushNotification = async (expoPushToken, title, body) => {
  try {
    await axios.post('https://exp.host/--/api/v2/push/send', {
      to: expoPushToken,
      sound: 'default',
      title,
      body,
    });
  } catch (error) {
    console.error('Lỗi gửi push notification:', error.message);
  }
};

module.exports = sendPushNotification;
