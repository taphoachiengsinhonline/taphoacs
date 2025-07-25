// utils/sendPushNotification.js
const axios = require('axios');

// Đọc Access Token từ biến môi trường một cách an toàn
const EXPO_ACCESS_TOKEN = process.env.EXPO_ACCESS_TOKEN;

/**
 * Gửi một thông báo đẩy qua server của Expo sử dụng API v2.
 * @param {string} token - ExponentPushToken của người nhận.
 * @param {object} notificationData - Đối tượng chứa title, body, và data.
 * @returns {Promise<object>} - Kết quả trả về từ server Expo.
 */
const sendPushNotification = async (token, notificationData) => {
  // Thêm một log định danh phiên bản để chắc chắn code mới đang chạy
  console.log("--- [Push V4.0] Đang chạy phiên bản sendPushNotification dùng Axios + Auth Header ---");

  // Kiểm tra xem Access Token có được thiết lập trong môi trường không
  if (!EXPO_ACCESS_TOKEN) {
    const errorMessage = 'LỖI CẤU HÌNH: Biến môi trường EXPO_ACCESS_TOKEN chưa được thiết lập trên server!';
    console.error(`[PushAPI] ${errorMessage}`);
    // Trả về một cấu trúc lỗi nhất quán
    return {
      data: [{
        status: 'error',
        message: errorMessage,
        details: { error: 'ServerConfigurationError' }
      }]
    };
  }

  // Tạo cấu trúc message chuẩn cho API của Expo
  const message = {
    to: token,
    sound: 'default',
    title: notificationData.title || 'Thông báo',
    body: notificationData.body || '',
    data: notificationData.data || {}
  };

  try {
    // Gọi trực tiếp đến API của Expo bằng axios
    const response = await axios.post('https://exp.host/--/api/v2/push/send', [message], {
      headers: {
        'Accept': 'application/json',
        'Accept-encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
        // Thêm header xác thực, đây là phần quan trọng nhất
        'Authorization': `Bearer ${EXPO_ACCESS_TOKEN}`
      },
      // Đặt timeout để tránh request bị treo
      timeout: 10000 // 10 giây
    });
    
    // Trả về dữ liệu từ server Expo để hàm gọi nó có thể xử lý
    return response.data;

  } catch (error) {
    // Log lỗi chi tiết nếu có từ server Expo hoặc do mạng
    const errorDetails = error.response?.data || { message: `Lỗi mạng hoặc timeout: ${error.message}` };
    console.error('[PushAPI] Lỗi khi gửi thông báo đẩy:', JSON.stringify(errorDetails, null, 2));
    
    // Trả về cấu trúc lỗi để hàm gọi nó biết
    return errorDetails; // Trả về toàn bộ object lỗi từ Expo
  }
};

module.exports = sendPushNotification;
