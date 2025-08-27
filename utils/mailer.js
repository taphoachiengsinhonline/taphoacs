const nodemailer = require('nodemailer');
const net = require('net');

// Hàm kiểm tra kết nối SMTP
const testSmtpConnection = async (host, port) => {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        socket.setTimeout(10000);
        socket.on('connect', () => {
            console.log(`Successfully connected to ${host}:${port}`);
            socket.destroy();
            resolve(true);
        });
        socket.on('timeout', () => {
            console.error(`Connection to ${host}:${port} timed out`);
            socket.destroy();
            resolve(false);
        });
        socket.on('error', (error) => {
            console.error(`Error connecting to ${host}:${port}:`, error.message);
            socket.destroy();
            resolve(false);
        });
        socket.connect(port, host);
    });
};

// Transporter cho port 587 (TLS)
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000,
    logger: true,
    debug: true
});

// Transporter cho port 465 (SSL)
const fallbackTransporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000,
    logger: true,
    debug: true
});

// Hàm gửi email OTP
const sendOtpEmail = async (to, otp) => {
    try {
        console.log(`Checking SMTP connection to smtp.gmail.com:587`);
        const smtp587Ok = await testSmtpConnection('smtp.gmail.com', 587);
        if (!smtp587Ok) {
            console.log(`Falling back to smtp.gmail.com:465`);
            const smtp465Ok = await testSmtpConnection('smtp.gmail.com', 465);
            if (!smtp465Ok) {
                throw new Error('Both SMTP ports 587 and 465 are unreachable');
            }
        }

        console.log(`Sending OTP email to ${to} with OTP ${otp}`);
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

        try {
            const info = await transporter.sendMail(mailOptions);
            console.log('Email OTP sent with port 587:', info.messageId);
            return true;
        } catch (error) {
            console.error('Failed to send email with port 587:', error);
            const info = await fallbackTransporter.sendMail(mailOptions);
            console.log('Email OTP sent with port 465:', info.messageId);
            return true;
        }
    } catch (error) {
        console.error('Error sending OTP email:', error);
        return false;
    }
};

// Kiểm tra kết nối SMTP khi server khởi động
transporter.verify((error, success) => {
    if (error) {
        console.error('SMTP (port 587) connection error:', error);
    } else {
        console.log('SMTP (port 587) server is ready to send emails');
    }
});

fallbackTransporter.verify((error, success) => {
    if (error) {
        console.error('SMTP (port 465) connection error:', error);
    } else {
        console.log('SMTP (port 465) server is ready to send emails');
    }
});

module.exports = { sendOtpEmail, testSmtpConnection };
