// File: backend/utils/assignOrderToNearestShipper.js

const Order = require('../models/Order');
const User = require('../models/User');
const PendingDelivery = require('../models/PendingDelivery');
const mongoose = require('mongoose');
const { safeNotify } = require('./notificationMiddleware');

const MAX_RETRY = 5;
const RETRY_DELAY = 10000;
const MODAL_TIMEOUT = 45000;

async function assignOrderToNearestShipper(orderId, retryCount = 0) {
    console.log(`[assignShipper][${orderId}] --- BẮT ĐẦU CHU KỲ ${retryCount} ---`);
  
    try {
        console.log(`[assignShipper][${orderId}] Bước 1: Tìm kiếm đơn hàng trong DB...`);
        const order = await Order.findById(orderId);
        
        if (!order) {
            console.error(`[assignShipper][${orderId}] DỪNG: Order.findById không tìm thấy đơn hàng.`);
            return;
        }

        // <<< THÊM KIỂM TRA QUAN TRỌNG >>>
        if (!order.region) {
            console.error(`[assignShipper][${orderId}] DỪNG: Đơn hàng không có thông tin khu vực (region).`);
            return;
        }
        
        console.log(`[assignShipper][${orderId}] Bước 1 THÀNH CÔNG. Tình trạng: ${order.status}, Khu vực: ${order.region}`);

        const validStatuses = ['Chờ xác nhận', 'Chờ tư vấn'];
        if (!validStatuses.includes(order.status)) {
            console.log(`[assignShipper][${orderId}] DỪNG: Trạng thái "${order.status}" không hợp lệ để tìm shipper.`);
            return;
        }

        if (retryCount >= MAX_RETRY) {
            console.log(`[Assign] Đã đạt giới hạn ${MAX_RETRY} lần thử cho đơn hàng ${orderId}. Sẽ chờ cron job xử lý.`);
            return;
        }

        console.log(`[assignShipper][${orderId}] Bước 2: Tìm hoặc tạo PendingDelivery...`);
        let pending = await PendingDelivery.findOne({ orderId });
        if (!pending) {
            pending = new PendingDelivery({ orderId, triedShippers: [], retryCount: 0 });
        }

        if (pending.retryCount < retryCount) {
            console.log(`[assignShipper][${orderId}] Reset danh sách shipper đã thử cho chu kỳ mới.`);
            pending.triedShippers = [];
            pending.retryCount = retryCount;
        }

        const triedShippers = pending.triedShippers || [];
        console.log(`[assignShipper][${orderId}] Bước 3: Tìm shipper ứng viên (loại trừ ${triedShippers.length} shipper đã thử)...`);

        const candidates = await User.aggregate([
            {
                $geoNear: {
                    near: { type: 'Point', coordinates: order.shippingLocation.coordinates },
                    distanceField: 'distance',
                    maxDistance: 10000,
                    query: {
                        role: 'shipper',
                        isAvailable: true,
                        fcmToken: { $exists: true, $ne: null },
                        _id: { $nin: triedShippers.map(id => new mongoose.Types.ObjectId(id)) },
                        // --- BẮT ĐẦU SỬA LỖI ---
                        region: order.region, // <<< CHỈ TÌM SHIPPER CÙNG KHU VỰC VỚI ĐƠN HÀNG
                        approvalStatus: 'approved'
                        // --- KẾT THÚC SỬA LỖI ---
                    },
                    spherical: true,
                },
            },
            {
                $lookup: {
                    from: 'orders',
                    let: { userId: '$_id' },
                    pipeline: [
                        {
                            $match: {
                                $expr: {
                                    $and: [
                                        { $eq: ['$shipper', '$$userId'] },
                                        { $in: ['$status', ['Đang xử lý', 'Đang giao']] },
                                    ],
                                },
                            },
                        },
                    ],
                    as: 'active_orders',
                },
            },
            {
                $addFields: {
                    active_order_count: { $size: '$active_orders' },
                },
            },
            {
                $match: { active_order_count: { $lt: 5 } },
            },
            { $limit: 1 },
        ]);

        if (candidates.length === 0) {
            console.warn(`[assignShipper][${orderId}] Bước 3 THẤT BẠI: Không tìm thấy shipper nào khả dụng trong khu vực. Lên lịch thử lại sau ${RETRY_DELAY}ms.`);
            setTimeout(() => assignOrderToNearestShipper(orderId, retryCount + 1), RETRY_DELAY);
            return;
        }

        const shipper = candidates[0];
        console.log(`[assignShipper][${orderId}] Bước 3 THÀNH CÔNG: Tìm thấy shipper ${shipper.name} (${shipper._id})`);

        pending.triedShippers.push(shipper._id);
        await pending.save();
        console.log(`[assignShipper][${orderId}] Bước 4: Đã cập nhật PendingDelivery.`);

        if (shipper.fcmToken) {
            console.log(`[assignShipper][${orderId}] Bước 5: Gửi thông báo đẩy đến shipper...`);
            const distance = (shipper.distance / 1000).toFixed(2);
            await safeNotify(shipper.fcmToken, {
                title: '🛒 ĐƠN HÀNG MỚI',
                body: `Bạn có đơn hàng mới cách khoảng ${distance}km`,
                data: {
                    orderId: order._id.toString(),
                    notificationType: 'newOrderModal',
                    distance,
                    retryCount: retryCount + 1,
                    shipperView: "true"
                },
            });
            console.log(`[assignShipper][${orderId}] Bước 5 THÀNH CÔNG.`);
        } else {
            console.warn(`[assignShipper][${orderId}] Bỏ qua gửi thông báo vì shipper không có fcmToken. Thử lại ngay.`);
            assignOrderToNearestShipper(orderId, retryCount);
            return;
        }

        console.log(`[assignShipper][${orderId}] Bước 6: Lên lịch timeout ${MODAL_TIMEOUT}ms để kiểm tra...`);
        setTimeout(async () => {
            const freshOrder = await Order.findById(orderId);
            const currentStatus = freshOrder?.status;
            
            if (currentStatus === 'Chờ tư vấn' || currentStatus === 'Chờ xác nhận') {
                console.log(`[assignShipper][${orderId}] Timeout: Shipper không phản hồi. Bắt đầu tìm shipper tiếp theo.`);
                assignOrderToNearestShipper(orderId, retryCount + 1);
            } else {
                console.log(`[assignShipper][${orderId}] Timeout: Đơn hàng đã được xử lý (trạng thái: ${currentStatus}). Dừng chu kỳ.`);
            }
        }, MODAL_TIMEOUT);
        
        console.log(`[assignShipper][${orderId}] --- Kết thúc chu kỳ ${retryCount} ---`);

    } catch (err) {
        console.error(`[assignShipper][${orderId}] LỖI NGHIÊM TRỌNG trong chu kỳ ${retryCount}:`, err);
        setTimeout(() => assignOrderToNearestShipper(orderId, retryCount + 1), RETRY_DELAY);
    }
}

module.exports = assignOrderToNearestShipper;
