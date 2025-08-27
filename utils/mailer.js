// File: backend/utils/mailer.js
const nodemailer = require('nodemailer');

// Cấu hình transporter để sử dụng Gmail SMTP
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.GMAIL_USER,       // Email của bạn
        pass: process.env.GMAIL_APP_PASSWORD // Mật khẩu ứng dụng 16 ký tự
    }
});

/**
 * Gửi email chứa mã OTP đến người dùng.
 * @param {string} toEmail - Địa chỉ email của người nhận.
 * @param {string} otp - Mã OTP cần gửi.
 * @returns {Promise<boolean>} - Trả về true nếu gửi thành công, false nếu thất bại.
 */
exports.sendOtpEmail = async (toEmail, otp) => {
    const mailOptions = {
        from: `"Bách Hóa Giao Ngay" <${process.env.GMAIL_USER}>`, // Tên người gửi và email
        to: toEmail,
        subject: `[Bách Hóa Giao Ngay] Mã xác thực OTP của bạn là ${otp}`,
        html: `
            <div style="font-family: Arial, sans-serif; text-align: center; padding: 20px; border: 1px solid #ddd; border-radius: 8px; max-width: 450px; margin: auto;">
                <h2 style="color: #333;">Xác nhận thay đổi thông tin</h2>
                <p style="color: #555;">Mã OTP của bạn là:</p>
                <h1 style="font-size: 38px; letter-spacing: 8px; color: #2e7d32; background-color: #f0f0f0; padding: 12px 20px; border-radius: 5px; display: inline-block;">${otp}</h1>
                <p style="color: #555; margin-top: 20px;">Mã này có hiệu lực trong 5 phút. Vì lý do bảo mật, vui lòng không chia sẻ mã này cho bất kỳ ai.</p>
            </div>
        `
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`Đã gửi OTP đến email (qua Gmail): ${toEmail}`);
        return true;
    } catch (error) {
        console.error("Lỗi khi gửi email OTP qua Gmail:", error);
        return false;
    }
};
