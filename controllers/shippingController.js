const ShippingFee = require('../models/ShippingFee');

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
