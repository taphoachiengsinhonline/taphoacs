// utils/notificationMiddleware.js
const sendPushNotification = require('./sendPushNotification');

module.exports = {
  safeNotify: async (token, notificationData) => {
    try {
      if (!token) {
        console.log('Không có FCM token, bỏ qua gửi thông báo');
        return { success: false, error: 'Missing token' };
      }
      
      // Tạo bản sao an toàn của dữ liệu
      const safeData = {
        ...notificationData,
        title: notificationData.title || 'Thông báo',
        body: notificationData.body || '',
        data: notificationData.data || {}
      };
      
      // Gửi thông báo
      const result = await sendPushNotification(token, safeData);
      
      // Xử lý token không hợp lệ
      if (result.error) {
        if (result.details?.errors?.[0]?.code === 'DEVICE_NOT_REGISTERED') {
          console.log('Token không hợp lệ, xóa token khỏi user');
          await User.updateOne(
            { fcmToken: token },
            { $unset: { fcmToken: 1 } }
          );
        }
        return { success: false, error: result.details };
      }
      
      return { success: true };
    } catch (error) {
      console.error('Lỗi trong safeNotify:', error);
      return { success: false, error };
    }
  }
};
