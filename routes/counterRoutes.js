// routes/counterRoutes.js
const express = require('express');
const router  = express.Router();
const Counter = require('../models/Counter');
const { protect } = require('../middleware/authMiddleware');

// GET /api/counters/:domain — public (display board needs this)
router.get('/:domain', async (req, res) => {
  try {
    const counters = await Counter.find({ domain: req.params.domain }).sort({ name: 1 });
    res.json({ success: true, counters });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/counters — create counter (admin only)
router.post('/', protect, async (req, res) => {
  try {
    const { name, domain, staffName, serviceTypes, avgServiceTime } = req.body;
    if (!name || !domain) return res.status(400).json({ message: 'name and domain are required' });
    const counter = await Counter.create({ name, domain, staffName: staffName || '', serviceTypes: serviceTypes || [], avgServiceTime: avgServiceTime || 5 });
    const io = req.app.get('io');
    io.to(domain).emit('counters_updated');
    res.status(201).json({ success: true, counter });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// PATCH /api/counters/:id — edit counter (admin only)
router.patch('/:id', protect, async (req, res) => {
  try {
    const { name, staffName, serviceTypes, avgServiceTime } = req.body;
    const counter = await Counter.findByIdAndUpdate(req.params.id, { name, staffName, serviceTypes, avgServiceTime }, { new: true, runValidators: true });
    if (!counter) return res.status(404).json({ message: 'Counter not found' });
    const io = req.app.get('io');
    io.to(counter.domain).emit('counters_updated');
    res.json({ success: true, counter });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PATCH /api/counters/:id/toggle — open/close (admin only)
router.patch('/:id/toggle', protect, async (req, res) => {
  try {
    const counter = await Counter.findById(req.params.id);
    if (!counter) return res.status(404).json({ message: 'Counter not found' });
    counter.isOpen = !counter.isOpen;
    await counter.save();
    const io = req.app.get('io');
    io.to(counter.domain).emit('counters_updated');
    res.json({ success: true, counter });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/counters/:id/call-next (admin only)
router.post('/:id/call-next', protect, async (req, res) => {
  try {
    const counter = await Counter.findById(req.params.id);
    if (!counter) return res.status(404).json({ message: 'Counter not found' });
    if (!counter.isOpen) return res.status(400).json({ message: 'Counter is closed' });
    const queueController = require('../controllers/queueController');
    const result = await queueController.callNextToken(counter.domain, req.params.id);
    if (!result) return res.json({ success: false, message: 'No tokens waiting' });
    const io = req.app.get('io');
    io.to(counter.domain).emit('token_called', result);
    io.to(counter.domain).emit('queue_updated');
    res.json({ success: true, called: result });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/counters/:id (admin only)
router.delete('/:id', protect, async (req, res) => {
  try {
    const counter = await Counter.findByIdAndDelete(req.params.id);
    if (!counter) return res.status(404).json({ message: 'Counter not found' });
    const io = req.app.get('io');
    io.to(counter.domain).emit('counters_updated');
    res.json({ success: true, message: 'Counter deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
