// utils/sms.js
const twilio = require('twilio');

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

exports.sendOtpSms = async (toPhoneNumber, otp) => {
    try {
        // Định dạng số điện thoại về chuẩn E.164 (VD: +84329636986)
        const formattedPhoneNumber = `+84${toPhoneNumber.substring(1)}`;

        await client.messages.create({
            body: `[TapHoaCS] Ma xac thuc cua ban la: ${otp}. Ma co hieu luc trong 5 phut.`,
            from: process.env.TWILIO_PHONE_NUMBER,
            to: formattedPhoneNumber
        });
        console.log(`Đã gửi OTP đến ${formattedPhoneNumber}`);
        return true;
    } catch (error) {
        console.error("Lỗi gửi SMS qua Twilio:", error);
        // Không ném lỗi ra ngoài để tránh làm crash app, chỉ log lại
        return false;
    }
};
