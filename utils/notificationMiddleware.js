// File: utils/notificationMiddleware.js
const sendExpoNotification = require('./sendExpoPushNotification');
const User = require('../models/User');
const { Expo } = require('expo-server-sdk');
const admin = require('firebase-admin'); // Thêm Firebase Admin SDK để gửi Web Push

module.exports = {
  safeNotify: async (token, notificationData) => {
    try {
      if (!token) {
        return { success: false, error: 'Missing Token' };
      }

      // ========================================================
      // TRƯỜNG HỢP 1: TOKEN CỦA ĐIỆN THOẠI (EXPO PUSH TOKEN)
      // ========================================================
      if (Expo.isExpoPushToken(token)) {
        // Chỉ gọi duy nhất hàm gửi của Expo (Giữ nguyên code cũ của bạn)
        const result = await sendExpoNotification(token, notificationData);
        
        // Xử lý lỗi token không hợp lệ trả về từ Expo
        if (result && result.success === false) {
          const isTokenInvalid = result.error === 'PushTokenInvalid' || result.error === 'DeviceNotRegistered';
          if (isTokenInvalid) {
              try {
                  await User.updateOne(
                      { fcmToken: token },
                      { $unset: { fcmToken: "" } }
                  );
              } catch (dbError) {
                  console.error("Lỗi xóa Expo token:", dbError);
              }
          }
        }
        return result;
      } 
      // ========================================================
      // TRƯỜNG HỢP 2: TOKEN CỦA WEB (FCM TOKEN THUẦN)
      // ========================================================
      else {
        try {
          // Firebase yêu cầu mọi dữ liệu trong 'data' payload phải là dạng chuỗi (String)
          const stringifiedData = {};
          if (notificationData.data) {
              for (const key in notificationData.data) {
                  stringifiedData[key] = String(notificationData.data[key]);
              }
          }

          // Cấu hình tin nhắn cho Firebase
          const message = {
            token: token,

            notification: {
                title: notificationData.title || 'Thông báo',
                body: notificationData.body || notificationData.message || '',
            },

            data: stringifiedData,
  
            android: {
                priority: 'high'
            },

            webpush: {
                fcmOptions: {
                    link: 'https://bhgnweb.maytinhthaikhang.workers.dev'
                }
              }
            };

          // Dùng Firebase Admin để bắn thẳng tới Web
          const response = await admin.messaging().send(message);
          console.log('[safeNotify] ✅ Đã gửi Web Push thành công cho Web!');
          return { success: true, response };

        } catch (fcmError) {
          console.error('[safeNotify] ❌ Lỗi gửi Web Push:', fcmError.message);
          
          // Xóa token nếu bị lỗi không hợp lệ hoặc hết hạn từ Firebase
          if (fcmError.code === 'messaging/invalid-registration-token' || fcmError.code === 'messaging/registration-token-not-registered') {
              try {
                  await User.updateOne(
                      { fcmToken: token },
                      { $unset: { fcmToken: "" } }
                  );
                  console.log('[safeNotify] Đã xóa FCM Token Web hỏng khỏi DB');
              } catch (dbError) {}
          }
          return { success: false, error: fcmError.message };
        }
      }

    } catch (error) {
      console.error('[safeNotify] Lỗi nghiêm trọng trong hàm safeNotify:', error);
      return { success: false, error: error.message };
    }
  }
};
