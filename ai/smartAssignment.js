// backend/ai/smartAssignment.js
// ─────────────────────────────────────────────────────────────────
// Phase 4 — Module 3: Smart Counter Auto-Assignment
// When a token is called, instead of always picking the counter that
// pressed the button, the system scores ALL open counters and selects
// the optimal one:
//   1. Counter handles the token's service type        (+40 pts)
//   2. Counter is not currently serving anyone         (+30 pts)
//   3. Lower tokensServedToday  (less fatigued)        (up to +15 pts)
//   4. Lower avgServiceTime for this service           (up to +15 pts)
// Returns the best counter ID for assignment.
// Falls back to the requesting counter if no better match is found.
// ─────────────────────────────────────────────────────────────────

const Counter = require('../models/Counter');

/**
 * Score a counter for serving a specific token.
 * @param {Object} counter - Mongoose Counter document
 * @param {Object} token   - Mongoose Token document (serviceType, priority)
 * @returns {number} score
 */
function scoreCounter(counter, token) {
  let score = 0;

  // 1. Handles this service type?
  const handles =
    !counter.serviceTypes ||
    counter.serviceTypes.length === 0 ||
    counter.serviceTypes.includes(token.serviceType);

  if (handles) score += 40;
  else score -= 50; // strong penalty — don't mismatch

  // 2. Free right now?
  if (!counter.currentToken) score += 30;

  // 3. Workload: fewer served today = fresher staff
  const loadPenalty = Math.min(counter.tokensServedToday || 0, 30) / 30;
  score += (1 - loadPenalty) * 15;

  // 4. Speed: lower avg service time = faster
  const speedBonus = Math.max(0, 20 - (counter.avgServiceTime || 5)) / 20;
  score += speedBonus * 15;

  return score;
}

/**
 * Find the best open counter for a given token in the domain.
 * @param {string} domain
 * @param {Object} token      - { serviceType, priority, ... }
 * @param {string} requestingCounterId - the counter that triggered the call
 * @returns {Promise<{ counterId, counterName, score, reason }>}
 */
async function findBestCounter(domain, token, requestingCounterId) {
  try {
    const openCounters = await Counter.find({ domain, isOpen: true }).lean();

    if (openCounters.length === 0) {
      return {
        counterId: requestingCounterId,
        counterName: 'Counter 1',
        score: 0,
        reason: 'no_open_counters',
      };
    }

    let bestCounter    = null;
    let bestScore      = -Infinity;
    let requestingData = null;

    for (const c of openCounters) {
      const s = scoreCounter(c, token);
      if (s > bestScore) {
        bestScore  = s;
        bestCounter = c;
      }
      if (c._id.toString() === requestingCounterId) {
        requestingData = { counterId: c._id.toString(), counterName: c.name, score: s };
      }
    }

    // Only reassign if the best counter scores meaningfully higher
    // than the requesting counter (avoid unnecessary reassignments)
    const requestingScore = requestingData?.score ?? -Infinity;
    const REASSIGN_THRESHOLD = 15;

    if (
      bestCounter &&
      bestCounter._id.toString() !== requestingCounterId &&
      bestScore > requestingScore + REASSIGN_THRESHOLD
    ) {
      return {
        counterId:   bestCounter._id.toString(),
        counterName: bestCounter.name,
        score:       bestScore,
        reason:      'optimised',
        reassigned:  true,
      };
    }

    // Stick with requesting counter
    return {
      counterId:   requestingCounterId || bestCounter._id.toString(),
      counterName: requestingData?.counterName || bestCounter?.name || 'Counter 1',
      score:       requestingScore,
      reason:      'requesting_is_best',
      reassigned:  false,
    };
  } catch (err) {
    console.error('[SmartAssignment] error:', err.message);
    return {
      counterId:   requestingCounterId,
      counterName: 'Counter 1',
      score:       0,
      reason:      'error_fallback',
    };
  }
}

/**
 * Get an assignment summary for the admin (which counters are free/busy,
 * their current scores, and overall recommendation).
 * Used by the AI Insights panel.
 */
async function getAssignmentInsights(domain) {
  try {
    const counters = await Counter.find({ domain }).lean();
    const summary  = counters.map((c) => ({
      _id:               c._id,
      name:              c.name,
      staffName:         c.staffName,
      isOpen:            c.isOpen,
      currentToken:      c.currentToken,
      tokensServedToday: c.tokensServedToday,
      avgServiceTime:    c.avgServiceTime,
      serviceTypes:      c.serviceTypes,
      isBusy:            !!c.currentToken,
    }));

    const openCount  = summary.filter((c) => c.isOpen).length;
    const busyCount  = summary.filter((c) => c.isOpen && c.isBusy).length;
    const freeCount  = openCount - busyCount;

    return { counters: summary, openCount, busyCount, freeCount };
  } catch (err) {
    return { counters: [], openCount: 0, busyCount: 0, freeCount: 0 };
  }
}

module.exports = { findBestCounter, getAssignmentInsights, scoreCounter };
