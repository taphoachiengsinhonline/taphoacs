const Order = require('../models/Order');
const User = require('../models/User');
const PendingDelivery = require('../models/PendingDelivery');
const sendPushNotification = require('./sendPushNotification');
const mongoose = require('mongoose');

const MAX_RETRY = 5; // Tối đa 5 vòng lặp
const RETRY_DELAY = 30000; // 30 giây

async function assignOrderToNearestShipper(orderId, retryCount = 0) {
  console.log(`[Assign] Bắt đầu gán shipper cho order ${orderId} (vòng ${retryCount + 1}/5)`);
  
  try {
    const order = await Order.findById(orderId);
    if (!order || order.status !== 'Chờ xác nhận') return;

    // Kiểm tra số vòng lặp
    if (retryCount >= MAX_RETRY) {
      console.log(`[Assign] Đã thử 5 vòng không thành công. Reset và thử lại từ đầu.`);
      await assignOrderToNearestShipper(orderId, 0); // Reset về vòng 0
      return;
    }

    // Load danh sách shipper đã thử
    let pending = await PendingDelivery.findOne({ orderId });
    const tried = pending?.triedShippers || [];

    // Tạo ObjectId đúng cách
    const triedObjectIds = tried.map(id => new mongoose.Types.ObjectId(id));

    // Tìm shipper gần nhất chưa thử
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
            _id: { $nin: triedObjectIds }
          },
          spherical: true
        }
      },
      { $limit: 3 }
    ]);

    // Không tìm thấy shipper phù hợp
    if (!candidates || candidates.length === 0) {
      console.log(`[Assign] Không tìm thấy shipper phù hợp cho order ${orderId}`);
      
      // Chờ 30s và thử lại
      setTimeout(async () => {
        const freshOrder = await Order.findById(orderId);
        if (freshOrder && freshOrder.status === 'Chờ xác nhận') {
          console.log(`[Assign] Thử lại vòng ${retryCount + 1}`);
          await assignOrderToNearestShipper(orderId, retryCount + 1);
        }
      }, RETRY_DELAY);
      return;
    }

    const nextShipper = candidates[0];
    const distance = (nextShipper.distance / 1000).toFixed(2);
    console.log(`[Assign] Thử gán shipper ${nextShipper._id} (cách ${distance}km)`);

    // Cập nhật PendingDelivery
    if (!pending) {
      pending = new PendingDelivery({
        orderId,
        triedShippers: [nextShipper._id],
        status: 'pending'
      });
    } else {
      pending.triedShippers.push(new mongoose.Types.ObjectId(nextShipper._id));
    }
    await pending.save();

    // Gửi push notification với thông tin modal
    if (nextShipper.fcmToken) {
      await sendPushNotification(nextShipper.fcmToken, {
        title: '🛒 ĐƠN HÀNG MỚI',
        body: `Bạn có đơn hàng mới cách ${distance}km`,
        data: { 
          orderId: order._id.toString(),
          notificationType: 'newOrderModal',
          distance
        }
      });
    }

    // Hẹn giờ chuyển sang shipper tiếp theo sau 30s
    setTimeout(async () => {
      const freshOrder = await Order.findById(orderId);
      if (freshOrder && freshOrder.status === 'Chờ xác nhận') {
        console.log(`[Assign] 30s đã hết, chuyển sang shipper tiếp theo (vòng ${retryCount})`);
        await assignOrderToNearestShipper(orderId, retryCount);
      }
    }, RETRY_DELAY);

  } catch (err) {
    console.error('[assignOrder] error:', err);
    
    // Thử lại sau 5s nếu có lỗi
    setTimeout(async () => {
      const freshOrder = await Order.findById(orderId);
      if (freshOrder && freshOrder.status === 'Chờ xác nhận') {
        console.log(`[Assign] Thử lại sau lỗi (vòng ${retryCount})`);
        await assignOrderToNearestShipper(orderId, retryCount);
      }
    }, 5000);
  }
}

module.exports = assignOrderToNearestShipper;
