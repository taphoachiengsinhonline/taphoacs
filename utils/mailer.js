// File: utils/mailer.js

const sgMail = require('@sendgrid/mail');

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

/**
 * Hàm gửi email đa năng (Hỗ trợ cả OTP và Quên mật khẩu)
 * @param {string} to - Email người nhận
 * @param {string} code - Mã OTP hoặc Mật khẩu mới
 * @param {string} type - Loại email: 'otp_payment' hoặc 'forgot_password'
 */
const sendOtpEmail = async (to, code, type = 'otp_payment') => {
    try {
        console.log(`Sending email to ${to} with code ${code} (Type: ${type})`);
        
        let subject = '';
        let htmlContent = '';

        // Tùy biến nội dung dựa trên 'type'
        if (type === 'forgot_password') {
            subject = 'Khôi phục mật khẩu - Bách Hoá Giao Ngay';
            htmlContent = `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                    <h2 style="color: #333;">Khôi Phục Mật Khẩu</h2>
                    <p>Xin chào,</p>
                    <p>Hệ thống đã nhận được yêu cầu khôi phục mật khẩu của bạn.</p>
                    <p>Mật khẩu mới tạm thời của bạn là:</p>
                    <h3 style="color: #FF424E; font-size: 24px; text-align: center; letter-spacing: 5px;">${code}</h3>
                    <p>Vui lòng đăng nhập bằng mật khẩu này và đổi lại mật khẩu mới trong phần Tài khoản của bạn để đảm bảo an toàn.</p>
                    <p>Nếu bạn không yêu cầu đổi mật khẩu, vui lòng liên hệ ngay với bộ phận hỗ trợ.</p>
                    <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
                    <p>Trân trọng,<br><strong>Đội ngũ Bách Hoá Giao Ngay</strong></p>
                    <p style="font-size: 12px; color: #999;">Tổ 1, phường Chiềng Sinh, tỉnh Sơn La, Việt Nam</p>
                </div>
            `;
        } else {
            // Mặc định là OTP cập nhật thanh toán (Giữ nguyên code cũ của bạn)
            subject = 'Mã OTP Xác Thực Cập Nhật Thông Tin Thanh Toán';
            htmlContent = `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                    <h2 style="color: #333;">Xác Thực OTP</h2>
                    <p>Xin chào,</p>
                    <p>Bạn đã yêu cầu cập nhật thông tin thanh toán. Mã OTP của bạn là:</p>
                    <h3 style="color: #4CAF50; font-size: 24px; text-align: center; letter-spacing: 5px;">${code}</h3>
                    <p>Mã này có hiệu lực trong 5 phút. Vui lòng nhập mã vào ứng dụng để xác nhận.</p>
                    <p>Nếu bạn không thực hiện yêu cầu này, vui lòng bỏ qua email.</p>
                    <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
                    <p>Trân trọng,<br><strong>Đội ngũ Bách Hoá Giao Ngay</strong></p>
                    <p style="font-size: 12px; color: #999;">Tổ 1, phường Chiềng Sinh, tỉnh Sơn La, Việt Nam</p>
                </div>
            `;
        }

        const msg = {
            to,
            from: {
                email: process.env.GMAIL_USER, // hotro.bachhoagiaongay@gmail.com
                name: 'Bách Hoá Giao Ngay'
            },
            subject: subject,
            html: htmlContent
        };

        await sgMail.send(msg);
        console.log('Email sent successfully via SendGrid');
        return true;
    } catch (error) {
        console.error('Error sending email via SendGrid:', error);
        if (error.response) {
            console.error('SendGrid error details:', error.response.body);
        }
        return false;
    }
};

module.exports = { sendOtpEmail };
