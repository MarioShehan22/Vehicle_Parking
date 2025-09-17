const mongoose = require('mongoose');

const ParkingSessionSchema = new mongoose.Schema(
    {
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        cardId: { type: String, required: true, index: true },
        vehicleNumber: { type: String },
        slotId: { type: Number, default: null },
        entryTime: { type: Date, required: true },
        exitTime: { type: Date, default: null },
        durationSeconds: { type: Number, default: null },
        status: { type: String, enum: ['open', 'closed'], default: 'open', index: true },
    },
    { timestamps: true }
);

ParkingSessionSchema.index({ cardId: 1, status: 1 });

module.exports = mongoose.model("ParkingSession", ParkingSessionSchema);

