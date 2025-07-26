//utils/sendPushNotification.js

const admin = require('firebase-admin');

/**
 * Gửi thông báo đẩy qua Firebase Admin SDK - Phiên bản cuối cùng, đã sửa lỗi.
 * Cách tiếp cận này dựa vào Notification Channel ở client (Android) để xử lý rung 
 * và các tùy chọn mặc định của APN (iOS).
 * 
 * @param {string} fcmToken - Token của thiết bị nhận.
 * @param {object} param1 - Dữ liệu thông báo, bao gồm { title, body, data }.
 * @param {string} param1.title - Tiêu đề của thông báo.
 * @param {string} param1.body - Nội dung của thông báo.
 * @param {object} param1.data - Dữ liệu ẩn gửi kèm, dùng cho logic của app.
 * @returns {Promise<object>} - Một object chứa trạng thái thành công và dữ liệu trả về hoặc lỗi.
 */
module.exports = async (fcmToken, { title, body, data }) => {
  // Đảm bảo tất cả các giá trị trong 'data' đều là chuỗi (string).
  // Đây là một yêu cầu bắt buộc của FCM, nếu không sẽ gây lỗi.
  const stringifiedData = data ? Object.fromEntries(
    Object.entries(data).map(([key, value]) => [key, String(value)])
  ) : {};

  // Xây dựng payload của thông báo
  const message = {
    token: fcmToken,
    
    // 1. Data Payload: Luôn được gửi đến app, ngay cả khi app ở chế độ nền hoặc đã đóng.
    // Chứa dữ liệu để app xử lý logic ngầm (vd: orderId).
    data: stringifiedData,

    // 2. Notification Payload: Được hệ điều hành sử dụng để hiển thị thông báo cho người dùng.
    notification: {
      title: title || 'Thông báo mới',
      body: body || 'Bạn có một thông báo mới.',
    },

    // 3. Cấu hình riêng cho Android
    android: {
      // Ưu tiên cao nhất để thông báo được hiển thị ngay lập tức dưới dạng heads-up.
      priority: 'high', 
      notification: {
        // Chỉ định ID của kênh thông báo đã được tạo ở phía client.
        // Android sẽ sử dụng các cài đặt (rung, âm thanh, độ ưu tiên) của kênh này.
        // Đây là cách làm đúng chuẩn và đáng tin cậy nhất.
        channelId: 'default', 
      },
    },

    // 4. Cấu hình riêng cho APN (Apple Push Notification service - cho iOS)
    apns: {
      payload: {
        aps: {
          // Yêu cầu iOS phát âm thanh thông báo mặc định.
          sound: 'default',
          // Tùy chọn: Gửi số 1 để iOS biết có nội dung mới, có thể dùng để cập nhật badge.
          // Để quản lý số badge chính xác, server cần tính toán và gửi số cụ thể.
          // badge: 1, 
        },
      },
    },
  };

  try {
    // Log lại toàn bộ payload trước khi gửi để dễ dàng gỡ lỗi
    console.log(`[FCM-Admin] Chuẩn bị gửi payload: ${JSON.stringify(message, null, 2)}`);

    // Gửi thông báo bằng Firebase Admin SDK
    const response = await admin.messaging().send(message);

    // Log khi gửi thành công
    console.log(`[FCM-Admin] Gửi thông báo thành công tới token ...${fcmToken.slice(-10)}:`, response);

    // Trả về kết quả thành công
    return { success: true, data: response };

  } catch (error) {
    // Log lỗi chi tiết khi không gửi được
    console.error(`[FCM-Admin] LỖI khi gửi thông báo đến token ...${fcmToken.slice(-10)}:`, error);

    // Trả về một object lỗi có cấu trúc nhất quán để hàm gọi nó có thể xử lý
    return { 
      success: false, 
      error: "Failed to send notification", 
      details: { 
        code: error.code,       // Mã lỗi từ Firebase, vd: 'messaging/invalid-argument'
        message: error.message  // Tin nhắn lỗi chi tiết
      } 
    };
  }
};
