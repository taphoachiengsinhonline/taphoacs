const ShippingFee = require('../models/ShippingFee');
const geolib = require('geolib');
const STORE_LOCATION = {
    latitude: 21.292453, // VD: Vị trí Hồ Gươm, Hà Nội
    longitude: 103.952944
};

exports.getShippingFees = async (req, res) => {
  try {
    const shippingFee = await ShippingFee.findOne({});
    if (!shippingFee) {
      return res.status(404).json({ message: 'Chưa thiết lập phí ship' });
    }
    res.json(shippingFee);
  } catch (err) {
    console.error('[getShippingFees] error:', err);
    res.status(500).json({ message: 'Lỗi server' });
  }
};

exports.updateShippingFees = async (req, res) => {
  try {
    const { ranges, freeShipThreshold } = req.body;
    if (!ranges || !Array.isArray(ranges) || ranges.length === 0) {
      return res.status(400).json({ message: 'Cần cung cấp bảng phí ship' });
    }
    if (freeShipThreshold < 0) {
      return res.status(400).json({ message: 'Ngưỡng free ship không hợp lệ' });
    }

    const shippingFee = await ShippingFee.findOneAndUpdate(
      {},
      { ranges, freeShipThreshold },
      { upsert: true, new: true }
    );
    res.json({ message: 'Cập nhật phí ship thành công', shippingFee });
  } catch (err) {
    console.error('[updateShippingFees] error:', err);
    res.status(500).json({ message: 'Lỗi server' });
  }
};




exports.calculateFeeForOrder = async (customerLocation, itemsTotal) => {
    // 1. Lấy cấu hình phí từ CSDL
    const feeConfig = await ShippingFee.findOne({});
    if (!feeConfig) {
        throw new Error("Chưa cấu hình phí vận chuyển.");
    }
    
    // 2. Tính khoảng cách
    const distanceInMeters = geolib.getDistance(
        STORE_LOCATION,
        { latitude: customerLocation.coordinates[1], longitude: customerLocation.coordinates[0] }
    );
    const distanceInKm = distanceInMeters / 1000;
    
    // 3. Tính phí ship thực tế (shippingFeeActual)
    let actualFee = 0;
    const ranges = feeConfig.ranges.sort((a, b) => a.maxDistance - b.maxDistance);
    const perKmFeeRange = ranges[ranges.length - 1];
    
    let foundFee = false;
    for (let i = 0; i < ranges.length - 1; i++) {
        if (distanceInKm <= ranges[i].maxDistance) {
            actualFee = ranges[i].fee;
            foundFee = true;
            break;
        }
    }
    if (!foundFee) {
        const lastFixedRange = ranges[ranges.length - 2];
        actualFee = lastFixedRange.fee;
        const extraDistance = distanceInKm - lastFixedRange.maxDistance;
        if (extraDistance > 0) {
            actualFee += extraDistance * perKmFeeRange.fee;
        }
    }
    actualFee = Math.round(actualFee / 1000) * 1000; // Làm tròn

    // 4. Tính phí ship khách trả (shippingFeeCustomerPaid)
    let customerFee = actualFee;
    if (feeConfig.freeShipThreshold > 0 && itemsTotal >= feeConfig.freeShipThreshold) {
        customerFee = 0;
    }

    // 5. Trả về cả hai giá trị
    return {
        shippingFeeActual: actualFee,
        shippingFeeCustomerPaid: customerFee
    };
};





exports.getFreeShipThreshold = async (req, res) => {
  try {
    const shippingFee = await ShippingFee.findOne({});
    if (!shippingFee) {
      return res.status(404).json({ message: 'Chưa thiết lập ngưỡng free ship' });
    }
    res.json({ threshold: shippingFee.freeShipThreshold });
  } catch (err) {
    console.error('[getFreeShipThreshold] error:', err);
    res.status(500).json({ message: 'Lỗi server' });
  }
};

exports.updateFreeShipThreshold = async (req, res) => {
  try {
    const { threshold } = req.body;
    if (threshold < 0) {
      return res.status(400).json({ message: 'Ngưỡng free ship không hợp lệ' });
    }

    const shippingFee = await ShippingFee.findOneAndUpdate(
      {},
      { freeShipThreshold: threshold },
      { upsert: true, new: true }
    );
    res.json({ message: 'Cập nhật ngưỡng free ship thành công', threshold: shippingFee.freeShipThreshold });
  } catch (err) {
    console.error('[updateFreeShipThreshold] error:', err);
    res.status(500).json({ message: 'Lỗi server' });
  }
};
