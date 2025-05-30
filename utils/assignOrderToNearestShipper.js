const Order = require('../models/Order');
const User = require('../models/User');
const PendingDelivery = require('../models/PendingDelivery');
const sendPushNotification = require('./sendPushNotification'); // Đã có trong dự án

async function assignOrderToNearestShipper(orderId) {
  const order = await Order.findById(orderId);
  if (!order || order.shipper) return;

  const pending = await PendingDelivery.findOne({ orderId });
  const excludedShippers = pending?.triedShippers || [];

  const nearbyShippers = await User.find({
    role: 'shipper',
    isAvailable: true,
    _id: { $nin: excludedShippers },
    location: {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: order.shippingAddress.coordinates
        },
        $maxDistance: 5000
      }
    }
  });

  if (!nearbyShippers.length) {
    if (pending) {
      pending.status = 'failed';
      await pending.save();
    }
    return;
  }

  const nextShipper = nearbyShippers[0];

  if (!pending) {
    await PendingDelivery.create({
      orderId,
      triedShippers: [nextShipper._id]
    });
  } else {
    pending.triedShippers.push(nextShipper._id);
    await pending.save();
  }

  if (nextShipper.fcmToken) {
    await sendPushNotification(nextShipper.fcmToken, {
      title: 'Đơn hàng mới',
      body: 'Bạn có đơn hàng gần bạn. Nhấn để xem và nhận đơn.',
      data: { orderId }
    });
  }

  // Gửi thông báo cho admin nếu có token
  if (process.env.ADMIN_FCM_TOKEN) {
    await sendPushNotification(process.env.ADMIN_FCM_TOKEN, {
      title: 'Đơn hàng mới',
      body: `Đơn hàng cần được giao`,
      data: { orderId }
    });
  }

  setTimeout(async () => {
    const refreshedOrder = await Order.findById(orderId);
    if (!refreshedOrder || refreshedOrder.shipper) return;
    await assignOrderToNearestShipper(orderId);
  }, 30000);
}

module.exports = assignOrderToNearestShipper;

