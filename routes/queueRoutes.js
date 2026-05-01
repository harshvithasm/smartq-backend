// routes/queueRoutes.js — Phase 3
const express  = require('express');
const router   = express.Router();
const qc       = require('../controllers/queueController');
const { protect } = require('../middleware/authMiddleware');

// Public — customers use these
router.post('/join',                       qc.joinQueue);
router.get('/:domain',                     qc.getQueue);
router.get('/:domain/stats/summary',       qc.getStats);
router.get('/:domain/priority-rules',      qc.getDomainRules);  // Phase 3 new
router.get('/token/:id',                   qc.getTokenStatus);
router.patch('/token/:id/rate',            qc.submitRating);

// Admin only
router.patch('/token/:id/serve', protect,  qc.markServedHTTP);
router.patch('/token/:id/skip',  protect,  qc.skipToken);

module.exports = router;
