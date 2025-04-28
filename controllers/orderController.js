// controllers/orderController.js
exports.createOrder = async (req, res) => {
  console.log('[DEBUG] req.body:', req.body);
  try {
    const { items, total, phone, shippingAddress } = req.body;

    // Kiểm tra các trường bắt buộc
    if (!phone || !shippingAddress) {
      return res.status(400).json({ 
        message: 'Vui lòng cung cấp số điện thoại và địa chỉ giao hàng' 
      });
    }

    // Kiểm tra tên người dùng
    if (!req.user?.name) {
      return res.status(400).json({ 
        message: 'Thông tin người dùng không hợp lệ' 
      });
    }

    // Tạo đối tượng đơn hàng mới
    const newOrder = new Order({
      items,
      total,
      user: req.user._id,
      phone: phone.trim(),
      shippingAddress: shippingAddress.trim(),
      customerName: req.user.name,
      status: 'Chờ xác nhận'
    });

    // Lưu đơn hàng
    const savedOrder = await newOrder.save();

    // Gửi thông báo đến admin (giữ nguyên phần này)
    const admins = await User.find({ 
      isAdmin: true, 
      expoPushToken: { $exists: true, $ne: null } 
    });

    for (const admin of admins) {
      await sendPushNotification(
        admin.expoPushToken,
        '🛒 Có đơn hàng mới!',
        `Người dùng ${req.user.name} vừa đặt hàng\nSĐT: ${phone}\nĐịa chỉ: ${shippingAddress}\nTổng: ${total.toLocaleString()}đ`
      );
    }

    res.status(201).json(savedOrder);

  } catch (err) {
    console.error('Lỗi tạo đơn hàng:', err);

    // Xử lý lỗi validation
    if (err.name === 'ValidationError') {
      const errors = Object.values(err.errors).map(e => e.message);
      return res.status(400).json({ 
        message: 'Lỗi xác thực dữ liệu', 
        errors 
      });
    }

    res.status(500).json({ 
      message: 'Lỗi server khi tạo đơn hàng', 
      error: err.message 
    });
  }
};
