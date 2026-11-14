const jwt = require('jsonwebtoken');

 function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    const err = new Error('Please sign in');
    err.status = 401;
    return next(err);
  }
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (e) {
    const err = new Error(e.name === 'TokenExpiredError' ? 'Your session expired. Please sign in again.' : 'Invalid session. Please sign in again.');
    err.status = 401;
    next(err);
  }
};

module.exports = requireAuth;
