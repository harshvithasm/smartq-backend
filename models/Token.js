// models/Token.js — Phase 3: added priorityCategory + serviceTimeMinutes
const mongoose = require('mongoose');

const tokenSchema = new mongoose.Schema(
  {
    tokenNumber:       { type: String, required: true, unique: true },
    domain: {
      type: String,
      enum: ['hospital', 'bank', 'college', 'foodcourt', 'retail'],
      required: true,
    },
    customerName:      { type: String, default: 'Guest' },
    phone:             { type: String, default: '' },
    serviceType:       { type: String, required: true },
    status: {
      type: String,
      enum: ['waiting', 'serving', 'served', 'skipped'],
      default: 'waiting',
    },
    // Phase 3: numeric score for sorting
    priority:          { type: Number, default: 0 },
    // Phase 3: category key e.g. "senior", "emergency", "vip"
    priorityCategory:  { type: String, default: 'normal' },
    priorityReason:    { type: String, default: '' },
    assignedCounter:   { type: String, default: null },
    queuePosition:     { type: Number },
    // Phase 3: domain-specific service time
    serviceTimeMinutes: { type: Number, default: 5 },
    joinedAt:          { type: Date, default: Date.now },
    calledAt:          { type: Date, default: null },
    servedAt:          { type: Date, default: null },
    waitTimeMinutes:   { type: Number, default: null },
    rating:            { type: Number, default: null },

    // ── Phase 4 AI fields ────────────────────────────────────────
    // AI-predicted wait time (Module 1)
    aiWaitMinutes:     { type: Number, default: null },
    aiWaitConfidence:  { type: String, enum: ['high', 'medium', 'low', null], default: null },
    // No-show risk score 0–1 (Module 2)
    noShowRisk:        { type: Number, default: null },
    riskLevel:         { type: String, enum: ['high', 'medium', 'low', null], default: null },
    // Smart assignment metadata (Module 3)
    assignmentReason:  { type: String, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Token', tokenSchema);
