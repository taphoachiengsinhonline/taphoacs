// controllers/orderController.js
exports.createOrder = async (req, res) => {
  console.log('[DEBUG] === BẮT ĐẦU TẠO ĐƠN HÀNG ===');
  try {
    // Log toàn bộ thông tin request
    console.log('[DEBUG] Headers:', JSON.stringify(req.headers, null, 2));
    console.log('[DEBUG] Request Body:', JSON.stringify(req.body, null, 2));
    console.log('[DEBUG] Authenticated User:', JSON.stringify(req.user, null, 2));

    // Kiểm tra các trường bắt buộc
    if (!req.body) {
      console.error('[ERROR] Request body không tồn tại');
      return res.status(400).json({ message: 'Thiếu dữ liệu đơn hàng' });
    }

    const { items, total, phone, shippingAddress } = req.body;
    
    // Validate input
    const missingFields = [];
    if (!items) missingFields.push('items');
    if (!total) missingFields.push('total');
    if (!phone) missingFields.push('phone');
    if (!shippingAddress) missingFields.push('shippingAddress');
    
    if (missingFields.length > 0) {
      console.error('[ERROR] Thiếu trường bắt buộc:', missingFields);
      return res.status(400).json({
        message: 'Thiếu thông tin bắt buộc',
        missingFields,
        receivedData: {
          items: !!items,
          total: !!total,
          phone: !!phone,
          shippingAddress: !!shippingAddress
        }
      });
    }

    // Kiểm tra định dạng số điện thoại
    const phoneRegex = /^(0[3|5|7|8|9]|84[3|5|7|8|9]|\+84[3|5|7|8|9])+([0-9]{7,8})$/;
    if (!phoneRegex.test(phone)) {
      console.error('[ERROR] Số điện thoại không hợp lệ:', phone);
      return res.status(400).json({
        message: 'Số điện thoại không hợp lệ',
        example: '0912345678 hoặc +84912345678'
      });
    }

    // Kiểm tra thông tin người dùng
    if (!req.user) {
      console.error('[ERROR] Không tìm thấy thông tin người dùng');
      return res.status(401).json({ message: 'Chưa xác thực người dùng' });
    }

    if (!req.user.name) {
      console.error('[ERROR] Người dùng không có tên:', req.user);
      return res.status(400).json({ 
        message: 'Hồ sơ người dùng chưa hoàn thiện',
        solution: 'Vui lòng cập nhật tên trong hồ sơ cá nhân'
      });
    }

    // Tạo đối tượng đơn hàng
    const customerName = req.user.name || req.body.customerName || 'Khách hàng';
    const orderData = {
      items: items.map(item => ({
        productId: item.productId,
        name: item.name,
        quantity: item.quantity,
        price: item.price
      })),
      total: Number(total),
      user: req.user._id,
      phone: phone.toString().trim(),
      shippingAddress: shippingAddress.trim(),
      customerName: customerName.trim(),
      status: 'Chờ xác nhận'
    };

    console.log('[DEBUG] Dữ liệu đơn hàng chuẩn bị lưu:', JSON.stringify(orderData, null, 2));

    // Thử validate thủ công
    const newOrder = new Order(orderData);
    const validationError = newOrder.validateSync();
    
    if (validationError) {
      console.error('[VALIDATION ERROR] Lỗi validate:', validationError);
      const errors = Object.values(validationError.errors).map(e => ({
        field: e.path,
        message: e.message
      }));
      return res.status(400).json({
        message: 'Lỗi kiểm tra dữ liệu',
        errors
      });
    }

    // Lưu đơn hàng
    const savedOrder = await newOrder.save();
    console.log('[SUCCESS] Đã tạo đơn hàng thành công:', savedOrder._id);

    // Gửi thông báo đến admin (giữ nguyên chức năng gốc)
    try {
      const admins = await User.find({ 
        isAdmin: true, 
        expoPushToken: { $exists: true, $ne: null } 
      });

      console.log('[DEBUG] Tìm thấy', admins.length, 'admin để gửi thông báo');
      
      for (const admin of admins) {
        await sendPushNotification(
          admin.expoPushToken,
          '🛒 Có đơn hàng mới!',
          `Người dùng ${req.user.name} vừa đặt hàng\n` +
          `SĐT: ${phone}\n` +
          `Địa chỉ: ${shippingAddress}\n` +
          `Tổng: ${Number(total).toLocaleString()}đ`
        );
        console.log(`[NOTIFICATION] Đã gửi thông báo đến admin ${admin._id}`);
      }
    } catch (notifyError) {
      console.error('[WARNING] Lỗi gửi thông báo:', notifyError.message);
      // Không block response vì lỗi này
    }

    return res.status(201).json({
      success: true,
      orderId: savedOrder._id,
      customerName: savedOrder.customerName,
      total: savedOrder.total
    });

  } catch (err) {
    console.error('[FATAL ERROR] Lỗi hệ thống:', err);
    
    // Xử lý các loại lỗi đặc biệt
    if (err.name === 'CastError') {
      return res.status(400).json({
        message: 'Định dạng dữ liệu không hợp lệ',
        field: err.path,
        expectedType: err.kind
      });
    }

    if (err.name === 'ValidationError') {
      const errors = Object.values(err.errors).map(e => ({
        field: e.path,
        message: e.message
      }));
      return res.status(400).json({
        message: 'Lỗi xác thực dữ liệu',
        errors
      });
    }

    return res.status(500).json({
      message: 'Lỗi server nghiêm trọng',
      error: process.env.NODE_ENV === 'development' ? {
        message: err.message,
        stack: err.stack
      } : null
    });
  } finally {
    console.log('[DEBUG] === KẾT THÚC XỬ LÝ TẠO ĐƠN HÀNG ===\n');
  }
};
