// utils/sendPushNotification.js
const admin = require('firebase-admin');

/**
 * Gửi thông báo đẩy qua Firebase Admin SDK với các tùy chỉnh nâng cao.
 * @param {string} fcmToken - Token của thiết bị nhận.
 * @param {object} param1 - Dữ liệu thông báo { title, body, data }.
 * @returns {Promise<object>} - Kết quả gửi từ Firebase.
 */
module.exports = async (fcmToken, { title, body, data }) => {
  // Đảm bảo tất cả các giá trị trong 'data' đều là chuỗi (string).
  // Đây là yêu cầu của FCM, nếu không sẽ gây lỗi.
  const stringifiedData = data ? Object.fromEntries(
    Object.entries(data).map(([key, value]) => [key, String(value)])
  ) : {};

  const message = {
    token: fcmToken,
    
    // --- Phần Data Payload (Quan trọng cho logic ngầm) ---
    // Dữ liệu này sẽ luôn được gửi đến app, ngay cả khi app ở background.
    data: stringifiedData,

    // --- Phần Notification Payload (Hiển thị cho người dùng) ---
    // Phần này sẽ được hệ điều hành xử lý để hiển thị thông báo.
    notification: {
      title: title || 'Thông báo mới',
      body: body || 'Bạn có một thông báo mới.',
    },

    // --- Cấu hình riêng cho ANDROID (NÂNG CAO) ---
    android: {
      priority: 'high', // Ưu tiên cao nhất để hiển thị ngay lập tức.
      notification: {
        // <<< BẮT ĐẦU SỬA LỖI VÀ THÊM TÍNH NĂNG RUNG >>>

        // 1. Âm thanh: Sử dụng âm thanh thông báo mặc định của hệ thống.
        sound: 'default',

        // 2. Kiểu rung (Vibration Pattern):
        // Mảng các số mili-giây: [delay, vibrate, delay, vibrate, ...]
        // Ví dụ: [0, 400, 200, 400] -> Rung ngay lập tức 400ms, nghỉ 200ms, rung tiếp 400ms.
        // Đây là kiểu rung dài và lặp lại, rất dễ nhận biết.
        vibrationTimingsMillis: [0, 500, 200, 500, 200, 500],
        
        // 3. Kênh thông báo: Phải khớp với tên kênh đã tạo ở client.
        // Trong App.js (file 9), bạn đã đặt tên là 'default'.
        channelId: 'default',
        
        // 4. Mức độ ưu tiên của thông báo (visibility)
        // 'PUBLIC' sẽ hiển thị đầy đủ nội dung trên màn hình khóa.
        visibility: 'PUBLIC',

        // 5. Màu của icon nhỏ (nếu có)
        color: '#4CAF50', // Màu xanh lá cây

        // <<< KẾT THÚC SỬA LỖI >>>
      }
    },
    
    // --- Cấu hình riêng cho APN (iOS) ---
    apns: {
      payload: {
        aps: {
          sound: 'default', // Bật âm thanh mặc định trên iOS
          'content-available': 1, // Để đánh thức app khi ở background
        },
      },
    },
  };

  try {
    const response = await admin.messaging().send(message);
    // Log thành công để dễ debug
    console.log(`[FCM-Admin] Gửi thông báo thành công tới ${fcmToken.slice(-10)}:`, response);
    return { success: true, data: response };
  } catch (error) {
    // Log lỗi chi tiết
    console.error(`[FCM-Admin] LỖI khi gửi thông báo đến token ${fcmToken.slice(-10)}:`, error);
    // Trả về cấu trúc lỗi nhất quán để `safeNotify` có thể xử lý
    return { 
      success: false, 
      error: "Failed to send notification", 
      details: { 
        code: error.code, // Ví dụ: 'messaging/registration-token-not-registered'
        message: error.message 
      } 
    };
  }
};
