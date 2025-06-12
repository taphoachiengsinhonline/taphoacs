const Order = require('../models/Order');
const User = require('../models/User');
const PendingDelivery = require('../models/PendingDelivery');
const sendPushNotification = require('./sendPushNotification');
const mongoose = require('mongoose');

const MAX_RETRY = 5;
const RETRY_DELAY = 35000;
const MODAL_TIMEOUT = 30000;

async function assignOrderToNearestShipper(orderId, retryCount = 0) {
  console.log(`[Assign] Bắt đầu chu kỳ ${retryCount + 1} cho order ${orderId}`);

  try {
    const order = await Order.findById(orderId);
    if (!order || order.status !== 'Chờ xác nhận') {
      console.log(`[Assign] Đơn ${orderId} không tồn tại hoặc không ở trạng thái "Chờ xác nhận"`);
      return;
    }

    if (retryCount >= MAX_RETRY) {
      console.log(`[Assign] Hết ${MAX_RETRY} chu kỳ, hủy đơn ${orderId}`);
      order.status = 'Đã huỷ';
      order.cancelReason = 'Không có shipper nhận đơn sau 5 chu kỳ';
      await order.save();

      const customer = await User.findById(order.user);
      if (customer?.fcmToken) {
        await sendPushNotification(customer.fcmToken, {
          title: 'Thông báo hủy đơn',
          body: 'Đơn hàng đã bị huỷ do không có shipper nhận, vui lòng đặt lại sau.',
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
      console.log(`[Assign] Reset danh sách triedShippers cho chu kỳ ${retryCount + 1}`);
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

    console.log(`[Assign] Tìm thấy ${candidates.length} shipper khả dụng trong chu kỳ ${retryCount + 1}`);

    if (candidates.length === 0) {
      console.log(`[Assign] Không còn shipper khả dụng, chuyển sang chu kỳ ${retryCount + 2} sau ${RETRY_DELAY / 1000}s`);
      setTimeout(() => assignOrderToNearestShipper(orderId, retryCount + 1), RETRY_DELAY);
      return;
    }

    const shipper = candidates[0];
    pending.triedShippers.push(shipper._id);
    await pending.save();

    if (shipper.fcmToken) {
      const distance = (shipper.distance / 1000).toFixed(2);
      await sendPushNotification(shipper.fcmToken, {
        title: '🛒 ĐƠN HÀNG MỚI',
        body: `Bạn có đơn hàng mới cách ${distance}km`,
        data: {
          orderId: order._id.toString(),
          notificationType: 'newOrderModal',
          distance,
          retryCount: retryCount + 1,
          shipperView: "true"
        },
      });
      console.log(`[Assign] Đã gửi thông báo tới shipper ${shipper._id}`);
    }

    setTimeout(async () => {
      const freshOrder = await Order.findById(orderId);
      if (freshOrder?.status === 'Chờ xác nhận') {
        console.log(`[Assign] Modal timeout, đơn ${orderId} vẫn chưa được nhận, thử shipper tiếp theo`);
        assignOrderToNearestShipper(orderId, retryCount);
      } else {
        console.log(`[Assign] Đơn ${orderId} đã được xử lý, dừng quá trình`);
      }
    }, MODAL_TIMEOUT);

  } catch (err) {
    console.error(`[Assign] Lỗi trong chu kỳ ${retryCount + 1}:`, err);
    setTimeout(() => assignOrderToNearestShipper(orderId, retryCount), RETRY_DELAY);
  }
}

module.exports = assignOrderToNearestShipper;
