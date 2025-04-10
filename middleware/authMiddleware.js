exports.isAdminMiddleware = (req, res, next) => {
  const user = req.user; // assume đã gán user từ token hoặc session
  if (!user || !user.isAdmin) {
    return res.status(403).json({ message: 'Chỉ admin mới có quyền thực hiện thao tác này.' });
  }
  next();
};

