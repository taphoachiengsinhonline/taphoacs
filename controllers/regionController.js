// File: backend/controllers/regionController.js

const Region = require('../models/Region');

// Lấy tất cả các khu vực
exports.getAllRegions = async (req, res) => {
    try {
        const regions = await Region.find({}).sort({ name: 1 });
        res.status(200).json(regions);
    } catch (error) {
        res.status(500).json({ message: "Lỗi server khi lấy danh sách khu vực." });
    }
};

// Tạo một khu vực mới
exports.createRegion = async (req, res) => {
    try {
        const { name, coordinates, radius } = req.body;
        if (!name || !coordinates || !radius) {
            return res.status(400).json({ message: 'Vui lòng điền đầy đủ tên, tọa độ và bán kính.' });
        }

        const newRegion = new Region({
            name,
            center: { type: 'Point', coordinates },
            radius
        });
        await newRegion.save();
        res.status(201).json(newRegion);
    } catch (error) {
        if (error.code === 11000) { // Lỗi trùng tên
            return res.status(400).json({ message: 'Tên khu vực này đã tồn tại.' });
        }
        res.status(500).json({ message: 'Lỗi server khi tạo khu vực.' });
    }
};

// Cập nhật một khu vực
exports.updateRegion = async (req, res) => {
    try {
        const { regionId } = req.params;
        const { name, coordinates, radius, isActive } = req.body;
        
        const updateData = { name, radius, isActive };
        if (coordinates) {
            updateData.center = { type: 'Point', coordinates };
        }

        const updatedRegion = await Region.findByIdAndUpdate(regionId, updateData, { new: true, runValidators: true });
        if (!updatedRegion) {
            return res.status(404).json({ message: 'Không tìm thấy khu vực.' });
        }
        res.status(200).json(updatedRegion);
    } catch (error) {
        res.status(500).json({ message: 'Lỗi server khi cập nhật khu vực.' });
    }
};

// Xóa một khu vực
exports.deleteRegion = async (req, res) => {
    try {
        const { regionId } = req.params;
        // (Thêm) Kiểm tra xem có user nào đang thuộc khu vực này không
        // const User = require('../models/User');
        // const userCount = await User.countDocuments({ region: regionId });
        // if (userCount > 0) {
        //     return res.status(400).json({ message: `Không thể xóa vì vẫn còn ${userCount} người dùng trong khu vực này.` });
        // }
        
        const deleted = await Region.findByIdAndDelete(regionId);
        if (!deleted) {
            return res.status(404).json({ message: 'Không tìm thấy khu vực để xóa.' });
        }
        res.status(200).json({ message: 'Đã xóa khu vực thành công.' });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi server khi xóa khu vực.' });
    }
};
