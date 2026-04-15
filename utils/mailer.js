// File: backend/utils/mailer.js
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    host: 'smtp-relay.brevo.com',
    port: 587,
    secure: false, // true for 465, false for other ports
    auth: {
        user: process.env.BREVO_EMAIL, // Địa chỉ email đăng nhập Brevo
        pass: process.env.BREVO_SMTP_KEY // SMTP Key đã copy
    },
    tls: {
        rejectUnauthorized: false // chỉ tạm thời nếu có lỗi chứng chỉ
    }
});

const sendOtpEmail = async (to, code, type = 'otp_payment') => {
    try {
        console.log(`Đang gửi email đến ${to} với code ${code} (Type: ${type})`);
        
        let subject = '';
        let htmlContent = '';

        // (Giữ nguyên phần tạo nội dung email subject và htmlContent của mày ở đây)

        const mailOptions = {
            from: `"Bách Hoá Giao Ngay" <${process.env.BREVO_EMAIL}>`,
            to: to,
            subject: subject,
            html: htmlContent
        };

        const info = await transporter.sendMail(mailOptions);
        console.log('✅ Email gửi thành công qua Brevo:', info.messageId);
        return true;

    } catch (error) {
        console.error('❌ Lỗi khi gửi email qua Brevo:', error);
        return false;
    }
};

module.exports = { sendOtpEmail };
