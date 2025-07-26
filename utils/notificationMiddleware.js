// utils/notificationMiddleware.js (file 36)
const sendFirebaseNotification = require('./sendPushNotification'); // File cũ
const sendExpoNotification = require('./sendExpoPushNotification'); // File mới
const { Expo } = require('expo-server-sdk');
const User = require('../models/User');

module.exports = {
  safeNotify: async (token, notificationData) => {
    try {
      if (!token) {
        console.log('[safeNotify] BỎ QUA: Không có token.');
        return;
      }

      console.log(`[safeNotify] Chuẩn bị gửi đến token: ...${token.slice(-10)}`);
      
      let result;
      // Tự động nhận diện loại token và chọn hàm gửi phù hợp
      if (Expo.isExpoPushToken(token)) {
        console.log("[safeNotify] Phát hiện Expo Push Token. Sử dụng API của Expo.");
        result = await sendExpoNotification(token, notificationData);
      } else {
        console.log("[safeNotify] Phát hiện FCM Token gốc. Sử dụng Firebase Admin SDK.");
        result = await sendFirebaseNotification(token, notificationData);
      }
      
      console.log(`[safeNotify] KẾT QUẢ GỬI:`, result);

      // Xử lý lỗi (chủ yếu cho token không hợp lệ)
      // Logic này cần được điều chỉnh lại cho phù hợp với kết quả trả về của cả 2 SDK
      if (result && result.success === false) {
          // Xóa token nếu không hợp lệ
          await User.updateOne({ fcmToken: token }, { $unset: { fcmToken: "" } });
      }

    } catch (error) {
      console.error('[safeNotify] Lỗi nghiêm trọng:', error);
    }
  }
};
