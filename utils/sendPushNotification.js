// utils/sendPushNotification.js
const admin = require('firebase-admin');

/**
 * Gửi thông báo đẩy qua Firebase Admin SDK với cấu trúc payload đã được sửa lỗi.
 * @param {string} fcmToken - Token của thiết bị nhận.
 * @param {object} param1 - Dữ liệu thông báo { title, body, data }.
 * @returns {Promise<object>} - Kết quả gửi từ Firebase.
 */
module.exports = async (fcmToken, { title, body, data }) => {
  const stringifiedData = data ? Object.fromEntries(
    Object.entries(data).map(([key, value]) => [key, String(value)])
  ) : {};

  // <<< BẮT ĐẦU SỬA LỖI CẤU TRÚC PAYLOAD >>>
  const message = {
    token: fcmToken,
    
    // Phần Data luôn được gửi đến app
    data: stringifiedData,

    // Phần Notification hiển thị cho người dùng
    notification: {
      title: title || 'Thông báo mới',
      body: body || 'Bạn có một thông báo mới.',
    },

    // Cấu hình riêng cho ANDROID
    android: {
      priority: 'high',
      notification: {
        // Âm thanh, kênh, màu sắc vẫn giữ nguyên ở đây
        sound: 'default',
        channelId: 'default',
        color: '#4CAF50',
      },
      // --- DI CHUYỂN CẤU HÌNH RUNG RA NGOÀI `notification` ---
      // Tên đúng của trường là `vibration_timings` (dùng dấu gạch dưới)
      // và nó nằm cùng cấp với `priority` và `notification`.
      vibration_timings: ['0.5s', '0.2s', '0.5s', '0.2s', '0.5s'],
    },
    // <<< KẾT THÚC SỬA LỖI CẤU TRÚC PAYLOAD >>>

    // Cấu hình riêng cho APN (iOS)
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
