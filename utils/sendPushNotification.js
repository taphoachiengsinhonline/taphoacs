const axios = require('axios');

module.exports = async (token, notificationData) => { // ✅ Nhận object data
  try {
    const message = {
      to: token,
      sound: 'default',
      ...notificationData // ✅ Spread toàn bộ data
    };

    const response = await axios.post('https://exp.host/--/api/v2/push/send', message);
    return response.data;
  } catch (error) {
    console.error('Error sending push notification:', error.response?.data || error.message);
    throw error;
  }
};
