// File: backend/jobs/orderCleanup.js

const cron = require('node-cron');
const moment = require('moment-timezone');
const Order = require('../models/Order');
const User = require('../models/User');
const { safeNotify } = require('../utils/notificationMiddleware');
const Notification = require('../models/Notification');

// --- HÀM 1: DỌN DẸP ĐƠN HÀNG THƯỜNG BỊ TREO ---
const cleanupStuckOrders = async () => {
    try {
        const threeMinutesAgo = moment().subtract(3, 'minutes').toDate();
        const stuckOrders = await Order.find({
            status: 'Chờ xác nhận',
            isConsultationOrder: false,
            createdAt: { $lt: threeMinutesAgo }
        }).populate('user', 'fcmToken');

        if (stuckOrders.length === 0) return;

        console.log(`CRON JOB: Tìm thấy ${stuckOrders.length} đơn hàng thường bị treo. Bắt đầu hủy...`);

        for (const order of stuckOrders) {
            order.status = 'Đã huỷ';
            order.cancelReason = 'Không có tài xế nào nhận đơn hàng trong thời gian quy định.';
            order.timestamps.canceledAt = new Date();
            await order.save();

            const notificationBody = `Rất tiếc, không có tài xế nào nhận đơn hàng #${order._id.toString().slice(-6)} của bạn. Vui lòng thử đặt lại sau.`;
            
            await Notification.create({
                user: order.user._id,
                title: 'Đơn hàng đã bị hủy',
                message: notificationBody,
                type: 'order',
                data: { orderId: order._id.toString() }
            });
            
            if (order.user?.fcmToken) {
                await safeNotify(order.user.fcmToken, {
                    title: 'Đơn hàng đã bị hủy',
                    body: notificationBody,
                    data: { orderId: order._id.toString(), type: 'order_canceled_no_shipper' }
                });
            }
            console.log(`CRON JOB: Đã hủy đơn hàng thường #${order._id.toString()}`);
        }
    } catch (error) {
        console.error('CRON JOB ERROR: Lỗi khi dọn dẹp đơn hàng thường:', error);
    }
};

// --- HÀM 2: DỌN DẸP YÊU CẦU TƯ VẤN BỊ TREO ---
const cleanupStuckConsultations = async () => {
    try {
        // --- TRƯỜNG HỢP 1: 'Chờ tư vấn' quá 10 phút ---
        const tenMinutesAgo = moment().subtract(10, 'minutes').toDate();
        const pendingConsultations = await Order.find({
            status: 'Chờ tư vấn',
            isConsultationOrder: true,
            createdAt: { $lt: tenMinutesAgo }
        }).populate('user', 'fcmToken');

        if (pendingConsultations.length > 0) {
            console.log(`CRON JOB: Tìm thấy ${pendingConsultations.length} yêu cầu tư vấn (Chờ tư vấn) bị treo. Bắt đầu hủy...`);
            for (const order of pendingConsultations) {
                order.status = 'Đã huỷ';
                order.cancelReason = 'Người bán không phản hồi yêu cầu tư vấn.';
                order.timestamps.canceledAt = new Date();
                await order.save();
                const notificationBody = `Hiện tại người bán hàng đang bận, chưa thể tư vấn cho bạn ngay lúc này. Xin vui lòng tạo lại yêu cầu tư vấn sau ít phút.`;
                await Notification.create({ user: order.user._id, title: 'Yêu cầu tư vấn đã bị hủy', message: notificationBody, type: 'order', data: { orderId: order._id.toString() } });
                if (order.user?.fcmToken) {
                    await safeNotify(order.user.fcmToken, { title: 'Yêu cầu tư vấn đã bị hủy', body: notificationBody, data: { orderId: order._id.toString(), type: 'consultation_canceled_no_seller' } });
                }
                console.log(`CRON JOB: Đã hủy yêu cầu 'Chờ tư vấn' #${order._id.toString()}`);
            }
        }

        // --- TRƯỜNG HỢP 2: 'Đang tư vấn' quá 20 phút ---
        const twentyMinutesAgo = moment().subtract(20, 'minutes').toDate();
        const inProgressConsultations = await Order.find({
            status: 'Đang tư vấn',
            isConsultationOrder: true,
            'timestamps.acceptedAt': { $lt: twentyMinutesAgo } // Dựa vào thời gian shipper nhận đơn
        }).populate('user', 'fcmToken').populate('consultationSellerId', 'fcmToken');

        if (inProgressConsultations.length > 0) {
            console.log(`CRON JOB: Tìm thấy ${inProgressConsultations.length} yêu cầu tư vấn (Đang tư vấn) bị treo. Bắt đầu hủy...`);
            for (const order of inProgressConsultations) {
                order.status = 'Đã huỷ';
                order.cancelReason = 'Phiên tư vấn đã hết hạn do không có báo giá được tạo.';
                order.timestamps.canceledAt = new Date();
                await order.save();

                // Thông báo cho khách hàng
                const customerNotificationBody = `Phiên tư vấn cho đơn hàng #${order._id.toString().slice(-6)} đã kết thúc do quá thời gian. Vui lòng tạo yêu cầu mới nếu bạn vẫn còn nhu cầu.`;
                await Notification.create({ user: order.user._id, title: 'Phiên tư vấn đã kết thúc', message: customerNotificationBody, type: 'order', data: { orderId: order._id.toString() } });
                if (order.user?.fcmToken) {
                    await safeNotify(order.user.fcmToken, { title: 'Phiên tư vấn đã kết thúc', body: customerNotificationBody, data: { orderId: order._id.toString(), type: 'consultation_timed_out' } });
                }
                 console.log(`CRON JOB: Đã hủy yêu cầu 'Đang tư vấn' #${order._id.toString()} (thông báo cho khách).`);

                // Thông báo cho người bán
                if (order.consultationSellerId) {
                    const sellerNotificationBody = `Phiên tư vấn cho đơn hàng #${order._id.toString().slice(-6)} đã tự động hủy do quá 20 phút không có báo giá.`;
                    await Notification.create({ user: order.consultationSellerId._id, title: 'Phiên tư vấn đã hết hạn', message: sellerNotificationBody, type: 'order', data: { orderId: order._id.toString() } });
                     if (order.consultationSellerId.fcmToken) {
                        await safeNotify(order.consultationSellerId.fcmToken, { title: 'Phiên tư vấn đã hết hạn', body: sellerNotificationBody, data: { orderId: order._id.toString(), type: 'consultation_timed_out' } });
                    }
                    console.log(`CRON JOB: Đã thông báo cho seller về việc hủy đơn #${order._id.toString()}`);
                }
            }
        }
    } catch (error) {
        console.error('CRON JOB ERROR: Lỗi khi dọn dẹp yêu cầu tư vấn:', error);
    }
};

// Lên lịch chạy tác vụ mỗi phút
const setupOrderCleanupJob = () => {
  cron.schedule('* * * * *', async () => {
    console.log("CRON JOB: Bắt đầu chu kỳ dọn dẹp...");
    await cleanupStuckOrders();
    await cleanupStuckConsultations();
    console.log("CRON JOB: Hoàn thành chu kỳ dọn dẹp.");
  }, {
    scheduled: true,
    timezone: "Asia/Ho_Chi_Minh"
  });
  console.log('🚀 Đã lên lịch tác vụ dọn dẹp đơn hàng và yêu cầu tư vấn mỗi phút.');
};

module.exports = { setupOrderCleanupJob };
