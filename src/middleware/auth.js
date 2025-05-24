const jwt = require('jsonwebtoken');
const { UnauthorizedError } = require('../utils/errors');

const auth = (req, res, next) => {
  try {
    const authHeader = req.header('Authorization');
    
    if (!authHeader) {
      throw new UnauthorizedError('Authentication required');
    }

    const token = authHeader.replace('Bearer ', '');
    
    if (!token) {
      throw new UnauthorizedError('Authentication required');
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = decoded;
      next();
    } catch (error) {
      console.error('Token verification error:', error);
      throw new UnauthorizedError('Invalid authentication token');
    }
  } catch (error) {
    next(error);
  }
};

const isCyberCenter = (req, res, next) => {
  if (!req.user.is_cyber_center) {
    return next(new UnauthorizedError('Cyber center access required'));
  }
  next();
};

module.exports = {
  auth,
  isCyberCenter
}; 