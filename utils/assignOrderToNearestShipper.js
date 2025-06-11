const Order = require('../models/Order');
const User = require('../models/User');
const PendingDelivery = require('../models/PendingDelivery');
const sendPushNotification = require('./sendPushNotification');
const mongoose = require('mongoose');

const MAX_RETRY = 5; // Tối đa 5 vòng lặp (Yêu cầu 2)
const RETRY_DELAY = 35000; // 35 giây (Yêu cầu 2)
const MAX_SHIPPERS_PER_ROUND = 3;

async function assignOrderToNearestShipper(orderId, retryCount = 0) {
  console.log(`[Assign] Bắt đầu gán shipper cho order ${orderId} (vòng ${retryCount + 1}/5)`);
  
  try {
    const order = await Order.findById(orderId);
    if (!order || order.status !== 'Chờ xác nhận') return;

    // Xử lý huỷ đơn sau 5 lần thử (Yêu cầu 3)
    if (retryCount >= MAX_RETRY) {
      console.log(`[Assign] Đã thử 5 vòng không thành công. Huỷ đơn.`);
      order.status = 'Đã huỷ';
      order.cancelReason = 'Hết lượt tìm shipper';
      await order.save();
      
      // Gửi thông báo cho khách hàng (Yêu cầu 3)
      const customer = await User.findById(order.user);
      if (customer?.fcmToken) {
        await sendPushNotification(customer.fcmToken, {
          title: 'Thông báo huỷ đơn',
          body: 'Đơn hàng đã bị huỷ do không không có shipper nào gần bạn, vui lòng đặt lại sau 5 - 10 phút'
        });
      }
      return;
    }

    let pending = await PendingDelivery.findOne({ orderId });
    const triedShippers = pending?.triedShippers || [];

    // Tìm shipper có ít hơn 5 đơn active (Yêu cầu 0)
    const candidates = await User.aggregate([
      {
        $geoNear: {
          near: {
            type: 'Point',
            coordinates: order.shippingLocation.coordinates
          },
          distanceField: 'distance',
          maxDistance: 10000,
          query: {
            role: 'shipper',
            isAvailable: true,
            _id: { $nin: triedShippers.map(id => new mongoose.Types.ObjectId(id)) }
          },
          spherical: true
        }
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
                    { $in: ['$status', ['Đang xử lý', 'Đang giao']] }
                  ] 
                } 
              } 
            }
          ],
          as: 'active_orders'
        }
      },
      {
        $addFields: {
          active_order_count: { $size: '$active_orders' }
        }
      },
      { 
        $match: { 
          active_order_count: { $lt: 5 } 
        } 
      },
      { $limit: MAX_SHIPPERS_PER_ROUND }
    ]);

    if (candidates.length === 0) {
      console.log(`[Assign] Không tìm thấy shipper phù hợp, thử lại sau ${RETRY_DELAY/1000}s`);
      setTimeout(() => assignOrderToNearestShipper(orderId, retryCount + 1), RETRY_DELAY);
      return;
    }

    // Cập nhật danh sách đã thử
    const nextShipper = candidates[0];
    if (!pending) {
      pending = new PendingDelivery({
        orderId,
        triedShippers: [nextShipper._id],
        retryCount: 1
      });
    } else {
      pending.triedShippers.push(nextShipper._id);
      pending.retryCount = retryCount + 1;
    }
    await pending.save();

    // Gửi thông báo (Yêu cầu 4)
    if (nextShipper.fcmToken) {
      const distance = (nextShipper.distance / 1000).toFixed(2);
      await sendPushNotification(nextShipper.fcmToken, {
        title: '🛒 ĐƠN HÀNG MỚI',
        body: `Bạn có đơn hàng mới cách ${distance}km`,
        data: { 
          orderId: order._id.toString(),
          notificationType: 'newOrderModal',
          distance,
          retryCount: retryCount + 1
        }
      });
    }

    // Hẹn giờ chuyển shipper tiếp theo (Yêu cầu 1)
    setTimeout(() => {
      Order.findById(orderId).then(freshOrder => {
        if (freshOrder?.status === 'Chờ xác nhận') {
          assignOrderToNearestShipper(orderId, retryCount + 1);
        }
      });
    }, 300); // 30 giây (Yêu cầu 1)

  } catch (err) {
    console.error('[assignOrder] error:', err);
    setTimeout(() => assignOrderToNearestShipper(orderId, retryCount), RETRY_DELAY);
  }
}

module.exports = assignOrderToNearestShipper;
