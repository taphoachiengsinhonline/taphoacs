// File: backend/utils/mailer.js

const sendOtpEmail = async (to, code, type = 'otp_payment') => {
    try {
        console.log(`[Brevo API] Đang gửi email đến ${to} với code ${code} (Type: ${type})`);

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

        const payload = {
            sender: {
                name: 'Bách Hoá Giao Ngay',
                email: process.env.BREVO_FROM_EMAIL
            },
            to: [{ email: to }],
            subject: subject,
            htmlContent: htmlContent
        };

        const response = await fetch('https://api.brevo.com/v3/smtp/email', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'api-key': process.env.BREVO_API_KEY
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (!response.ok) {
            console.error('❌ Brevo API Error:', data);
            return false;
        }

        console.log('✅ Email gửi thành công qua Brevo API. MessageId:', data.messageId);
        return true;

    } catch (error) {
        console.error('❌ Lỗi khi gửi email qua Brevo API:', error);
        return false;
    }
};

module.exports = { sendOtpEmail };
