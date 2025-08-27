const nodemailer = require('nodemailer');

// Cấu hình transporter cho Gmail SMTP
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587, // Dùng port 587 cho TLS (khuyến nghị), hoặc 465 cho SSL
    secure: false, // true cho port 465, false cho port 587
    auth: {
        user: process.env.GMAIL_USER, // Email Gmail của bạn (VD: example@gmail.com)
        pass: process.env.GMAIL_APP_PASSWORD  // App Password từ Gmail
    },
    // Thêm timeout và kiểm tra kết nối
    connectionTimeout: 10000, // 10 giây
    greetingTimeout: 10000,
    socketTimeout: 10000
});

// Hàm gửi email OTP
const sendOtpEmail = async (to, otp) => {
    try {
        const mailOptions = {
            from: `"Bách Hoá Giao Ngay" <${process.env.GMAIL_USER}>`,
            to,
            subject: 'Mã OTP Xác Thực Cập Nhật Thông Tin Thanh Toán',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                    <h2 style="color: #333;">Xác Thực OTP</h2>
                    <p>Xin chào,</p>
                    <p>Bạn đã yêu cầu cập nhật thông tin thanh toán. Mã OTP của bạn là:</p>
                    <h3 style="color: #4CAF50; font-size: 24px; text-align: center;">${otp}</h3>
                    <p>Mã này có hiệu lực trong 5 phút. Vui lòng nhập mã vào ứng dụng để xác nhận.</p>
                    <p>Nếu bạn không thực hiện yêu cầu này, vui lòng bỏ qua email.</p>
                    <p>Trân trọng,<br>Đội ngũ Bách Hoá Giao Ngay</p>
                </div>
            `
        };

        const info = await transporter.sendMail(mailOptions);
        console.log('Email OTP sent:', info.messageId);
        return true;
    } catch (error) {
        console.error('Error sending OTP email:', error);
        return false;
    }
};

// Kiểm tra kết nối SMTP khi server khởi động
transporter.verify((error, success) => {
    if (error) {
        console.error('SMTP connection error:', error);
    } else {
        console.log('SMTP server is ready to send emails');
    }
});

module.exports = { sendOtpEmail };
