// controllers/queueController.js — Phase 4: AI-enhanced
const Token   = require('../models/Token');
const Counter = require('../models/Counter');
const {
  getPriorityScore,
  isUrgentService,
  getServiceTime,
  PRIORITY_RULES,
} = require('../config/domainPriorityRules');
const { predictWait }            = require('../ai/waitTimePredictor');
const { annotateQueueWithRisk, predictNoShowRisk } = require('../ai/noShowPredictor');
const { findBestCounter }        = require('../ai/smartAssignment');

// ── Helper: generate next token number ──────────────────────────
const prefixMap = {
  hospital:  'H',
  bank:      'B',
  college:   'C',
  foodcourt: 'F',
  retail:    'R',
};

async function generateTokenNumber(domain) {
  const prefix = prefixMap[domain] || 'T';
  const count  = await Token.countDocuments({ domain });
  const num    = String(count + 1).padStart(3, '0');
  return `${prefix}${num}`;
}

async function computeEstimatedWait(domain, queuePosition) {
  const waitingTokens = await Token.find({ domain, status: 'waiting' })
    .sort({ priority: -1, joinedAt: 1 })
    .limit(queuePosition);
  let totalWait = 0;
  for (const t of waitingTokens) totalWait += getServiceTime(domain, t.serviceType);
  return totalWait;
}

// ── JOIN QUEUE ────────────────────────────────────────────────────
exports.joinQueue = async (req, res) => {
  try {
    const { domain, customerName, phone, serviceType, priorityCategory, priorityReason } = req.body;
    if (!domain || !serviceType)
      return res.status(400).json({ message: 'domain and serviceType are required' });

    let finalCategory = priorityCategory || 'normal';
    if (isUrgentService(domain, serviceType)) finalCategory = 'emergency';
    const priorityScore   = getPriorityScore(domain, finalCategory);
    const serviceTimeMin  = getServiceTime(domain, serviceType);
    const tokenNumber     = await generateTokenNumber(domain);
    const waitingCount    = await Token.countDocuments({ domain, status: 'waiting' });
    const queuePosition   = waitingCount + 1;

    // Phase 4: AI wait prediction
    const aiWait = await predictWait(domain, serviceType, priorityScore, queuePosition);

    const token = await Token.create({
      tokenNumber,
      domain,
      customerName:       customerName || 'Guest',
      phone:              phone || '',
      serviceType,
      priority:           priorityScore,
      priorityCategory:   finalCategory,
      priorityReason:     priorityReason || '',
      queuePosition,
      serviceTimeMinutes: serviceTimeMin,
      aiWaitMinutes:      aiWait.estimatedMinutes,
      aiWaitConfidence:   aiWait.confidence,
    });

    const io = req.app.get('io');
    io.to(domain).emit('queue_updated');
    io.to(domain).emit('new_token', {
      tokenNumber,
      customerName: token.customerName,
      serviceType,
      priorityCategory: finalCategory,
      queuePosition,
      estimatedWait:  aiWait.estimatedMinutes,
      aiWaitSource:   aiWait.source,
    });

    return res.status(201).json({
      success: true,
      token: {
        _id: token._id,
        tokenNumber: token.tokenNumber,
        customerName: token.customerName,
        serviceType: token.serviceType,
        status: token.status,
        priority: token.priority,
        priorityCategory: token.priorityCategory,
        priorityReason: token.priorityReason,
        queuePosition,
        estimatedWaitMinutes: aiWait.estimatedMinutes,
        aiWaitMinutes:    aiWait.estimatedMinutes,
        aiWaitConfidence: aiWait.confidence,
        aiWaitSource:     aiWait.source,
        serviceTimeMinutes: serviceTimeMin,
        joinedAt: token.joinedAt,
      },
    });
  } catch (err) {
    console.error('joinQueue error:', err);
    return res.status(500).json({ message: err.message });
  }
};

// ── GET QUEUE ────────────────────────────────────────────────────
exports.getQueue = async (req, res) => {
  try {
    const { domain } = req.params;
    const tokens = await Token.find({ domain, status: { $in: ['waiting', 'serving'] } })
      .sort({ priority: -1, joinedAt: 1 });

    let pos = 1, cumulativeWait = 0;
    const result = [];
    for (const t of tokens) {
      const item = t.toObject();
      if (t.status === 'waiting') {
        item.queuePosition        = pos++;
        item.estimatedWaitMinutes = t.aiWaitMinutes ?? cumulativeWait;
        cumulativeWait += getServiceTime(domain, t.serviceType);
      } else {
        item.queuePosition = 0; item.estimatedWaitMinutes = 0;
      }
      result.push(item);
    }

    // Phase 4: annotate with no-show risk
    const annotated = annotateQueueWithRisk(result);
    return res.json({ success: true, tokens: annotated });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// ── GET SINGLE TOKEN STATUS ───────────────────────────────────────
exports.getTokenStatus = async (req, res) => {
  try {
    const token = await Token.findById(req.params.id);
    if (!token) return res.status(404).json({ message: 'Token not found' });

    let queuePosition = 0, estimatedWait = 0;
    if (token.status === 'waiting') {
      queuePosition = await Token.countDocuments({
        domain: token.domain, status: 'waiting',
        $or: [{ priority: { $gt: token.priority } }, { priority: token.priority, joinedAt: { $lt: token.joinedAt } }],
      }) + 1;
      const aiWait  = await predictWait(token.domain, token.serviceType, token.priority, queuePosition);
      estimatedWait = aiWait.estimatedMinutes;
    }

    const risk = token.status === 'waiting'
      ? predictNoShowRisk({ ...token.toObject(), queuePosition }, estimatedWait)
      : null;

    return res.json({
      success: true,
      token: {
        ...token.toObject(),
        queuePosition,
        estimatedWaitMinutes: estimatedWait,
        noShowRisk: risk?.noShowRisk ?? null,
        riskLevel:  risk?.riskLevel  ?? null,
      },
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// ── CALL NEXT TOKEN — Phase 4: Smart Assignment ───────────────────
exports.callNextToken = async (domain, counterId) => {
  const next = await Token.findOne({ domain, status: 'waiting' }).sort({ priority: -1, joinedAt: 1 });
  if (!next) return null;

  let assignedCounterId   = counterId || null;
  let assignedCounterName = 'Counter 1';
  let assignmentReason    = 'manual';

  if (counterId) {
    const assignment = await findBestCounter(domain, next, counterId);
    assignedCounterId   = assignment.counterId;
    assignedCounterName = assignment.counterName;
    assignmentReason    = assignment.reason;
    if (assignment.reassigned)
      console.log(`🤖 [SmartAssignment] ${domain}: ${next.tokenNumber} → ${assignedCounterName}`);
  } else {
    const best = await Counter.findOne({ domain, isOpen: true, currentToken: null });
    if (best) {
      assignedCounterId   = best._id.toString();
      assignedCounterName = best.name;
      assignmentReason    = 'auto_free_counter';
    }
  }

  next.status           = 'serving';
  next.calledAt         = new Date();
  next.assignedCounter  = assignedCounterName;
  next.assignmentReason = assignmentReason;
  await next.save();

  if (assignedCounterId)
    await Counter.findByIdAndUpdate(assignedCounterId, { currentToken: next.tokenNumber });

  return {
    tokenNumber:      next.tokenNumber,
    customerName:     next.customerName,
    serviceType:      next.serviceType,
    priorityCategory: next.priorityCategory,
    assignedCounter:  assignedCounterName,
    assignmentReason,
  };
};

// ── MARK SERVED ──────────────────────────────────────────────────
exports.markServed = async (tokenId) => {
  const token = await Token.findById(tokenId);
  if (!token) throw new Error('Token not found');
  token.status   = 'served';
  token.servedAt = new Date();
  if (token.calledAt) token.waitTimeMinutes = Math.round((token.servedAt - token.calledAt) / 60000);
  await token.save();
  if (token.assignedCounter)
    await Counter.findOneAndUpdate(
      { name: token.assignedCounter, domain: token.domain },
      { $inc: { tokensServedToday: 1 }, currentToken: null }
    );
  return token;
};

exports.markServedHTTP = async (req, res) => {
  try {
    const token = await exports.markServed(req.params.id);
    req.app.get('io').to(token.domain).emit('queue_updated');
    return res.json({ success: true, token });
  } catch (err) { return res.status(500).json({ message: err.message }); }
};

exports.skipToken = async (req, res) => {
  try {
    const token = await Token.findByIdAndUpdate(req.params.id, { status: 'skipped' }, { new: true });
    if (!token) return res.status(404).json({ message: 'Token not found' });
    req.app.get('io').to(token.domain).emit('queue_updated');
    return res.json({ success: true, token });
  } catch (err) { return res.status(500).json({ message: err.message }); }
};

exports.submitRating = async (req, res) => {
  try {
    const { rating } = req.body;
    if (!rating || rating < 1 || rating > 5) return res.status(400).json({ message: 'Rating must be 1–5' });
    const token = await Token.findByIdAndUpdate(req.params.id, { rating }, { new: true });
    return res.json({ success: true, token });
  } catch (err) { return res.status(500).json({ message: err.message }); }
};

exports.getStats = async (req, res) => {
  try {
    const { domain } = req.params;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const [waiting, serving, servedToday, avgWait] = await Promise.all([
      Token.countDocuments({ domain, status: 'waiting' }),
      Token.countDocuments({ domain, status: 'serving' }),
      Token.countDocuments({ domain, status: 'served', servedAt: { $gte: today } }),
      Token.aggregate([{ $match: { domain, status: 'served', waitTimeMinutes: { $ne: null } } }, { $group: { _id: null, avg: { $avg: '$waitTimeMinutes' } } }]),
    ]);
    const openCounters   = await Counter.countDocuments({ domain, isOpen: true });
    const skippedToday   = await Token.countDocuments({ domain, status: 'skipped', joinedAt: { $gte: today } });
    const highRiskCount  = await Token.countDocuments({ domain, status: 'waiting', riskLevel: 'high' });
    const priorityBreakdown = await Token.aggregate([
      { $match: { domain, status: 'waiting' } },
      { $group: { _id: '$priorityCategory', count: { $sum: 1 } } },
    ]);
    return res.json({
      success: true,
      stats: {
        waiting, serving, servedToday, openCounters, skippedToday, highRiskCount,
        avgWaitMinutes: avgWait[0] ? Math.round(avgWait[0].avg) : 0,
        priorityBreakdown: priorityBreakdown.reduce((acc, p) => { acc[p._id || 'normal'] = p.count; return acc; }, {}),
      },
    });
  } catch (err) { return res.status(500).json({ message: err.message }); }
};

exports.getDomainRules = async (req, res) => {
  try {
    const { domain } = req.params;
    const rules = PRIORITY_RULES[domain];
    if (!rules) return res.status(404).json({ message: 'Domain rules not found' });
    return res.json({ success: true, rules });
  } catch (err) { return res.status(500).json({ message: err.message }); }
};
