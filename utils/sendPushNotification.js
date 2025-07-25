// utils/sendPushNotification.js
const admin = require('firebase-admin');

module.exports = async (token, { title, body, data }) => {
  // Vì ExponentPushToken có dạng ExponentPushToken[xxxxxxxx], 
  // chúng ta cần kiểm tra và đảm bảo nó không phải là token của FCM.
  // firebase-admin chỉ gửi được đến token gốc của FCM, không phải của Expo.
  // Tuy nhiên, chúng ta sẽ thử gửi và xem lỗi trả về.
  
  const message = {
    notification: {
      title: title || 'Thông báo',
      body: body || '',
    },
    data: data || {},
    token: token, // Gửi đến token cụ thể
  };

  try {
    const response = await admin.messaging().send(message);
    console.log('[FCM-Admin] Gửi thông báo thành công:', response);
    return { success: true, data: response };
  } catch (error) {
    console.error('[FCM-Admin] Lỗi khi gửi thông báo:', error.message);
    // Trả về một cấu trúc lỗi nhất quán
    return { 
      success: false, 
      error: "Failed to send notification", 
      details: { 
        code: error.code, 
        message: error.message 
      } 
    };
  }
};
