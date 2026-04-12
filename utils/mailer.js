// File: backend/utils/mailer.js
const nodemailer = require('nodemailer');

// Khởi tạo bộ gửi mail bằng Gmail
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD // Dùng Mật khẩu ứng dụng (16 ký tự), không dùng mật khẩu Gmail
    }
});

/**
 * Hàm gửi email đa năng (Hỗ trợ cả OTP và Quên mật khẩu)
 */
const sendOtpEmail = async (to, code, type = 'otp_payment') => {
    try {
        console.log(`Đang gửi email đến ${to} với code ${code} (Type: ${type})`);
        
        let subject = '';
        let htmlContent = '';

        if (type === 'forgot_password') {
            subject = 'Khôi phục mật khẩu - Bách Hoá Giao Ngay';
            htmlContent = `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
                    <h2 style="color: #333; text-align: center;">Khôi Phục Mật Khẩu</h2>
                    <p>Xin chào,</p>
                    <p>Hệ thống đã nhận được yêu cầu khôi phục mật khẩu của bạn.</p>
                    <p>Mật khẩu mới tạm thời của bạn là:</p>
                    <div style="background-color: #f9f9f9; padding: 15px; text-align: center; border-radius: 5px; margin: 20px 0;">
                        <h3 style="color: #FF424E; font-size: 28px; margin: 0; letter-spacing: 5px;">${code}</h3>
                    </div>
                    <p>Vui lòng đăng nhập bằng mật khẩu này và <strong>đổi lại mật khẩu mới</strong> trong phần Tài khoản của bạn để đảm bảo an toàn.</p>
                    <p>Nếu bạn không yêu cầu đổi mật khẩu, vui lòng liên hệ ngay với bộ phận hỗ trợ.</p>
                    <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
                    <p>Trân trọng,<br><strong>Đội ngũ Bách Hoá Giao Ngay</strong></p>
                    <p style="font-size: 12px; color: #999;">Tổ 1, phường Chiềng Sinh, tỉnh Sơn La, Việt Nam</p>
                </div>
            `;
        } else {
            subject = 'Mã OTP Xác Thực Cập Nhật Thông Tin Thanh Toán';
            htmlContent = `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
                    <h2 style="color: #333; text-align: center;">Xác Thực OTP</h2>
                    <p>Xin chào,</p>
                    <p>Bạn đã yêu cầu cập nhật thông tin thanh toán. Mã OTP của bạn là:</p>
                    <div style="background-color: #f9f9f9; padding: 15px; text-align: center; border-radius: 5px; margin: 20px 0;">
                        <h3 style="color: #4CAF50; font-size: 28px; margin: 0; letter-spacing: 5px;">${code}</h3>
                    </div>
                    <p>Mã này có hiệu lực trong 5 phút. Vui lòng nhập mã vào ứng dụng để xác nhận.</p>
                    <p>Nếu bạn không thực hiện yêu cầu này, vui lòng bỏ qua email.</p>
                    <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
                    <p>Trân trọng,<br><strong>Đội ngũ Bách Hoá Giao Ngay</strong></p>
                    <p style="font-size: 12px; color: #999;">Tổ 1, phường Chiềng Sinh, tỉnh Sơn La, Việt Nam</p>
                </div>
            `;
        }

        const mailOptions = {
            from: `"Bách Hoá Giao Ngay" <${process.env.GMAIL_USER}>`, // Tên người gửi
            to: to,
            subject: subject,
            html: htmlContent
        };

        // Bắt đầu gửi
        const info = await transporter.sendMail(mailOptions);
        console.log('✅ Email gửi thành công qua Gmail Nodemailer:', info.messageId);
        return true;

    } catch (error) {
        console.error('❌ Lỗi khi gửi email qua Nodemailer:', error);
        return false;
    }
};

module.exports = { sendOtpEmail };
