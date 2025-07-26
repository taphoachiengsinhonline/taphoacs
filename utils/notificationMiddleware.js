// utils/notificationMiddleware.js
const sendPushNotification = require('./sendPushNotification');
const User = require('../models/User');

module.exports = {
  safeNotify: async (token, notificationData) => {
    try {
      if (!token) {
        console.log('[safeNotify] BỎ QUA: Không có FCM token để gửi.');
        return { success: false, error: 'Missing token' };
      }
      
      const safeData = {
        ...notificationData,
        title: notificationData.title || 'Thông báo',
        body: notificationData.body || '',
        data: notificationData.data || {}
      };

      console.log(`[safeNotify] CHUẨN BỊ GỬI đến token: ...${token.slice(-10)}`);
      console.log(`[safeNotify] NỘI DUNG: ${JSON.stringify(safeData, null, 2)}`);
      
      const result = await sendPushNotification(token, safeData);
      
      console.log(`[safeNotify] KẾT QUẢ GỬI:`, JSON.stringify(result, null, 2));

      if (result && result.success === false) {
        const errorCode = result.details?.code || result.details?.errorCode;
        console.error(`[safeNotify] LỖI GỬI: ${errorCode} - ${result.details?.message}`);
        
        // Lỗi phổ biến nhất: token không còn tồn tại trên server của Google/Apple
        if (errorCode === 'messaging/registration-token-not-registered') {
          console.log(`[safeNotify] Token ${token.slice(-10)} không hợp lệ. TIẾN HÀNH XÓA KHỎI DATABASE.`);
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
        return { success: false, error: result.details };
      }
      
      console.log(`[safeNotify] GỬI THÀNH CÔNG đến token: ...${token.slice(-10)}`);
      return { success: true };

    } catch (error) {
      console.error('[safeNotify] LỖI NGHIÊM TRỌNG TRONG HÀM safeNotify:', error);
      return { success: false, error: error.message };
    }
  }
};
