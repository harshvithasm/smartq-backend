// backend/ai/noShowPredictor.js
// ─────────────────────────────────────────────────────────────────
// Phase 4 — Module 2: No-Show / Skip Risk Predictor
// Computes a 0–1 risk score for each waiting token.
// High risk (≥0.6) → 🔴 badge in Admin dashboard.
// Uses logistic regression trained on skipped/no-show tokens.
// Falls back to a fast rule-based heuristic with no training data.
// ─────────────────────────────────────────────────────────────────

const Token = require('../models/Token');

const MIN_SAMPLES = 30;
const models = {}; // { domain: { weights, trained, ... } }

// ── Sigmoid ───────────────────────────────────────────────────────
const sigmoid = (z) => 1 / (1 + Math.exp(-z));

// ── Feature extraction ────────────────────────────────────────────
// Features that predict whether a waiting customer will no-show:
//   - minutesWaited so far (longer = higher risk)
//   - queuePosition (farther back = higher risk)
//   - hour of day (end of business hours = higher risk)
//   - priorityScore (high priority customers are less likely to leave)
//   - isPeak (crowded = more frustration)
function extractNoShowFeatures(token, minutesWaited) {
  const now      = new Date();
  const hour     = now.getHours();
  const isPeak   = (hour >= 10 && hour <= 12) || (hour >= 14 && hour <= 16) ? 1 : 0;
  const isEOD    = hour >= 16 ? 1 : 0; // end-of-day rush

  return [
    1,                                               // bias
    Math.min(minutesWaited, 60) / 60,                // normalised wait so far
    Math.min(token.queuePosition || 1, 20) / 20,     // normalised position
    isPeak,
    isEOD,
    (token.priority || 0) / 100,                     // normalised priority (inverted risk)
  ];
}

// ── Logistic Regression — gradient descent ────────────────────────
function fitLogisticRegression(X, y, epochs = 500, lr = 0.1) {
  const n = X[0].length;
  let w = Array(n).fill(0);

  for (let e = 0; e < epochs; e++) {
    const grad = Array(n).fill(0);
    for (let i = 0; i < X.length; i++) {
      const pred = sigmoid(X[i].reduce((s, xi, j) => s + xi * w[j], 0));
      const err  = pred - y[i];
      for (let j = 0; j < n; j++) grad[j] += err * X[i][j];
    }
    // L2 regularisation + update
    for (let j = 0; j < n; j++) {
      w[j] -= lr * (grad[j] / X.length + 0.01 * w[j]);
    }
  }
  return w;
}

// ── Train for a domain ────────────────────────────────────────────
async function trainDomain(domain) {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);

    // Positives: skipped tokens (no-show proxy)
    const skipped = await Token.find({
      domain,
      status: 'skipped',
      joinedAt: { $gte: cutoff },
    }).lean();

    // Negatives: served tokens (customer stayed)
    const served = await Token.find({
      domain,
      status: 'served',
      joinedAt: { $gte: cutoff },
    })
      .limit(skipped.length * 3)   // balance classes roughly 1:3
      .lean();

    if (skipped.length + served.length < MIN_SAMPLES) {
      models[domain] = { trained: false, sampleCount: skipped.length + served.length };
      return;
    }

    const X = [];
    const y = [];

    for (const t of skipped) {
      const waited = t.calledAt && t.joinedAt
        ? (new Date(t.calledAt) - new Date(t.joinedAt)) / 60000
        : (t.queuePosition || 1) * 5;
      X.push(extractNoShowFeatures(t, waited));
      y.push(1); // no-show
    }

    for (const t of served) {
      const waited = t.calledAt && t.joinedAt
        ? (new Date(t.calledAt) - new Date(t.joinedAt)) / 60000
        : (t.queuePosition || 1) * 5;
      X.push(extractNoShowFeatures(t, waited));
      y.push(0); // stayed
    }

    const weights = fitLogisticRegression(X, y);

    // Compute accuracy on training data
    let correct = 0;
    for (let i = 0; i < X.length; i++) {
      const pred = sigmoid(X[i].reduce((s, xi, j) => s + xi * weights[j], 0));
      if ((pred >= 0.5 ? 1 : 0) === y[i]) correct++;
    }
    const accuracy = correct / X.length;

    models[domain] = {
      trained: true,
      weights,
      accuracy: Math.round(accuracy * 100) / 100,
      noShowRate: skipped.length / (skipped.length + served.length),
      sampleCount: X.length,
      trainedAt: new Date(),
    };

    console.log(`🤖 [NoShowPredictor] ${domain} trained — samples: ${X.length}, accuracy: ${(accuracy * 100).toFixed(1)}%`);
  } catch (err) {
    console.error(`[NoShowPredictor] Training failed for ${domain}:`, err.message);
  }
}

async function trainAll() {
  const domains = ['hospital', 'bank', 'college', 'foodcourt', 'retail'];
  await Promise.all(domains.map(trainDomain));
  console.log('🤖 [NoShowPredictor] All models updated');
}

// ── Rule-based fallback ───────────────────────────────────────────
// Returns a heuristic risk score when there's no trained model.
function ruleBasedRisk(token, minutesWaited) {
  let score = 0;

  // Longer wait = higher risk
  if (minutesWaited > 30) score += 0.4;
  else if (minutesWaited > 15) score += 0.2;

  // Far back in queue
  if ((token.queuePosition || 1) > 15) score += 0.2;
  else if ((token.queuePosition || 1) > 8)  score += 0.1;

  // End of day
  const hour = new Date().getHours();
  if (hour >= 16) score += 0.15;

  // High priority customers rarely leave
  if (token.priority >= 50) score -= 0.2;

  return Math.min(1, Math.max(0, score));
}

// ── Public: predict risk for a single token ───────────────────────
function predictNoShowRisk(token, estimatedWaitMinutes) {
  const minutesWaited = Math.max(
    0,
    token.joinedAt
      ? (Date.now() - new Date(token.joinedAt).getTime()) / 60000
      : 0
  );

  const model = models[token.domain];

  if (!model || !model.trained) {
    const score = ruleBasedRisk(token, minutesWaited);
    return {
      noShowRisk: Math.round(score * 100) / 100,
      riskLevel: score >= 0.6 ? 'high' : score >= 0.35 ? 'medium' : 'low',
      source: 'rule-based',
    };
  }

  const features = extractNoShowFeatures(token, minutesWaited);
  const z        = features.reduce((s, xi, j) => s + xi * model.weights[j], 0);
  const score    = sigmoid(z);

  return {
    noShowRisk: Math.round(score * 100) / 100,
    riskLevel: score >= 0.6 ? 'high' : score >= 0.35 ? 'medium' : 'low',
    source: 'ai',
    modelAccuracy: model.accuracy,
  };
}

// ── Annotate an entire queue with risk scores ─────────────────────
function annotateQueueWithRisk(tokens) {
  return tokens.map((t) => {
    if (t.status !== 'waiting') return { ...t, noShowRisk: 0, riskLevel: 'low' };
    const result = predictNoShowRisk(t, t.estimatedWaitMinutes || 0);
    return { ...t, ...result };
  });
}

module.exports = {
  trainAll,
  trainDomain,
  predictNoShowRisk,
  annotateQueueWithRisk,
  getModelStatus: () => {
    const status = {};
    ['hospital', 'bank', 'college', 'foodcourt', 'retail'].forEach((d) => {
      status[d] = models[d] || { trained: false };
    });
    return status;
  },
};
