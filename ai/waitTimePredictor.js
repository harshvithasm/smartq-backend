// backend/ai/waitTimePredictor.js
// ─────────────────────────────────────────────────────────────────
// Phase 4 — Module 1: AI Wait Time Predictor
// Uses linear regression trained on historical served tokens.
// Features: hour of day, day of week, open counters, queue length,
//           service time base, and priority score.
// Falls back to domain average if insufficient training data.
// Retrains automatically every night at midnight.
// ─────────────────────────────────────────────────────────────────

const Token   = require('../models/Token');
const Counter = require('../models/Counter');
const { getServiceTime } = require('../config/domainPriorityRules');

// ── In-memory model store: one model per domain ──────────────────
const models = {};        // { domain: { weights, bias, trained } }
const MIN_SAMPLES = 20;   // minimum served tokens needed to train

// ── Simple Linear Regression via Normal Equations ───────────────
// y = w·x + b  (least-squares closed form: w = (XᵀX)⁻¹Xᵀy)

function transpose(matrix) {
  return matrix[0].map((_, i) => matrix.map((row) => row[i]));
}

function matMul(A, B) {
  return A.map((row) =>
    B[0].map((_, j) => row.reduce((sum, a, k) => sum + a * B[k][j], 0))
  );
}

// Solve (XᵀX + λI) w = Xᵀy  (ridge regression to avoid singularity)
function fitLinearRegression(X, y, lambda = 0.01) {
  const XT    = transpose(X);
  const XTX   = matMul(XT, X);
  const n     = XTX.length;

  // Ridge: add λ to diagonal
  for (let i = 0; i < n; i++) XTX[i][i] += lambda;

  // XTy
  const XTy = XT.map((row) => row.reduce((s, v, i) => s + v * y[i], 0));

  // Gauss-Jordan inverse
  const aug = XTX.map((row, i) => {
    const id = Array(n).fill(0);
    id[i] = 1;
    return [...row, ...id];
  });

  for (let col = 0; col < n; col++) {
    let maxRow = col;
    for (let r = col + 1; r < n; r++)
      if (Math.abs(aug[r][col]) > Math.abs(aug[maxRow][col])) maxRow = r;
    [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];

    const pivot = aug[col][col];
    if (Math.abs(pivot) < 1e-12) continue;
    for (let j = 0; j < 2 * n; j++) aug[col][j] /= pivot;

    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = aug[r][col];
      for (let j = 0; j < 2 * n; j++) aug[r][j] -= factor * aug[col][j];
    }
  }

  const inv = aug.map((row) => row.slice(n));
  const weights = Array(n).fill(0);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      weights[i] += inv[i][j] * XTy[j];

  return weights;
}

// ── Feature extraction ───────────────────────────────────────────
function extractFeatures(domain, serviceType, priority, queueLength, openCounters, atDate) {
  const date     = atDate || new Date();
  const hour     = date.getHours();                        // 0-23
  const dayOfWeek = date.getDay();                         // 0-6
  const baseTime  = getServiceTime(domain, serviceType);   // domain avg

  // Sine/cosine encode hour to capture cyclical nature
  const hourSin  = Math.sin((2 * Math.PI * hour) / 24);
  const hourCos  = Math.cos((2 * Math.PI * hour) / 24);

  // Is it peak hour? (10-12, 14-16 typically)
  const isPeak   = (hour >= 10 && hour <= 12) || (hour >= 14 && hour <= 16) ? 1 : 0;

  // Is it weekend?
  const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6) ? 1 : 0;

  return [
    1,                                              // bias term
    hourSin,
    hourCos,
    isPeak,
    isWeekend,
    Math.min(queueLength, 30) / 30,                // normalised 0-1
    Math.max(1, openCounters),                      // raw counter count
    baseTime / 20,                                  // normalised service time
    priority / 100,                                 // normalised priority
  ];
}

// ── Train model for a single domain ─────────────────────────────
async function trainDomain(domain) {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Use last 30 days of served tokens that have an actual wait time
    const cutoff = new Date(today);
    cutoff.setDate(cutoff.getDate() - 30);

    const samples = await Token.find({
      domain,
      status: 'served',
      waitTimeMinutes: { $ne: null, $gt: 0, $lt: 120 }, // sanity bounds
      servedAt: { $gte: cutoff },
    }).lean();

    if (samples.length < MIN_SAMPLES) {
      models[domain] = { trained: false, sampleCount: samples.length };
      return;
    }

    // For each sample we need the queue state at the time it joined —
    // We approximate with queuePosition stored at join time.
    const X = [];
    const y = [];

    for (const s of samples) {
      const features = extractFeatures(
        s.domain,
        s.serviceType,
        s.priority || 0,
        s.queuePosition || 1,
        1,                     // open counters unknown at training time; use 1
        s.joinedAt ? new Date(s.joinedAt) : new Date()
      );
      X.push(features);
      y.push(s.waitTimeMinutes);
    }

    const weights = fitLinearRegression(X, y);

    // Compute training R² for diagnostics
    const yMean = y.reduce((a, b) => a + b, 0) / y.length;
    const ssTot = y.reduce((s, v) => s + (v - yMean) ** 2, 0);
    const ssRes = y.reduce((s, v, i) => {
      const pred = X[i].reduce((sum, xi, j) => sum + xi * weights[j], 0);
      return s + (v - pred) ** 2;
    }, 0);
    const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;

    models[domain] = {
      trained: true,
      weights,
      sampleCount: samples.length,
      r2: Math.round(r2 * 100) / 100,
      trainedAt: new Date(),
    };

    console.log(`🤖 [WaitPredictor] ${domain} trained — samples: ${samples.length}, R²: ${r2.toFixed(2)}`);
  } catch (err) {
    console.error(`[WaitPredictor] Training failed for ${domain}:`, err.message);
  }
}

// ── Train all domains ─────────────────────────────────────────────
async function trainAll() {
  const domains = ['hospital', 'bank', 'college', 'foodcourt', 'retail'];
  await Promise.all(domains.map(trainDomain));
  console.log('🤖 [WaitPredictor] All models updated');
}

// ── Predict wait time for a given token context ──────────────────
async function predictWait(domain, serviceType, priority, queuePosition) {
  try {
    const openCounters = await Counter.countDocuments({ domain, isOpen: true });
    const model = models[domain];

    if (!model || !model.trained) {
      // Fallback: domain average calculation
      const baseTime = getServiceTime(domain, serviceType);
      return {
        estimatedMinutes: Math.max(1, Math.round(queuePosition * baseTime * 0.85)),
        source: 'fallback',
        confidence: 'low',
      };
    }

    const features = extractFeatures(
      domain,
      serviceType,
      priority || 0,
      queuePosition,
      openCounters,
      new Date()
    );

    let raw = features.reduce((sum, xi, j) => sum + xi * model.weights[j], 0);
    raw = Math.max(1, Math.round(raw));

    // Confidence based on R²
    const confidence = model.r2 >= 0.7 ? 'high' : model.r2 >= 0.4 ? 'medium' : 'low';

    return {
      estimatedMinutes: raw,
      source: 'ai',
      confidence,
      modelR2: model.r2,
      sampleCount: model.sampleCount,
    };
  } catch (err) {
    console.error('[WaitPredictor] predict error:', err.message);
    const baseTime = getServiceTime(domain, serviceType);
    return {
      estimatedMinutes: Math.max(1, Math.round(queuePosition * baseTime * 0.85)),
      source: 'fallback',
      confidence: 'low',
    };
  }
}

// ── Schedule nightly retrain at midnight ─────────────────────────
function scheduleNightlyRetrain() {
  const now   = new Date();
  const night = new Date(now);
  night.setHours(24, 0, 0, 0); // next midnight
  const msUntilMidnight = night - now;

  setTimeout(async () => {
    await trainAll();
    // Then repeat every 24 hours
    setInterval(trainAll, 24 * 60 * 60 * 1000);
  }, msUntilMidnight);

  console.log(`🤖 [WaitPredictor] Nightly retrain scheduled in ${Math.round(msUntilMidnight / 60000)} min`);
}

// ── Public API ────────────────────────────────────────────────────
module.exports = {
  trainAll,
  predictWait,
  scheduleNightlyRetrain,
  getModelStatus: () => {
    const status = {};
    ['hospital', 'bank', 'college', 'foodcourt', 'retail'].forEach((d) => {
      status[d] = models[d] || { trained: false };
    });
    return status;
  },
};
