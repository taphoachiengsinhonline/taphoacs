const User = require('../models/User');

const updateLocation = async (req, res) => {
  try {
    const userId = req.user.id;
    const { latitude, longitude } = req.body;

    if (!latitude || !longitude) {
      return res.status(400).json({ message: 'Thiếu tọa độ location' });
    }

    await User.findByIdAndUpdate(userId, {
      location: {
        type: 'Point',
        coordinates: [longitude, latitude],
      },
    });

    res.json({ message: 'Cập nhật vị trí thành công' });
  } catch (error) {
    console.error('[UpdateLocation] Lỗi:', error);
    res.status(500).json({ message: 'Lỗi server' });
  }
};

module.exports = { ..., updateLocation };

