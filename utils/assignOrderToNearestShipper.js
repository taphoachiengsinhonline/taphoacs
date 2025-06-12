const Order = require('../models/Order');
const User = require('../models/User');
const PendingDelivery = require('../models/PendingDelivery');
const sendPushNotification = require('./sendPushNotification');
const mongoose = require('mongoose');

const MAX_RETRY = 5; // Tối đa 5 chu kỳ
const RETRY_DELAY = 35000; // 35 giây khi bắt đầu chu kỳ mới
const MAX_SHIPPERS_PER_ROUND = 3;

async function assignOrderToNearestShipper(orderId, retryCount = 0) {
  console.log(`[Assign] Bắt đầu gán shipper cho order ${orderId} (chu kỳ ${retryCount + 1}/${MAX_RETRY})`);

  try {
    const order = await Order.findById(orderId);
    if (!order || order.status !== 'Chờ xác nhận') return;

    // Kiểm tra nếu đã hết số chu kỳ tối đa
    if (retryCount >= MAX_RETRY) {
      console.log(`[Assign] Đã thử ${MAX_RETRY} chu kỳ không thành công. Hủy đơn.`);
      order.status = 'Đã huỷ';
      order.cancelReason = 'Hết lượt tìm shipper';
      await order.save();

      const customer = await User.findById(order.user);
      if (customer?.fcmToken) {
        await sendPushNotification(customer.fcmToken, {
          title: 'Thông báo hủy đơn',
          body: 'Đơn hàng đã bị hủy do không có shipper nào nhận, vui lòng đặt lại sau 5 - 10 phút',
        });
      }
      return;
    }

    let pending = await PendingDelivery.findOne({ orderId });
    const triedShippers = pending?.triedShippers || [];

    // Tìm shipper khả dụng
    const candidates = await User.aggregate([
      {
        $geoNear: {
          near: {
            type: 'Point',
            coordinates: order.shippingLocation.coordinates,
          },
          distanceField: 'distance',
          maxDistance: 10000,
          query: {
            role: 'shipper',
            isAvailable: true,
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
        $match: {
          active_order_count: { $lt: 5 },
        },
      },
      { $limit: MAX_SHIPPERS_PER_ROUND },
    ]);

    // Nếu không có shipper khả dụng trong chu kỳ này
    if (candidates.length === 0) {
      console.log(`[Assign] Không có shipper khả dụng trong chu kỳ này, đợi 35 giây để bắt đầu chu kỳ mới`);
      setTimeout(() => assignOrderToNearestShipper(orderId, retryCount + 1), RETRY_DELAY);
      return;
    }

    // Chọn shipper tiếp theo
    const nextShipper = candidates[0];
    if (!pending) {
      pending = new PendingDelivery({
        orderId,
        triedShippers: [nextShipper._id],
        retryCount: 1,
      });
    } else {
      pending.triedShippers.push(nextShipper._id);
      pending.retryCount = retryCount + 1;
    }
    await pending.save();

    // Gửi thông báo cho shipper
    if (nextShipper.fcmToken) {
      const distance = (nextShipper.distance / 1000).toFixed(2);
      await sendPushNotification(nextShipper.fcmToken, {
        title: '🛒 ĐƠN HÀNG MỚI',
        body: `Bạn có đơn hàng mới cách ${distance}km`,
        data: {
          orderId: order._id.toString(),
          notificationType: 'newOrderModal',
          distance,
          retryCount: retryCount + 1,
        },
      });
    }

    // Đợi 30 giây để kiểm tra xem shipper có nhận đơn không
    setTimeout(() => {
      Order.findById(orderId).then(freshOrder => {
        if (freshOrder?.status === 'Chờ xác nhận') {
          assignOrderToNearestShipper(orderId, retryCount); // Giữ nguyên retryCount trong cùng chu kỳ
        }
      });
    }, 30000); // 30 giây

  } catch (err) {
    console.error('[assignOrder] error:', err);
    setTimeout(() => assignOrderToNearestShipper(orderId, retryCount), RETRY_DELAY);
  }
}

module.exports = assignOrderToNearestShipper;
