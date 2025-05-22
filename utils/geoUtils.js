const User = require('../models/User');

exports.findNearestStaff = async (orderLocation) => {
  return await User.aggregate([
    {
      $geoNear: {
        near: {
          type: 'Point',
          coordinates: orderLocation
        },
        distanceField: 'distance',
        maxDistance: 5000, // 5km
        query: {
          'deliveryInfo.status': 'available',
          role: 'staff'
        },
        spherical: true
      }
    },
    { $limit: 5 }
  ]);
};

// Hàm tính khoảng cách giữa hai điểm tọa độ (Haversine formula)
exports.calculateDistance = (coord1, coord2) => {
  const [lng1, lat1] = coord1;
  const [lng2, lat2] = coord2;

  const toRad = (value) => (value * Math.PI) / 180;
  const R = 6371; // Bán kính Trái Đất (km)

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c; // Khoảng cách (km)

  return parseFloat(distance.toFixed(2));
};

module.exports = {
  findNearestStaff: exports.findNearestStaff,
  calculateDistance: exports.calculateDistance
};
