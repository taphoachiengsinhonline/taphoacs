const ShippingFee = require('../models/ShippingFee');

const initShippingFees = async () => {
  try {
    const exists = await ShippingFee.findOne({});
    if (!exists) {
      await ShippingFee.create({
        ranges: [
          { maxDistance: 3, fee: 10000 },
          { maxDistance: 5, fee: 15000 },
          { maxDistance: 7, fee: 20000 },
          { maxDistance: 10, fee: 32000 }
        ],
        freeShipThreshold: 500000
      });
      console.log('✅ Khởi tạo phí ship mặc định');
    }
  } catch (err) {
    console.error('❌ Lỗi khởi tạo phí ship:', err);
  }
};

module.exports = { initShippingFees };
