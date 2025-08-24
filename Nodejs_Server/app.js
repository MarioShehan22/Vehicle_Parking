const express = require('express');
const mongoose = require('mongoose');
const errorHandler = require('./middleware/errorHandler');
require('dotenv').config();
const cors = require('cors');

const parkingRoutes = require('./routes/parkingRoutes');
const userRoutes = require('./routes/userRoutes');

const app = express();
app.use(cors());

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Connect to MongoDB
mongoose.connect('mongodb://localhost:27017/parking_system', {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
    .then(() => console.log('✅ Connected to MongoDB'))
    .catch(err => {
        console.error('❌ MongoDB connection error:', err);
        process.exit(1);
    });

// Routes
app.use('/api', parkingRoutes);
app.use('/users', userRoutes);

// Error handler
app.use(errorHandler);

module.exports = app;
