// utils/sendPushNotification.js
const { Expo } = require('expo-server-sdk');

let expo;

// Kiểm tra xem biến môi trường chứa nội dung JSON có tồn tại không
if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
  try {
    // Phân tích chuỗi JSON từ biến môi trường thành một object
    const serviceAccount = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
    
    // Khởi tạo Expo SDK với useFcmV1 và serviceAccount
    expo = Expo.usingServiceAccountCredentials(serviceAccount);
    
    console.log("[FCM V1] Đã khởi tạo Expo SDK thành công bằng Service Account.");

  } catch (error) {
    console.error("[FCM V1] LỖI: Không thể parse GOOGLE_APPLICATION_CREDENTIALS_JSON. Vui lòng kiểm tra lại giá trị biến môi trường.", error);
    expo = new Expo(); // Khởi tạo rỗng để tránh crash
  }
} else {
  console.error("[FCM V1] LỖI NGHIÊM TRỌNG: Biến môi trường GOOGLE_APPLICATION_CREDENTIALS_JSON chưa được thiết lập!");
  expo = new Expo();
}


// Hàm sendPushNotification sẽ sử dụng instance 'expo' đã được cấu hình đúng
const sendPushNotification = async (token, { title, body, data }) => {
    if (!Expo.isExpoPushToken(token)) {
        console.error(`Push token ${token} không phải là token hợp lệ.`);
        return { success: false, error: "Invalid token" };
    }
    const message = [{ to: token, title, body, data, sound: 'default' }];
    try {
        const tickets = await expo.sendPushNotificationsAsync(message);
        // Trả về kết quả để file safeNotify có thể đọc được
        return { success: true, data: tickets }; 
    } catch (error) {
        console.error("Lỗi khi gửi thông báo qua Expo SDK (V1):", error);
        return { success: false, error: "Lỗi hệ thống gửi thông báo" };
    }
};

module.exports = sendPushNotification;
