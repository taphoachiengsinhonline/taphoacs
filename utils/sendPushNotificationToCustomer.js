//utils/NotificationToCustomer.js
const sendPushNotification = require('./sendPushNotification');
const User = require('../models/User');

module.exports = async (fcmToken, notificationData) => {
  try {
    if (!fcmToken) {
      console.log('Không có FCM token, bỏ qua gửi thông báo');
      return;
    }
    
    console.log(`Gửi thông báo đến token: ${fcmToken}`);
    console.log('Nội dung:', notificationData);
    
    await sendPushNotification(fcmToken, notificationData);
  } catch (error) {
    console.error('Lỗi gửi thông báo cho khách hàng:', error);
    
    // Thử xóa token nếu lỗi do token không hợp lệ
    if (error.response?.data?.errors?.[0]?.code === 'invalid_credentials') {
      console.log('Token không hợp lệ, xóa token khỏi user');
      await User.updateOne(
        { fcmToken },
        { $unset: { fcmToken: 1 } }
      );
    }
  }
};
