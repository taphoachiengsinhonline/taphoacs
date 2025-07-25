// utils/sendPushNotification.js
// utils/sendPushNotification.js
const axios = require('axios');

// Đọc Access Token từ biến môi trường
const EXPO_ACCESS_TOKEN = process.env.EXPO_ACCESS_TOKEN;

const sendPushNotification = async (token, notificationData) => {
  // Kiểm tra xem token có được thiết lập trong môi trường không
  if (!EXPO_ACCESS_TOKEN) {
    const errorMessage = 'LỖI NGHIÊM TRỌNG: Biến môi trường EXPO_ACCESS_TOKEN chưa được thiết lập!';
    console.error(`[PushAPI] ${errorMessage}`);
    return {
      error: true,
      details: { message: errorMessage }
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
      }
    });
    
    // Trả về dữ liệu từ server Expo để hàm gọi nó có thể xử lý
    return response.data;

  } catch (error) {
    // Log lỗi chi tiết nếu có
    const errorDetails = error.response?.data || { message: error.message };
    console.error('[PushAPI] Lỗi khi gửi thông báo đẩy:', JSON.stringify(errorDetails, null, 2));
    
    // Trả về cấu trúc lỗi để hàm gọi nó biết
    return { error: true, details: errorDetails };
  }
};

module.exports = sendPushNotification;
