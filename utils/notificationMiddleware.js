// utils/notificationMiddleware.js
// Chỉ cần import hàm gửi của Expo và User model
const sendExpoNotification = require('./sendExpoPushNotification');
const User = require('../models/User');
const { Expo } = require('expo-server-sdk'); // Vẫn cần để kiểm tra token hợp lệ

module.exports = {
  safeNotify: async (token, notificationData) => {
    try {
      if (!token || !Expo.isExpoPushToken(token)) {
        console.log(`[safeNotify] BỎ QUA: Token không tồn tại hoặc không phải là Expo Push Token hợp lệ: ${token}`);
        return { success: false, error: 'Invalid or missing Expo Push Token' };
      }

      console.log(`[safeNotify] Chuẩn bị gửi thông báo Expo đến token: ...${token.slice(-10)}`);
      
      // Chỉ gọi duy nhất hàm gửi của Expo
      const result = await sendExpoNotification(token, notificationData);
      
      console.log(`[safeNotify] KẾT QUẢ GỬI:`, JSON.stringify(result, null, 2));

      // Xử lý lỗi token không hợp lệ trả về từ Expo
      if (result && result.success === false) {
        const isTokenInvalid = result.error === 'PushTokenInvalid';

        if (isTokenInvalid) {
            console.log(`[safeNotify] Expo báo token ...${token.slice(-10)} không hợp lệ. TIẾN HÀNH XÓA KHỎI DATABASE.`);
            try {
                const updateResult = await User.updateOne(
                    { fcmToken: token },
                    { $unset: { fcmToken: "" } }
                );
                console.log(`[safeNotify] KẾT QUẢ XÓA TOKEN: ${updateResult.modifiedCount} bản ghi được cập nhật.`);
            } catch (dbError) {
                console.error('[safeNotify] LỖI KHI XÓA TOKEN KHỎI DATABASE:', dbError);
            }
        }
      }
      return result;

    } catch (error) {
      console.error('[safeNotify] Lỗi nghiêm trọng trong hàm safeNotify:', error);
      return { success: false, error: error.message };
    }
  }
};
