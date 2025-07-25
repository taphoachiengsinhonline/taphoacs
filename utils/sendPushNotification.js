// utils/sendPushNotification.js
const axios = require('axios');

// Đọc Access Token từ biến môi trường
const EXPO_ACCESS_TOKEN = process.env.EXPO_ACCESS_TOKEN;

module.exports = async (token, notificationData) => {
  // Kiểm tra xem token có tồn tại không
  if (!EXPO_ACCESS_TOKEN) {
    console.error('[sendPushNotification] LỖI: Biến môi trường EXPO_ACCESS_TOKEN chưa được thiết lập!');
    return { error: true, details: 'Server configuration error: Missing Access Token.' };
  }

  const safeNotification = {
    to: token,
    sound: 'default',
    title: notificationData.title || 'Thông báo',
    body: notificationData.body || '',
    data: notificationData.data || {}
  };

  try {
    const response = await axios.post('https://exp.host/--/api/v2/push/send', [safeNotification], {
      headers: {
        'Accept': 'application/json',
        'Accept-encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
        // =========================================================
        // THÊM HEADER XÁC THỰC VÀO ĐÂY
        // =========================================================
        'Authorization': `Bearer ${EXPO_ACCESS_TOKEN}`
      }
    });
    
    // Trả về dữ liệu để các hàm khác có thể log và xử lý
    return response.data;

  } catch (error) {
    console.error('Lỗi khi gửi thông báo đẩy:', error.response?.data || error.message);
    return { error: true, details: error.response?.data || { message: error.message } };
  }
};
