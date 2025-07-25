// config/firebase.js
const admin = require('firebase-admin');

// Kiểm tra xem biến môi trường có tồn tại không
if (process.env.GOOGLE_CREDENTIALS_BASE64) {
  try {
    // Giải mã chuỗi Base64 trở lại thành chuỗi JSON
    const jsonString = Buffer.from(process.env.GOOGLE_CREDENTIALS_BASE64, 'base64').toString('utf-8');
    const serviceAccount = JSON.parse(jsonString);

    // Khởi tạo Firebase Admin
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });

    console.log("[Firebase Admin] Đã khởi tạo thành công bằng Service Account.");
  } catch (error) {
    console.error("[Firebase Admin] LỖI: Không thể khởi tạo Firebase Admin SDK.", error);
  }
} else {
  console.error("[Firebase Admin] LỖI NGHIÊM TRỌNG: Biến môi trường GOOGLE_CREDENTIALS_BASE64 chưa được thiết lập!");
}

module.exports = admin;
