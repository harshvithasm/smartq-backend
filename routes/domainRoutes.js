// routes/domainRoutes.js
const express = require('express');
const router = express.Router();
const DomainConfig = require('../models/DomainConfig');

// Seed default domain configs (run once)
const defaultDomains = [
  {
    domain: 'hospital',
    label: 'Hospital',
    icon: '🏥',
    color: '#22c9a5',
    tokenPrefix: 'H',
    counterLabel: 'Counter',
    serviceTypes: ['OPD – General', 'OPD – Cardiology', 'OPD – Ortho', 'Radiology', 'Pharmacy', 'Emergency', 'Lab / Blood Test'],
    priorityEnabled: true,
    avgServiceTime: 10,
  },
  {
    domain: 'bank',
    label: 'Bank',
    icon: '🏦',
    color: '#4ea8e8',
    tokenPrefix: 'B',
    counterLabel: 'Teller',
    serviceTypes: ['Cash Deposit', 'Cash Withdrawal', 'Account Opening', 'Loan Inquiry', 'Cheque', 'FD / RD', 'General Inquiry'],
    priorityEnabled: true,
    avgServiceTime: 7,
  },
  {
    domain: 'college',
    label: 'College',
    icon: '🎓',
    color: '#f59e0b',
    tokenPrefix: 'C',
    counterLabel: 'Window',
    serviceTypes: ['TC / Migration', 'Fee Payment', 'Bonafide Certificate', 'Result Query', 'Scholarship', 'Hostel Related', 'Exam Form'],
    priorityEnabled: true,
    avgServiceTime: 8,
  },
  {
    domain: 'foodcourt',
    label: 'Food Court',
    icon: '🍽️',
    color: '#f97316',
    tokenPrefix: 'F',
    counterLabel: 'Stall',
    serviceTypes: ['North Indian', 'South Indian', 'Chinese', 'Beverages', 'Snacks', 'Desserts', 'Fast Food'],
    priorityEnabled: false,
    avgServiceTime: 8,
  },
  {
    domain: 'retail',
    label: 'Retail',
    icon: '🛒',
    color: '#ec4899',
    tokenPrefix: 'R',
    counterLabel: 'Billing',
    serviceTypes: ['Express Checkout (≤5 items)', 'Regular Checkout', 'Electronics Billing', 'Customer Service', 'Returns / Exchange', 'Online Order Pickup'],
    priorityEnabled: true,
    avgServiceTime: 5,
  },
];

// GET all domain configs
router.get('/', async (req, res) => {
  try {
    const domains = await DomainConfig.find();
    res.json({ success: true, domains });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET single domain config
router.get('/:domain', async (req, res) => {
  try {
    const config = await DomainConfig.findOne({ domain: req.params.domain });
    if (!config) return res.status(404).json({ message: 'Domain not found' });
    res.json({ success: true, config });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/domains/seed — run once to populate DB
router.post('/seed', async (req, res) => {
  try {
    await DomainConfig.deleteMany({});
    const inserted = await DomainConfig.insertMany(defaultDomains);
    res.json({ success: true, message: `Seeded ${inserted.length} domains` });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
