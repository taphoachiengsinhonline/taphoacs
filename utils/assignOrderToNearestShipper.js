// utils/assignOrderToNearestShipper.js

const Order = require('../models/Order');
const User = require('../models/User');
const PendingDelivery = require('../models/PendingDelivery');
const sendPushNotification = require('./sendPushNotification');

async function assignOrderToNearestShipper(orderId) {
  console.log(`[Assign] Bắt đầu gán shipper cho order ${orderId}`);
  // 1. Lấy order
  const order = await Order.findById(orderId);
  if (!order) {
    console.warn(`[Assign] Order ${orderId} không tồn tại`);
    return;
  }
  if (order.shipper) {
    console.log(`[Assign] Order ${orderId} đã có shipper: ${order.shipper}`);
    return;
  }

  // 2. Load danh sách đã từng thử
  let pending = await PendingDelivery.findOne({ orderId });
  const tried = pending?.triedShippers || [];

  // 3. Tìm shipper gần nhất chưa thử
  const candidates = await User.aggregate([
    {
      $geoNear: {
        near: {
          type: 'Point',
          coordinates: order.shippingLocation.coordinates
        },
        distanceField: 'distance',
        maxDistance: 10000, // 10km
        query: {
          role: 'shipper',
          isAvailable: true,
          _id: { $nin: tried }
        },
        spherical: true
      }
    },
    { $limit: 3 }
  ]);

  if (!candidates || candidates.length === 0) {
    console.log(`[Assign] Không tìm thấy shipper phù hợp cho order ${orderId}`);
    if (pending) {
      pending.status = 'failed';
      await pending.save();
    }
    return;
  }

  const next = candidates[0];
  console.log(`[Assign] Thử gán shipper ${next._id} (cách ${ (next.distance/1000).toFixed(2) }km)`);

  // 4. Cập nhật PendingDelivery
  if (!pending) {
    pending = new PendingDelivery({
      orderId,
      triedShippers: [next._id],
      status: 'pending'
    });
  } else {
    pending.triedShippers.push(next._id);
  }
  await pending.save();

  // 5. Gửi push đến shipper
  if (next.fcmToken) {
    console.log(`[Assign] Gửi thông báo đến shipper ${next._id}`);
    await sendPushNotification(next.fcmToken, {
      title: 'Đơn hàng mới',
      body: `Bạn có đơn hàng mới cách ${ (next.distance/1000).toFixed(2) }km`,
      data: { orderId }
    });
  } else {
    console.log(`[Assign] Shipper ${next._id} chưa có fcmToken`);
  }

  // 6. Gửi admin (nếu cấu hình)
  if (process.env.ADMIN_FCM_TOKEN) {
    await sendPushNotification(process.env.ADMIN_FCM_TOKEN, {
      title: 'Đơn hàng mới',
      body: `Đơn ${orderId} cần gán shipper`,
      data: { orderId }
    });
  }

  // 7. Nếu sau 30s vẫn chưa có ai nhận (order.shipper vẫn null), gọi lại
  setTimeout(async () => {
    const fresh = await Order.findById(orderId);
    if (fresh && !fresh.shipper) {
      console.log(`[Assign] 30s hết, retry gán shipper cho order ${orderId}`);
      await assignOrderToNearestShipper(orderId);
    }
  }, 30 * 1000);
}

module.exports = assignOrderToNearestShipper;
