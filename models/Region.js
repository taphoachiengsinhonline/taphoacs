// File: backend/models/Region.js
const mongoose = require('mongoose');

const regionSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    center: { // Tọa độ trung tâm của khu vực
        type: {
            type: String,
            enum: ['Point'],
            default: 'Point'
        },
        coordinates: {
            type: [Number], // [longitude, latitude]
            required: true
        }
    },
    radius: { // Bán kính hoạt động tính bằng mét
        type: Number,
        required: true,
        default: 10000 // Mặc định 10km
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, { timestamps: true });

regionSchema.index({ center: '2dsphere' });

module.exports = mongoose.model('Region', regionSchema);
