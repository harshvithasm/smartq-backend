// config/domainPriorityRules.js
// ─────────────────────────────────────────────────────────────────
// Phase 3: Multi-Domain Priority Rules Engine
// Each domain has its own scoring logic and priority categories.
// Priority score: higher = served sooner.
// ─────────────────────────────────────────────────────────────────

const PRIORITY_RULES = {
  // ──────────────────────────── HOSPITAL ──────────────────────────
  hospital: {
    label: 'Hospital',
    categories: [
      { key: 'emergency',   label: 'Emergency / Critical',  score: 100, badge: '🚨', color: '#ef4444', description: 'Life-threatening condition' },
      { key: 'senior',      label: 'Senior Citizen (60+)',  score: 50,  badge: '👴', color: '#f59e0b', description: 'Age 60 and above' },
      { key: 'disabled',    label: 'Differently Abled',     score: 45,  badge: '♿', color: '#8b5cf6', description: 'Physical disability' },
      { key: 'pregnant',    label: 'Pregnant / Infant',     score: 40,  badge: '🤰', color: '#ec4899', description: 'Pregnant woman or infant patient' },
      { key: 'normal',      label: 'General / Normal',      score: 0,   badge: '👤', color: '#6b7280', description: 'Regular patient' },
    ],
    // Which service types trigger auto-priority boost
    urgentServices: ['Emergency'],
    serviceTimeMap: {
      'OPD – General':    10,
      'OPD – Cardiology': 15,
      'OPD – Ortho':      12,
      'Radiology':         8,
      'Pharmacy':          5,
      'Emergency':        20,
      'Lab / Blood Test':  7,
    },
  },

  // ──────────────────────────── BANK ───────────────────────────────
  bank: {
    label: 'Bank',
    categories: [
      { key: 'vip',      label: 'Premium / VIP Customer', score: 80,  badge: '⭐', color: '#f59e0b', description: 'Premium account holder' },
      { key: 'senior',   label: 'Senior Citizen (60+)',   score: 50,  badge: '👴', color: '#8b5cf6', description: 'Age 60 and above' },
      { key: 'disabled', label: 'Differently Abled',      score: 40,  badge: '♿', color: '#6366f1', description: 'Physical disability' },
      { key: 'normal',   label: 'Regular Customer',       score: 0,   badge: '👤', color: '#6b7280', description: 'Standard account holder' },
    ],
    urgentServices: [],
    serviceTimeMap: {
      'Cash Deposit':    5,
      'Cash Withdrawal': 5,
      'Account Opening': 20,
      'Loan Inquiry':    15,
      'Cheque':          7,
      'FD / RD':         10,
      'General Inquiry': 8,
    },
  },

  // ──────────────────────────── COLLEGE ────────────────────────────
  college: {
    label: 'College',
    categories: [
      { key: 'faculty',  label: 'Faculty / Staff',     score: 60, badge: '👨‍🏫', color: '#22c9a5', description: 'College employee' },
      { key: 'disabled', label: 'Differently Abled',   score: 45, badge: '♿', color: '#8b5cf6', description: 'Physical disability' },
      { key: 'senior',   label: 'Senior Student (PG)', score: 10, badge: '🎓', color: '#f59e0b', description: 'Post-graduate student' },
      { key: 'normal',   label: 'UG Student',          score: 0,  badge: '📚', color: '#6b7280', description: 'Undergraduate student' },
    ],
    urgentServices: [],
    serviceTimeMap: {
      'TC / Migration':       10,
      'Fee Payment':           5,
      'Bonafide Certificate': 15,
      'Result Query':          8,
      'Scholarship':          12,
      'Hostel Related':        8,
      'Exam Form':             6,
    },
  },

  // ──────────────────────────── FOOD COURT ─────────────────────────
  foodcourt: {
    label: 'Food Court',
    categories: [
      { key: 'preorder', label: 'Pre-Order / App Order', score: 20, badge: '📱', color: '#22c9a5', description: 'Ordered via app in advance' },
      { key: 'normal',   label: 'Walk-in Customer',      score: 0,  badge: '🚶', color: '#6b7280', description: 'Regular walk-in order' },
    ],
    urgentServices: [],
    serviceTimeMap: {
      'North Indian': 8,
      'South Indian': 7,
      'Chinese':      8,
      'Beverages':    3,
      'Snacks':       4,
      'Desserts':     4,
      'Fast Food':    5,
    },
  },

  // ──────────────────────────── RETAIL ─────────────────────────────
  retail: {
    label: 'Retail',
    categories: [
      { key: 'staff',    label: 'Staff / Employee',        score: 70, badge: '🏷️', color: '#22c9a5', description: 'Store staff purchase' },
      { key: 'senior',   label: 'Senior Citizen (60+)',    score: 50, badge: '👴', color: '#f59e0b', description: 'Age 60 and above' },
      { key: 'disabled', label: 'Differently Abled',       score: 40, badge: '♿', color: '#8b5cf6', description: 'Physical disability' },
      { key: 'express',  label: 'Express (≤5 items)',       score: 15, badge: '⚡', color: '#4ea8e8', description: 'Fast checkout eligible' },
      { key: 'normal',   label: 'Regular Customer',         score: 0,  badge: '🛒', color: '#6b7280', description: 'Standard checkout' },
    ],
    urgentServices: [],
    serviceTimeMap: {
      'Express Checkout (≤5 items)': 2,
      'Regular Checkout':            6,
      'Electronics Billing':        10,
      'Customer Service':           12,
      'Returns / Exchange':          8,
      'Online Order Pickup':         4,
    },
  },
};

/**
 * Get priority score for a given domain + category key
 * @param {string} domain
 * @param {string} categoryKey
 * @returns {number} priority score
 */
function getPriorityScore(domain, categoryKey) {
  const rules = PRIORITY_RULES[domain];
  if (!rules) return 0;
  const cat = rules.categories.find((c) => c.key === categoryKey);
  return cat ? cat.score : 0;
}

/**
 * Check if a service type triggers auto-emergency in a domain
 * @param {string} domain
 * @param {string} serviceType
 * @returns {boolean}
 */
function isUrgentService(domain, serviceType) {
  const rules = PRIORITY_RULES[domain];
  if (!rules) return false;
  return rules.urgentServices.includes(serviceType);
}

/**
 * Get estimated service time for a domain + service type
 * @param {string} domain
 * @param {string} serviceType
 * @returns {number} minutes
 */
function getServiceTime(domain, serviceType) {
  const rules = PRIORITY_RULES[domain];
  if (!rules) return 5;
  return rules.serviceTimeMap[serviceType] || rules.serviceTimeMap['default'] || 5;
}

module.exports = { PRIORITY_RULES, getPriorityScore, isUrgentService, getServiceTime };
