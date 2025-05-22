const axios = require('axios');

const sendPushNotification = async (expoPushTokens, title, body) => {
  try {
    // Chuẩn hóa input: Nếu là chuỗi, chuyển thành mảng
    const tokens = Array.isArray(expoPushTokens) ? expoPushTokens : [expoPushTokens];
    
    // Lọc token hợp lệ (không rỗng hoặc undefined)
    const validTokens = tokens.filter(token => typeof token === 'string' && token.trim() !== '');
    if (validTokens.length === 0) {
      throw new Error('Không có token hợp lệ để gửi thông báo');
    }

    // Gửi yêu cầu đến Expo Push API
    const response = await axios.post(
      'https://exp.host/--/api/v2/push/send',
      {
        to: validTokens,
        sound: 'default',
        title,
        body,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
      }
    );

    // Kiểm tra response từ Expo
    const { data } = response;
    if (data.errors) {
      throw new Error(`Expo API lỗi: ${JSON.stringify(data.errors)}`);
    }

    // Trả về kết quả để debug
    return {
      status: 'success',
      tickets: data.data, // Expo trả về mảng ticket cho mỗi token
    };
  } catch (error) {
    console.error('Lỗi gửi push notification:', error.message);
    throw error; // Ném lỗi để caller xử lý
  }
};

module.exports = sendPushNotification;
