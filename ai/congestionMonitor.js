// backend/ai/congestionMonitor.js
// ─────────────────────────────────────────────────────────────────
// Phase 4 — Module 4: Congestion / Frustration Detection
// Runs every 60 seconds. Checks queue health across all domains.
// Emits `congestion_alert` Socket.io events to admin rooms.
// Thresholds are configurable per domain via CONGESTION_THRESHOLDS.
// ─────────────────────────────────────────────────────────────────

const Token   = require('../models/Token');
const Counter = require('../models/Counter');
const { getServiceTime, PRIORITY_RULES } = require('../config/domainPriorityRules');

// ── Configurable thresholds per domain ───────────────────────────
const CONGESTION_THRESHOLDS = {
  hospital: {
    maxWaiting:         15,   // alert if >15 waiting
    maxAvgWaitMinutes:  20,   // alert if avg estimated wait > 20 min
    maxHighPriorityWait: 5,   // alert if emergency waited > 5 min
    criticalCategory:  'emergency',
  },
  bank: {
    maxWaiting:         20,
    maxAvgWaitMinutes:  25,
    maxHighPriorityWait: 10,
    criticalCategory:  'vip',
  },
  college: {
    maxWaiting:         25,
    maxAvgWaitMinutes:  30,
    maxHighPriorityWait: 15,
    criticalCategory:  'faculty',
  },
  foodcourt: {
    maxWaiting:         30,
    maxAvgWaitMinutes:  20,
    maxHighPriorityWait: 10,
    criticalCategory:  'preorder',
  },
  retail: {
    maxWaiting:         25,
    maxAvgWaitMinutes:  20,
    maxHighPriorityWait: 8,
    criticalCategory:  'staff',
  },
};

// Fallback thresholds for unknown domains
const DEFAULT_THRESHOLDS = {
  maxWaiting:          20,
  maxAvgWaitMinutes:   25,
  maxHighPriorityWait: 10,
  criticalCategory:   'normal',
};

let monitorInterval = null;

// ── Compute current health metrics for a domain ──────────────────
async function getDomainHealth(domain) {
  const thresholds = CONGESTION_THRESHOLDS[domain] || DEFAULT_THRESHOLDS;

  const [waitingTokens, openCounters] = await Promise.all([
    Token.find({ domain, status: 'waiting' }).sort({ priority: -1, joinedAt: 1 }).lean(),
    Counter.countDocuments({ domain, isOpen: true }),
  ]);

  const waitingCount = waitingTokens.length;

  // Compute cumulative estimated wait per token
  let cumWait = 0;
  const annotated = waitingTokens.map((t) => {
    const svcTime  = getServiceTime(domain, t.serviceType);
    const tokenWait = cumWait;
    cumWait += svcTime;
    return { ...t, estimatedWaitMinutes: tokenWait };
  });

  const avgEstimatedWait =
    annotated.length > 0
      ? Math.round(annotated.reduce((s, t) => s + t.estimatedWaitMinutes, 0) / annotated.length)
      : 0;

  // Find the longest-waiting high-priority token
  const highPriorityWaiting = annotated.filter(
    (t) => t.priorityCategory === thresholds.criticalCategory
  );

  let longestHighPriorityWait = 0;
  for (const t of highPriorityWaiting) {
    const minutesWaiting = t.joinedAt
      ? (Date.now() - new Date(t.joinedAt).getTime()) / 60000
      : 0;
    if (minutesWaiting > longestHighPriorityWait)
      longestHighPriorityWait = minutesWaiting;
  }

  return {
    domain,
    waitingCount,
    avgEstimatedWait,
    openCounters,
    longestHighPriorityWait: Math.round(longestHighPriorityWait),
    thresholds,
  };
}

// ── Build alert object if thresholds are breached ─────────────────
function buildAlerts(health) {
  const alerts = [];
  const { domain, waitingCount, avgEstimatedWait, openCounters, longestHighPriorityWait, thresholds } = health;

  if (waitingCount > thresholds.maxWaiting) {
    alerts.push({
      type:     'queue_overflow',
      severity: waitingCount > thresholds.maxWaiting * 1.5 ? 'critical' : 'warning',
      message:  `${waitingCount} customers waiting — queue is overloaded`,
      metric:   waitingCount,
      threshold: thresholds.maxWaiting,
      suggestion: openCounters < 2
        ? 'Open additional counters immediately'
        : 'Consider opening more counters or calling staff',
    });
  }

  if (avgEstimatedWait > thresholds.maxAvgWaitMinutes) {
    alerts.push({
      type:      'long_wait',
      severity:  avgEstimatedWait > thresholds.maxAvgWaitMinutes * 1.5 ? 'critical' : 'warning',
      message:   `Average wait ${avgEstimatedWait} min exceeds ${thresholds.maxAvgWaitMinutes} min threshold`,
      metric:    avgEstimatedWait,
      threshold: thresholds.maxAvgWaitMinutes,
      suggestion: 'Speed up service or open new counters to reduce wait time',
    });
  }

  if (longestHighPriorityWait > thresholds.maxHighPriorityWait) {
    const cat = PRIORITY_RULES[domain]?.categories.find((c) => c.key === thresholds.criticalCategory);
    alerts.push({
      type:      'priority_neglected',
      severity:  'critical',
      message:   `${cat?.label || 'High priority'} customer waiting ${longestHighPriorityWait} min`,
      metric:    longestHighPriorityWait,
      threshold: thresholds.maxHighPriorityWait,
      suggestion: `Call the ${cat?.label || 'priority'} customer immediately`,
    });
  }

  return alerts;
}

// ── Single check pass ─────────────────────────────────────────────
async function runCheck(io) {
  const domains = ['hospital', 'bank', 'college', 'foodcourt', 'retail'];

  for (const domain of domains) {
    try {
      const health = await getDomainHealth(domain);
      const alerts = buildAlerts(health);

      if (alerts.length > 0) {
        const payload = {
          domain,
          checkedAt:    new Date().toISOString(),
          waitingCount: health.waitingCount,
          avgEstimatedWait: health.avgEstimatedWait,
          openCounters: health.openCounters,
          alerts,
        };

        // Emit to all admin sockets joined to this domain
        io.to(domain).emit('congestion_alert', payload);

        const worst = alerts.find((a) => a.severity === 'critical') || alerts[0];
        console.log(`⚠️  [CongestionMonitor] ${domain}: ${worst.message}`);
      } else {
        // Emit all-clear so the UI can dismiss banners
        io.to(domain).emit('congestion_clear', { domain, checkedAt: new Date().toISOString() });
      }
    } catch (err) {
      console.error(`[CongestionMonitor] Error checking ${domain}:`, err.message);
    }
  }
}

// ── Start / stop the monitor ──────────────────────────────────────
function startMonitor(io, intervalMs = 60_000) {
  if (monitorInterval) return; // already running

  console.log(`🔍 [CongestionMonitor] Started — checking every ${intervalMs / 1000}s`);

  // First run immediately, then on interval
  runCheck(io);
  monitorInterval = setInterval(() => runCheck(io), intervalMs);
}

function stopMonitor() {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
    console.log('[CongestionMonitor] Stopped');
  }
}

module.exports = { startMonitor, stopMonitor, getDomainHealth, buildAlerts };
