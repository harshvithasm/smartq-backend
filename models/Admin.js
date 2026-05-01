// models/Admin.js
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

const adminSchema = new mongoose.Schema(
  {
    name:     { type: String, required: true },
    email:    { type: String, required: true, unique: true, lowercase: true },
    password: { type: String, required: true },

    // Which domains this admin can manage (empty = all)
    domains: [{ type: String }],

    role: {
      type: String,
      enum: ['superadmin', 'admin'],
      default: 'admin',
    },

    isActive: { type: Boolean, default: true },
    lastLogin: { type: Date, default: null },
  },
  { timestamps: true }
);

// Hash password before save
adminSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Compare plain password with hash
adminSchema.methods.comparePassword = async function (plain) {
  return bcrypt.compare(plain, this.password);
};

// Never send password in JSON responses
adminSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  return obj;
};

module.exports = mongoose.model('Admin', adminSchema);
