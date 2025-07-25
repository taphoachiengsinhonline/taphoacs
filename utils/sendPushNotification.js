// utils/sendPushNotification.js
const { Expo } = require('expo-server-sdk');
let expo;

// Đọc biến môi trường chứa chuỗi Base64
if (process.env.GOOGLE_CREDENTIALS_BASE64) {
  try {
    // Bước 1: Giải mã chuỗi Base64 trở lại thành chuỗi JSON
    const jsonString = Buffer.from(process.env.GOOGLE_CREDENTIALS_BASE64, 'base64').toString('utf-8');
    
    // Bước 2: Parse chuỗi JSON thành object
    const serviceAccount = JSON.parse(jsonString);
    
    // Bước 3: Khởi tạo Expo SDK
    expo = Expo.usingServiceAccountCredentials(serviceAccount);
    
    console.log("[FCM V1] Đã khởi tạo Expo SDK thành công bằng Service Account (từ Base64).");

  } catch (error) {
    console.error("[FCM V1] LỖI: Không thể giải mã hoặc parse GOOGLE_CREDENTIALS_BASE64.", error);
    expo = new Expo();
  }
} else {
  console.error("[FCM V1] LỖI NGHIÊM TRỌNG: Biến môi trường GOOGLE_CREDENTIALS_BASE64 chưa được thiết lập!");
  expo = new Expo();
}

// ... hàm sendPushNotification giữ nguyên ...
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
