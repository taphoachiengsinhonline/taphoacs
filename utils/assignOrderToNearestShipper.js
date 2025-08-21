// backend/utils/assignOrderToNearestShipper.js

const Order = require('../models/Order');
const User = require('../models/User');
const PendingDelivery = require('../models/PendingDelivery');
const mongoose = require('mongoose');

// Thay thế import cũ bằng import `safeNotify`
const { safeNotify } = require('./notificationMiddleware');

const MAX_RETRY = 5;
const RETRY_DELAY = 35000;
const MODAL_TIMEOUT = 30000;

async function assignOrderToNearestShipper(orderId, retryCount = 0) {
  console.log(`[LOG DEBUG assignShipper] - BẮT ĐẦU CHẠY. OrderId: ${orderId}, Lần thử: ${retryCount}`);
  try {
    const order = await Order.findById(orderId);
    if (!order || order.status !== 'Chờ xác nhận') {
      console.log(`[LOG DEBUG assignShipper] - Dừng: Không tìm thấy đơn hàng ${orderId}.`);
     
      return;
    }
    const validStatuses = ['Chờ xác nhận', 'Chờ tư vấn'];
    if (!validStatuses.includes(order.status)) {
       console.log(`[LOG DEBUG assignShipper] - Dừng: Đơn hàng ${orderId} có trạng thái "${order.status}", không hợp lệ để tìm shipper.`);
       return;
    }

    if (retryCount >= MAX_RETRY) {
    
      order.status = 'Đã huỷ';
      order.cancelReason = 'Không có shipper nhận đơn sau 5 chu kỳ';
      await order.save();

      const customer = await User.findById(order.user);
      if (customer?.fcmToken) {
        // Sử dụng safeNotify để gửi thông báo cho khách hàng
        await safeNotify(customer.fcmToken, {
          title: 'Thông báo hủy đơn',
          body: 'Đơn hàng của bạn đã bị huỷ do không có tài xế nhận. Vui lòng đặt lại sau ít phút.',
          // Thêm data để app khách hàng có thể điều hướng nếu cần
          data: {
            orderId: order._id.toString(),
            type: 'order_canceled_no_shipper'
          }
        });
      }
      return;
    }

    let pending = await PendingDelivery.findOne({ orderId });
    if (!pending) {
      pending = new PendingDelivery({
        orderId,
        triedShippers: [],
        retryCount: 0,
      });
    }

    if (pending.retryCount < retryCount) {
     
      pending.triedShippers = [];
      pending.retryCount = retryCount;
      await pending.save();
    }

    const triedShippers = pending.triedShippers || [];

    const candidates = await User.aggregate([
      {
        $geoNear: {
          near: { type: 'Point', coordinates: order.shippingLocation.coordinates },
          distanceField: 'distance',
          maxDistance: 10000,
          query: {
            role: 'shipper',
            isAvailable: true,
            fcmToken: { $exists: true, $ne: null }, // Chỉ tìm shipper có token
            _id: { $nin: triedShippers.map(id => new mongoose.Types.ObjectId(id)) },
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
    
      setTimeout(() => assignOrderToNearestShipper(orderId, retryCount + 1), RETRY_DELAY);
      return;
    }

    const shipper = candidates[0];
    pending.triedShippers.push(shipper._id);
    await pending.save();

    if (shipper.fcmToken) {
      const distance = (shipper.distance / 1000).toFixed(2);
      
      // Sử dụng safeNotify để gửi thông báo cho shipper
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
   
    } else {
     
        assignOrderToNearestShipper(orderId, retryCount);
        return;
    }

    // Cơ chế timeout để tìm shipper tiếp theo nếu shipper hiện tại không phản hồi
    setTimeout(async () => {
      const freshOrder = await Order.findById(orderId);
      if (freshOrder?.status === 'Chờ xác nhận') {
      assignOrderToNearestShipper(orderId, retryCount);
      } else {
     }
    }, MODAL_TIMEOUT);

  } catch (err) {
    console.error(`[Assign] Lỗi trong chu kỳ ${retryCount + 1}:`, err);
    // Vẫn thử lại sau một khoảng thời gian delay nếu có lỗi xảy ra
    setTimeout(() => assignOrderToNearestShipper(orderId, retryCount), RETRY_DELAY);
  }
}

module.exports = assignOrderToNearestShipper;
