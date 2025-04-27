// controllers/orderController.js
const Order = require('../models/Order');
const User  = require('../models/User');
const sendPushNotification = require('../utils/sendPushNotification');

exports.createOrder = async (req, res) => {
  try {
    const { items, total, customerInfo } = req.body;
    const newOrder = new Order({
      items,
      total,
      customer: customerInfo,
      user: req.user._id,
      status: 'pending'
    });
    const saved = await newOrder.save();

    // push to admins
    const admins = await User.find({ isAdmin:true, expoPushToken:{$exists:true} });
    for(const a of admins){
      await sendPushNotification(
        a.expoPushToken,
        '🛒 Đơn hàng mới',
        `Người dùng ${req.user.name} vừa đặt. Tổng: ${total.toLocaleString()}đ`
      );
    }

    res.status(201).json({ success:true, order:saved });
  } catch(err) {
    console.error('Lỗi tạo đơn hàng:',err);
    res.status(500).json({ message:'Lỗi tạo đơn hàng', error:err.message });
  }
};

exports.getMyOrders = async (req, res) => {
  try {
    const { status } = req.query;
    const q = { user:req.user._id };
    if(status) q.status = status;
    const orders = await Order.find(q).sort({ createdAt:-1 });
    res.json({ data:orders });
  } catch(err){
    res.status(500).json({ message:'Lỗi lấy đơn hàng cá nhân', error:err.message });
  }
};

exports.getAllOrders = async (req, res) => {
  try {
    const { status } = req.query;
    const q = {};
    if(status) q.status = status;
    const orders = await Order.find(q).populate('user','name email').sort({ createdAt:-1 });
    res.json({ data:orders });
  } catch(err){
    res.status(500).json({ message:'Lỗi lấy đơn hàng', error:err.message });
  }
};

exports.updateOrderStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const order = await Order.findById(req.params.id);
    if(!order) return res.status(404).json({ message:'Không tìm thấy đơn hàng' });
    order.status = status;
    await order.save();
    res.json({ success:true, order });
  } catch(err) {
    console.error('Lỗi cập nhật đơn hàng:',err);
    res.status(500).json({ message:'Lỗi cập nhật trạng thái', error:err.message });
  }
};
