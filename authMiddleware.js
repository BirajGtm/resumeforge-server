// server/authMiddleware.js
const admin = require('firebase-admin');

const authMiddleware = async (req, res, next) => {
  const { authorization } = req.headers;

  if (!authorization || !authorization.startsWith('Bearer ')) {
    return res.status(401).send({ message: 'Unauthorized: No token provided.' });
  }

  const idToken = authorization.split('Bearer ')[1];

  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    // Attach user info to the request object
    req.user = decodedToken; 
    next(); // Token is valid, proceed to the actual route handler
  } catch (error) {
    console.error('Error while verifying Firebase ID token:', error);
    res.status(403).send({ message: 'Unauthorized: Invalid token.' });
  }
};

module.exports = authMiddleware;