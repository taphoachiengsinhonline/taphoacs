const Order = require('../models/Order');
const User = require('../models/User');
const PendingDelivery = require('../models/PendingDelivery');
const sendPushNotification = require('./sendPushNotification');
const mongoose = require('mongoose');

const MAX_RETRY = 5; // Tối đa 5 chu kỳ
const RETRY_DELAY = 35000; // 35 giây giữa các chu kỳ
const MODAL_TIMEOUT = 30000; // 30 giây timeout cho modal

async function assignOrderToNearestShipper(orderId, retryCount = 0) {
  console.log(`[Assign] Bắt đầu chu kỳ ${retryCount + 1} cho order ${orderId}`);

  try {
    // Tìm đơn hàng
    const order = await Order.findById(orderId);
    if (!order || order.status !== 'Chờ xác nhận') {
      console.log(`[Assign] Đơn ${orderId} không tồn tại hoặc không ở trạng thái "Chờ xác nhận"`);
      return;
    }

    // Kiểm tra nếu đã hết số chu kỳ tối đa
    if (retryCount >= MAX_RETRY) {
      console.log(`[Assign] Hết ${MAX_RETRY} chu kỳ, hủy đơn ${orderId}`);
      order.status = 'Đã huỷ';
      order.cancelReason = 'Không có shipper nhận đơn sau 5 chu kỳ';
      await order.save();

      const customer = await User.findById(order.user);
      if (customer?.fcmToken) {
        await sendPushNotification(customer.fcmToken, {
          title: 'Thông báo hủy đơn',
          body: 'Đơn hàng đã bị hủy do không có shipper nhận, vui lòng đặt lại sau.',
        });
      }
      return;
    }

    // Lấy hoặc tạo dữ liệu pending
    let pending = await PendingDelivery.findOne({ orderId });
    if (!pending) {
      pending = new PendingDelivery({
        orderId,
        triedShippers: [],
        retryCount: 0,
      });
    }

    // Reset triedShippers nếu bắt đầu chu kỳ mới
    if (pending.retryCount < retryCount) {
      console.log(`[Assign] Reset danh sách triedShippers cho chu kỳ ${retryCount + 1}`);
      pending.triedShippers = [];
      pending.retryCount = retryCount;
      await pending.save();
    }

    const triedShippers = pending.triedShippers || [];

    // Tìm shipper khả dụng
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
        $match: { 'active_orders': { $size: { $lt: 5 } } },
      },
      { $limit: 1 }, // Chỉ lấy 1 shipper mỗi lần
    ]);

    console.log(`[Assign] Tìm thấy ${candidates.length} shipper khả dụng trong chu kỳ ${retryCount + 1}`);

    // Nếu không có shipper nào khả dụng
    if (candidates.length === 0) {
      console.log(`[Assign] Không còn shipper khả dụng, chuyển sang chu kỳ ${retryCount + 2} sau ${RETRY_DELAY / 1000}s`);
      setTimeout(() => assignOrderToNearestShipper(orderId, retryCount + 1), RETRY_DELAY);
      return;
    }

    // Chọn shipper và gửi thông báo
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
        },
      });
      console.log(`[Assign] Đã gửi thông báo tới shipper ${shipper._id}`);
    }

    // Đợi 30 giây để kiểm tra phản hồi từ shipper
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
