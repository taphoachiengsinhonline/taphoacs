// utils/sendExpoPushNotification.js
const { Expo } = require('expo-server-sdk');
let expo = new Expo();

module.exports = async (pushToken, { title, body, data }) => {
  if (!Expo.isExpoPushToken(pushToken)) {
    console.error(`Lỗi: Token "${pushToken}" không phải là Expo Push Token.`);
    return { success: false, error: 'Invalid token' };
  }

  const message = {
    to: pushToken,
    sound: 'default',
    title: title,
    body: body,
    data: data,
    channelId: 'default', // Quan trọng: chỉ định kênh đã tạo ở client
  };

  try {
    let ticket = await expo.sendPushNotificationsAsync([message]);
    console.log('[ExpoPush] Gửi thông báo thành công, ticket:', ticket);
    // Bạn có thể lưu ticket này để kiểm tra trạng thái sau
    return { success: true, data: ticket };
  } catch (error) {
    console.error('[ExpoPush] Lỗi khi gửi thông báo:', error);
    return { success: false, error: error.message };
  }
};
