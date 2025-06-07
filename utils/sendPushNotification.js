const axios = require('axios');

module.exports = async (token, notificationData) => {
  try {
    // Sửa đổi cấu trúc thông báo theo đúng chuẩn Expo
    const message = {
      to: token,
      sound: 'default',
      title: notificationData.title || 'Thông báo',
      body: notificationData.body || '',
      data: notificationData.data || {}
    };

    const response = await axios.post('https://exp.host/--/api/v2/push/send', [message], {
      headers: {
        'Accept': 'application/json',
        'Accept-encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      }
    });
    
    return response.data;
  } catch (error) {
    console.error('Error sending push notification:', error.response?.data || error.message);
    throw error;
  }
};
