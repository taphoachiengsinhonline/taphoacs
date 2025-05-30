// utils/assignOrderToNearestShipper.js
const Order = require('../models/Order');
const User = require('../models/User');
const sendPushNotification = require('./sendPushNotification');
const PendingDelivery = require('../models/PendingDelivery');

module.exports = async function assignOrderToNearestShipper(orderId) {
  console.log(`[Assign] Bắt đầu gán shipper cho order ${orderId}`);
  const order = await Order.findById(orderId);
  if (!order) {
    console.warn('[Assign] Order không tồn tại');
    return;
  }
  if (order.shipper) {
    console.log('[Assign] Order đã có shipper rồi:', order.shipper);
    return;
  }

  // Xem những shipper đã thử
  const pending = await PendingDelivery.findOne({ orderId });
  const excluded = pending?.triedShippers || [];

  // Tìm shipper gần nhất
  const nearby = await User.aggregate([
    {
      $geoNear: {
        near: {
          type: 'Point',
          coordinates: order.shippingLocation.coordinates
        },
        distanceField: 'distance',
        spherical: true,
        query: {
          role: 'shipper',
          isAvailable: true,
          fcmToken: { $exists: true, $ne: null },
          _id: { $nin: excluded }
        }
      }
    },
    { $limit: 1 }
  ]);

  if (nearby.length === 0) {
    console.warn('[Assign] Không tìm thấy shipper phù hợp');
    return;
  }

  const shipper = nearby[0];
  console.log(`[Assign] Gán shipper ${shipper._id}, token=${shipper.fcmToken}`);

  // Cập nhật pending
  if (!pending) {
    await PendingDelivery.create({ orderId, triedShippers: [shipper._id] });
  } else {
    pending.triedShippers.push(shipper._id);
    await pending.save();
  }

  // Gán vào order
  order.shipper = shipper._id;
  await order.save();

  // Thực sự gửi push
  try {
    await sendPushNotification(shipper.fcmToken, {
      title: '📦 Đơn hàng mới',
      body: `Bạn có đơn hàng #${order._id.slice(-6)} cần giao`,
      data: { orderId }
    });
    console.log('[Assign] Gửi push tới shipper thành công');
  } catch (e) {
    console.error('[Assign] Lỗi gửi push cho shipper:', e);
  }
};
