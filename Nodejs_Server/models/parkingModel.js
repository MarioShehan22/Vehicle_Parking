const mongoose = require('mongoose');

const SpaceSchema = new mongoose.Schema({
    id: Number,
    occupied: Boolean,
    status: String
});

const EventSchema = new mongoose.Schema({
    type: String,
    timestamp: String,
    data: mongoose.Schema.Types.Mixed
}, { _id: false });

const ParkingSchema = new mongoose.Schema({
    totalSpaces: Number,
    availableSpaces: Number,
    occupancyRate: Number,
    totalEntries: Number,
    totalExits: Number,
    barrierOpen: Boolean,
    wifiConnected: Boolean,
    uptime: Number,
    lastUpdate: Date,
    spaces: [SpaceSchema],
    recentEvents: [EventSchema]
});

const ParkingModel = mongoose.model('Parking', ParkingSchema);

module.exports = ParkingModel;
