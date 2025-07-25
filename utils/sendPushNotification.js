const admin = require('firebase-admin');

module.exports = async (fcmToken, { title, body, data }) => {
  // firebase-admin có thể gửi trực tiếp đến token FCM gốc
  const message = {
    notification: {
      title: title || 'Thông báo',
      body: body || '',
    },
    data: data ? Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])) : {}, // Đảm bảo data là string
    token: fcmToken,
    android: { // Thêm cấu hình cho Android để thông báo hiện lên tốt hơn
        priority: 'high',
    },
  };

  try {
    const response = await admin.messaging().send(message);
    console.log('[FCM-Admin] Gửi thông báo thành công:', response);
    return { success: true, data: response };
  } catch (error) {
    console.error(`[FCM-Admin] Lỗi khi gửi thông báo đến token ${fcmToken}:`, error.message);
    return { success: false, error: "Failed to send notification", details: { code: error.code, message: error.message } };
  }
};
