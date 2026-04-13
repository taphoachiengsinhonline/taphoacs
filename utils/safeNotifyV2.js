const sendExpoNotification = require('./sendExpoPushNotification'); // hàm cũ gửi Expo
const webpush = require('web-push');
const User = require('../models/User');

// Cấu hình VAPID
webpush.setVapidDetails(
  process.env.VAPID_SUBJECT,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

/**
 * Gửi thông báo đến tất cả các thiết bị của user (mobile + web)
 * @param {string} userId - ID của user
 * @param {object} notificationData - { title, body, data }
 */
async function safeNotifyV2(userId, notificationData) {
  try {
    const user = await User.findById(userId);
    if (!user) {
      console.log(`[safeNotifyV2] User ${userId} không tồn tại`);
      return { success: false, error: 'User not found' };
    }

    const results = { expo: null, web: null };

    // 1. Gửi qua Expo (mobile) nếu có fcmToken
    if (user.fcmToken && user.fcmToken.startsWith('ExponentPushToken')) {
      try {
        const expoResult = await sendExpoNotification(user.fcmToken, notificationData);
        results.expo = expoResult;
        console.log(`[safeNotifyV2] Expo push to ${userId}: ${!!expoResult.success}`);
      } catch (err) {
        console.error(`[safeNotifyV2] Expo push failed for ${userId}:`, err);
        results.expo = { success: false, error: err.message };
      }
    }

    // 2. Gửi qua Web Push nếu có webSubscription
    if (user.webSubscription && user.webSubscription.endpoint) {
      try {
        const payload = JSON.stringify({
          title: notificationData.title,
          body: notificationData.body,
          data: notificationData.data || {},
        });
        await webpush.sendNotification(user.webSubscription, payload);
        results.web = { success: true };
        console.log(`[safeNotifyV2] Web push to ${userId} succeeded`);
      } catch (webErr) {
        console.error(`[safeNotifyV2] Web push failed for ${userId}:`, webErr);
        results.web = { success: false, error: webErr.message };
        // Xóa subscription nếu hết hạn (410 Gone)
        if (webErr.statusCode === 410 || webErr.statusCode === 404) {
          user.webSubscription = null;
          await user.save();
          console.log(`[safeNotifyV2] Removed expired web subscription for user ${userId}`);
        }
      }
    }

    const overallSuccess = !!(results.expo?.success || results.web?.success);
    return { success: overallSuccess, details: results };
  } catch (error) {
    console.error('[safeNotifyV2] Unexpected error:', error);
    return { success: false, error: error.message };
  }
}

module.exports = safeNotifyV2;
