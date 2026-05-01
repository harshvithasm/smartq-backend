// models/DomainConfig.js
const mongoose = require('mongoose');

const domainConfigSchema = new mongoose.Schema({
  domain: {
    type: String,
    enum: ['hospital', 'bank', 'college', 'foodcourt', 'retail'],
    unique: true,
    required: true,
  },
  label: String,          // "Hospital"
  icon:  String,          // "🏥"
  color: String,          // "#22c9a5"

  // The service types available in this domain
  // Each token must pick one of these
  serviceTypes: [{ type: String }],

  // Token prefix: H, B, C, F, R
  tokenPrefix: { type: String, maxlength: 2 },

  // Counter name label: "Counter", "Teller", "Window", "Stall", "Billing"
  counterLabel: { type: String, default: 'Counter' },

  // Is the priority scoring feature active?
  priorityEnabled: { type: Boolean, default: true },

  // Average service time per type (in minutes)
  avgServiceTime: { type: Number, default: 5 },
});

module.exports = mongoose.model('DomainConfig', domainConfigSchema);
