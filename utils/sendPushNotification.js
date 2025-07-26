// utils/sendPushNotification.js
const admin = require('firebase-admin');

/**
 * Gửi thông báo đẩy qua Firebase Admin SDK với cấu trúc payload đã được sửa lỗi vị trí.
 * @param {string} fcmToken - Token của thiết bị nhận.
 * @param {object} param1 - Dữ liệu thông báo { title, body, data }.
 * @returns {Promise<object>} - Kết quả gửi từ Firebase.
 */
module.exports = async (fcmToken, { title, body, data }) => {
  const stringifiedData = data ? Object.fromEntries(
    Object.entries(data).map(([key, value]) => [key, String(value)])
  ) : {};

  const message = {
    token: fcmToken,
    
    data: stringifiedData,

    notification: {
      title: title || 'Thông báo mới',
      body: body || 'Bạn có một thông báo mới.',
    },

    android: {
      priority: 'high',
      notification: {
        // <<< BẮT ĐẦU SỬA LỖI VỊ TRÍ VÀ TÊN TRƯỜNG >>>
        sound: 'default',
        channelId: 'default',
        color: '#4CAF50',
        
        // Tên đúng là `vibrationTimings` (camelCase)
        // và nó phải nằm BÊN TRONG `android.notification`.
        // Định dạng thời gian là mili-giây, không phải chuỗi.
        vibrationTimings: ['500ms', '200ms', '500ms', '200ms', '500ms'],
        // <<< KẾT THÚC SỬA LỖI VỊ TRÍ VÀ TÊN TRƯỜNG >>>
      },
    },

    apns: {
      payload: {
        aps: {
          sound: 'default',
          'content-available': 1,
        },
      },
    },
  };

  try {
    // Log lại để kiểm tra payload trước khi gửi
    console.log(`[FCM-Admin] Chuẩn bị gửi payload: ${JSON.stringify(message, null, 2)}`);
    const response = await admin.messaging().send(message);
    console.log(`[FCM-Admin] Gửi thông báo thành công tới ${fcmToken.slice(-10)}:`, response);
    return { success: true, data: response };
  } catch (error) {
    console.error(`[FCM-Admin] LỖI khi gửi thông báo đến token ${fcmToken.slice(-10)}:`, error);
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
