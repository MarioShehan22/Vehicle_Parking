const express =  require("express") ;
const userController = require("../controllers/userController");
const auth = require("../middleware/auth.js");
const router = express.Router();

router.post('/sign-up',userController.register);
router.post('/login',userController.login);
router.get('/find-all',userController.findAll);

module.exports = router;

