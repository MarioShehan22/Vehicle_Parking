const mongoose = require("mongoose");
let parkingData = {
    availableSpaces: 0,
    totalSpaces: 0,
    totalEntries: 0,
    totalExits: 0,
    barrierOpen: false,
    wifiConnected: false,
    uptime: 0,
    occupancyRate: 0,
    lastUpdate: null,
    slots: [],
    spaces: [],
    recentEvents: []
};

const ParkingSchema = new mongoose.Schema({
    availableSpaces: Number,
    totalSpaces: Number,
    totalEntries: Number,
    totalExits: Number,
    barrierOpen: Boolean,
    wifiConnected: Boolean,
    uptime: Number,
    occupancyRate: Number,
    lastUpdate: Date,
    slots: Array,
    spaces: Array,
    recentEvents: Array
});

const ParkingModel = mongoose.model("Parking", ParkingSchema);

module.exports = { parkingData, ParkingModel };