// routes/authRoutes.js
const express = require('express');
const router  = express.Router();
const Admin   = require('../models/Admin');
const { protect, signToken } = require('../middleware/authMiddleware');

// ── POST /api/auth/login ─────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    // Find admin (include password for comparison)
    const admin = await Admin.findOne({ email: email.toLowerCase() }).select('+password');

    if (!admin || !admin.isActive) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const isMatch = await admin.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Update last login
    admin.lastLogin = new Date();
    await admin.save({ validateBeforeSave: false });

    const token = signToken(admin._id);

    return res.json({
      success: true,
      token,
      admin: {
        _id:      admin._id,
        name:     admin.name,
        email:    admin.email,
        role:     admin.role,
        domains:  admin.domains,
        lastLogin: admin.lastLogin,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: err.message });
  }
});

// ── GET /api/auth/me ─────────────────────────────────────────────
router.get('/me', protect, (req, res) => {
  res.json({ success: true, admin: req.admin });
});

// ── PATCH /api/auth/change-password ──────────────────────────────
router.patch('/change-password', protect, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Both currentPassword and newPassword are required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ message: 'New password must be at least 6 characters' });
    }

    const admin = await Admin.findById(req.admin._id).select('+password');
    const isMatch = await admin.comparePassword(currentPassword);

    if (!isMatch) {
      return res.status(401).json({ message: 'Current password is incorrect' });
    }

    admin.password = newPassword; // pre-save hook will hash it
    await admin.save();

    res.json({ success: true, message: 'Password updated successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── GET /api/auth/admins (superadmin only) ────────────────────────
const { superOnly } = require('../middleware/authMiddleware');

router.get('/admins', protect, superOnly, async (req, res) => {
  try {
    const admins = await Admin.find().select('-password').sort({ createdAt: -1 });
    res.json({ success: true, admins });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── POST /api/auth/admins — create admin (superadmin only) ────────
router.post('/admins', protect, superOnly, async (req, res) => {
  try {
    const { name, email, password, role, domains } = req.body;
    const admin = await Admin.create({ name, email, password, role, domains });
    res.status(201).json({ success: true, admin });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ message: 'Email already in use' });
    }
    res.status(400).json({ message: err.message });
  }
});

module.exports = router;
