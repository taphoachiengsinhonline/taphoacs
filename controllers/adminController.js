const User = require('../models/User');
const Remittance = require('../models/Remittance');
const Order = require('../models/Order');
const moment = require('moment-timezone');

// API để lấy danh sách tất cả các shipper và công nợ của họ
exports.getShipperDebts = async (req, res) => {
    try {
        const shippers = await User.find({ role: 'shipper' }).select('name phone').lean();
        
        const debtData = await Promise.all(shippers.map(async (shipper) => {
            const [orders, remittances] = await Promise.all([
                Order.find({ shipper: shipper._id, status: 'Đã giao' }).lean(),
                Remittance.find({ shipper: shipper._id }).lean()
            ]);
            
            const totalCOD = orders.reduce((sum, order) => sum + (order.total || 0), 0);
            const totalRemitted = remittances.reduce((sum, remit) => sum + remit.amount, 0);
            const totalDebt = totalCOD - totalRemitted;

            return {
                ...shipper,
                totalDebt: totalDebt > 0 ? totalDebt : 0,
            };
        }));
        
        // Sắp xếp shipper có nợ cao nhất lên đầu
        debtData.sort((a, b) => b.totalDebt - a.totalDebt);

        res.status(200).json(debtData);
    } catch (error) {
        console.error("[getShipperDebts] Lỗi:", error);
        res.status(500).json({ message: "Lỗi server" });
    }
};

// API lấy chi tiết các lần nộp tiền của một shipper
exports.getShipperRemittances = async (req, res) => {
    try {
        const { shipperId } = req.params;
        const remittances = await Remittance.find({ shipper: shipperId }).sort({ remittanceDate: -1 });
        res.status(200).json(remittances);
    } catch (error) {
        console.error("[getShipperRemittances] Lỗi:", error);
        res.status(500).json({ message: "Lỗi server" });
    }
};

// API để Admin xác nhận một lần nộp tiền
// (Trong thực tế, hàm này cần phức tạp hơn, có thể thêm trường status vào Remittance)
// Ở đây ta làm đơn giản là chỉ để tham khảo
exports.confirmShipperRemittance = async (req, res) => {
    try {
        const { remittanceId } = req.params;
        // Logic ví dụ: cập nhật một trường `isVerified: true` vào transaction
        // await Remittance.updateOne( ... );
        res.status(200).json({ message: "Xác nhận thành công (chức năng ví dụ)." });
    } catch (error) {
        //...
    }
};
