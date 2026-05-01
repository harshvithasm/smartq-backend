// routes/aiRoutes.js — Phase 4: AI endpoints
const express = require('express');
const router  = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { predictWait, getModelStatus: getWaitModelStatus } = require('../ai/waitTimePredictor');
const { getModelStatus: getNoShowModelStatus }            = require('../ai/noShowPredictor');
const { getAssignmentInsights }                           = require('../ai/smartAssignment');
const { getDomainHealth, buildAlerts }                    = require('../ai/congestionMonitor');

// GET /api/ai/models — status of all trained models (admin)
router.get('/models', protect, (req, res) => {
  res.json({
    success: true,
    waitPredictor:   getWaitModelStatus(),
    noShowPredictor: getNoShowModelStatus(),
  });
});

// POST /api/ai/predict-wait — predict wait for given context
router.post('/predict-wait', async (req, res) => {
  try {
    const { domain, serviceType, priority, queuePosition } = req.body;
    if (!domain || !serviceType) return res.status(400).json({ message: 'domain and serviceType required' });
    const result = await predictWait(domain, serviceType, priority || 0, queuePosition || 1);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/ai/assignment/:domain — counter assignment insights
router.get('/assignment/:domain', protect, async (req, res) => {
  try {
    const insights = await getAssignmentInsights(req.params.domain);
    res.json({ success: true, ...insights });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/ai/health/:domain — congestion health check (admin)
router.get('/health/:domain', protect, async (req, res) => {
  try {
    const health = await getDomainHealth(req.params.domain);
    const alerts = buildAlerts(health);
    res.json({ success: true, health, alerts, isHealthy: alerts.length === 0 });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
