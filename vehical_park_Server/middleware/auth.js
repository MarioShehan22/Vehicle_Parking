const jwt = require('jsonwebtoken');

const auth=(req,res,next)=>{
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    console.log('Authorization header:', authHeader);
    console.log('Token:', token);

    if (!token) {
        return res.status(401).json({ message: 'token is required..' });
    }

    try {
        req.user = jwt.verify(token, process.env.JWT_SECRET);
        next();
    } catch (e) {
        console.log('JWT verification error:', e);
        res.status(403).json({ message: 'invalid or expired..' });
    }
}


module.exports = {
    auth,
}
