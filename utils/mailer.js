const sgMail = require('@sendgrid/mail');

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const sendOtpEmail = async (to, otp) => {
    try {
        console.log(`Sending OTP email to ${to} with OTP ${otp}`);
        const msg = {
            to,
            from: {
                email: process.env.GMAIL_USER, // hotro.bachhoagiaongay@gmail.com
                name: 'Bách Hoá Giao Ngay'
            },
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
                    <p style="font-size: 12px; color: #666;">Tổ 1, phường Chiềng Sinh, tỉnh Sơn La, Việt Nam</p>
                </div>
            `
        };

        await sgMail.send(msg);
        console.log('Email OTP sent via SendGrid');
        return true;
    } catch (error) {
        console.error('Error sending OTP email via SendGrid:', error);
        if (error.response) {
            console.error('SendGrid error details:', error.response.body);
        }
        return false;
    }
};

module.exports = { sendOtpEmail };
