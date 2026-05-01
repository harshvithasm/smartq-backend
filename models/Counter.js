// models/Counter.js
const mongoose = require('mongoose');

const counterSchema = new mongoose.Schema(
  {
    // e.g. "Counter 1", "Teller 3", "Window A"
    name: { type: String, required: true },

    domain: {
      type: String,
      enum: ['hospital', 'bank', 'college', 'foodcourt', 'retail'],
      required: true,
    },

    // Which service types this counter handles
    // e.g. ["OPD", "Emergency"] or ["Cash Deposit", "Withdrawal"]
    serviceTypes: [{ type: String }],

    isOpen: { type: Boolean, default: true },

    // Staff member name at this counter
    staffName: { type: String, default: '' },

    // Token currently being served
    currentToken: { type: String, default: null },

    // How many tokens served today
    tokensServedToday: { type: Number, default: 0 },

    // Average service time in minutes
    avgServiceTime: { type: Number, default: 5 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Counter', counterSchema);
