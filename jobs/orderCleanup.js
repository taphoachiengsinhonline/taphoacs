// File: backend/jobs/orderCleanup.js
const cron = require('node-cron');
const moment = require('moment-timezone');
const Order = require('../models/Order');
const User = require('../models/User');
const { safeNotify } = require('../utils/notificationMiddleware');

const cleanupStuckOrders = async () => {
    console.log('CRON JOB: Bắt đầu kiểm tra các đơn hàng bị treo...');

    try {
        // Tìm các đơn hàng ở trạng thái 'Chờ xác nhận' và được tạo cách đây hơn 3 phút
        const threeMinutesAgo = moment().subtract(3, 'minutes').toDate();

        const stuckOrders = await Order.find({
            status: 'Chờ xác nhận',
            isConsultationOrder: false, // Chỉ áp dụng cho đơn hàng thường
            createdAt: { $lt: threeMinutesAgo }
        }).populate('user', 'fcmToken'); // Lấy thông tin khách hàng để gửi thông báo

        if (stuckOrders.length === 0) {
            console.log('CRON JOB: Không tìm thấy đơn hàng nào bị treo.');
            return;
        }

        console.log(`CRON JOB: Tìm thấy ${stuckOrders.length} đơn hàng bị treo. Bắt đầu hủy...`);

        for (const order of stuckOrders) {
            order.status = 'Đã huỷ';
            order.cancelReason = 'Không có tài xế nào nhận đơn hàng trong thời gian quy định.';
            order.timestamps.canceledAt = new Date();
            await order.save();

            // Gửi thông báo cho khách hàng
            if (order.user && order.user.fcmToken) {
                await safeNotify(order.user.fcmToken, {
                    title: 'Đơn hàng đã bị hủy',
                    body: `Rất tiếc, không có tài xế nào nhận đơn hàng #${order._id.toString().slice(-6)} của bạn. Vui lòng thử đặt lại sau.`,
                    data: { orderId: order._id.toString(), type: 'order_canceled_no_shipper' }
                });
            }
            console.log(`CRON JOB: Đã hủy đơn hàng #${order._id.toString()}`);
        }

    } catch (error) {
        console.error('CRON JOB ERROR: Lỗi khi dọn dẹp đơn hàng bị treo:', error);
    }
};

// Lên lịch chạy tác vụ mỗi phút
const setupOrderCleanupJob = () => {
  cron.schedule('* * * * *', cleanupStuckOrders, {
    scheduled: true,
    timezone: "Asia/Ho_Chi_Minh"
  });
  console.log('🚀 Đã lên lịch tác vụ dọn dẹp đơn hàng bị treo mỗi phút.');
};

module.exports = { setupOrderCleanupJob };
