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
