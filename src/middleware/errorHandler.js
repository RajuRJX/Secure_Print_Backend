const { BadRequestError, UnauthorizedError } = require('../utils/errors');

const errorHandler = (err, req, res, next) => {
  console.error(err);

  if (err instanceof BadRequestError) {
    return res.status(400).json({ message: err.message });
  }

  if (err instanceof UnauthorizedError) {
    return res.status(401).json({ message: err.message });
  }

  // Handle validation errors
  if (err.name === 'ValidationError') {
    return res.status(400).json({ message: err.message });
  }

  // Handle JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ message: 'Invalid token' });
  }

  // Default error
  res.status(500).json({ message: 'Internal server error' });
};

module.exports = { errorHandler }; 