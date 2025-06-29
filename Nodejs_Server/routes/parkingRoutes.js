const express = require('express');
const router = express.Router();
const parkingController = require('../controllers/parkingController');

router.get('/status', parkingController.getStatus);
router.get('/events', parkingController.getEvents);
router.post('/command', parkingController.sendCommand);

module.exports = router;
