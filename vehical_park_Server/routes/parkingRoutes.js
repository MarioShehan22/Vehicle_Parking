const express = require('express');
const router = express.Router();
const parkingController = require('../controllers/parkingController');

router.get('/status', parkingController.getStatus);
router.get('/events', parkingController.getEvents);
router.post('/command', parkingController.sendCommand);
router.get('/session', parkingController.getParkingSession);
router.get('/user', parkingController.getUsers);

module.exports = router;