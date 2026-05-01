// middleware/authMiddleware.js
const jwt   = require('jsonwebtoken');
const Admin = require('../models/Admin');

const JWT_SECRET = process.env.JWT_SECRET || 'smartq_dev_secret_change_in_prod';

// Protect: verifies JWT, attaches admin to req
exports.protect = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Not authorised — no token' });
    }

    const token = authHeader.split(' ')[1];
    let decoded;

    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ message: 'Token invalid or expired' });
    }

    const admin = await Admin.findById(decoded.id).select('-password');
    if (!admin || !admin.isActive) {
      return res.status(401).json({ message: 'Admin not found or deactivated' });
    }

    req.admin = admin;
    next();
  } catch (err) {
    console.error('authMiddleware error:', err);
    res.status(500).json({ message: 'Server error in auth' });
  }
};

// Restrict to superadmin only
exports.superOnly = (req, res, next) => {
  if (req.admin?.role !== 'superadmin') {
    return res.status(403).json({ message: 'Superadmin access required' });
  }
  next();
};

// Helper used in routes: generate a signed JWT
exports.signToken = (adminId) => {
  return jwt.sign({ id: adminId }, JWT_SECRET, { expiresIn: '7d' });
};
