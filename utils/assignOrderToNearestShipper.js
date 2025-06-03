// utils/assignOrderToNearestShipper.js

const Order = require('../models/Order');
const User = require('../models/User');
const PendingDelivery = require('../models/PendingDelivery');
const sendPushNotification = require('./sendPushNotification');

const MAX_RETRY = 5; // Tối đa 5 lần chuyển đơn
async function assignOrderToNearestShipper(orderId, retryCount = 0) {
  console.log(`[Assign] Bắt đầu gán shipper cho order ${orderId} (lần ${retryCount + 1})`);
  
  try {
    const order = await Order.findById(orderId);
    if (!order || order.status !== 'Chờ xác nhận') return;

    // Kiểm tra số lần thử
    if (retryCount >= MAX_RETRY) {
      console.log(`[Assign] Đã thử ${MAX_RETRY} lần không thành công. Hủy đơn ${orderId}`);
      
      // Cập nhật trạng thái hủy
      await Order.findByIdAndUpdate(orderId, {
        status: 'Đã hủy',
        cancelReason: 'Không tìm thấy shipper phù hợp'
      });
      
      // Gửi thông báo cho khách hàng
      const customer = await User.findById(order.user);
      if (customer?.fcmToken) {
        await sendPushNotification(customer.fcmToken, {
          title: 'Đơn hàng đã hủy',
          body: `Đơn hàng #${order._id.toString().slice(-6)} đã hủy do không tìm được shipper`
        });
      }
      
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
      await sendPushNotification(next.fcmToken, {
        title: '🛒 Đơn hàng mới',
        body: `Bạn có đơn hàng #${order._id.toString().slice(-6)} cách ${(next.distance/1000).toFixed(2)}km`,
        data: { orderId: order._id.toString() }
      });
    }

    // Hẹn giờ chuyển đơn nếu không nhận
    setTimeout(async () => {
      const freshOrder = await Order.findById(orderId);
      if (freshOrder && freshOrder.status === 'Chờ xác nhận') {
        console.log(`[Assign] 30s đã hết, chuyển sang shipper tiếp theo (lần ${retryCount + 1})`);
        await assignOrderToNearestShipper(orderId, retryCount + 1);
      }
    }, 30000); // 30 giây

  } catch (err) {
    console.error('[assignOrder] error:', err);
  }
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
