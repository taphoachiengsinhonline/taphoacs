// middlewares/isStaffMiddleware.js
exports.isStaffMiddleware = (req, res, next) => {
  if (req.user.role !== 'staff') {
    return res.status(403).json({
      message: 'Yêu cầu quyền nhân viên giao hàng'
    });
  }
  next();
};
