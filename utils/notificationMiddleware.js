// utils/notificationMiddleware.js
// Chỉ cần import hàm gửi của Expo và User model
const sendExpoNotification = require('./sendExpoPushNotification');
const User = require('../models/User');
const { Expo } = require('expo-server-sdk'); // Vẫn cần để kiểm tra token hợp lệ

module.exports = {
  safeNotify: async (token, notificationData) => {
    try {
      if (!token || !Expo.isExpoPushToken(token)) {
       return { success: false, error: 'Invalid or missing Expo Push Token' };
      }

    
      // Chỉ gọi duy nhất hàm gửi của Expo
      const result = await sendExpoNotification(token, notificationData);
      
     // Xử lý lỗi token không hợp lệ trả về từ Expo
      if (result && result.success === false) {
        const isTokenInvalid = result.error === 'PushTokenInvalid';

        if (isTokenInvalid) {
            try {
                const updateResult = await User.updateOne(
                    { fcmToken: token },
                    { $unset: { fcmToken: "" } }
                );
             } catch (dbError) {
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
