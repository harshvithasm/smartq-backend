// scripts/seedAdmin.js
// Run once: node scripts/seedAdmin.js
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const Admin    = require('../models/Admin');
const Counter  = require('../models/Counter');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/smartq';

const defaultAdmin = {
  name:     'Super Admin',
  email:    'admin@smartq.com',
  password: 'smartq123',
  role:     'superadmin',
  domains:  [],           // empty = access to all
};

const defaultCounters = [
  // Hospital
  { name: 'Counter 1', domain: 'hospital', staffName: 'Dr. Sharma',  serviceTypes: ['OPD – General', 'OPD – Cardiology'] },
  { name: 'Counter 2', domain: 'hospital', staffName: 'Dr. Iyer',    serviceTypes: ['OPD – Ortho', 'Emergency'] },
  { name: 'Counter 3', domain: 'hospital', staffName: 'Nurse Priya', serviceTypes: ['Pharmacy', 'Lab / Blood Test', 'Radiology'] },

  // Bank
  { name: 'Teller 1', domain: 'bank', staffName: 'Rahul M.',  serviceTypes: ['Cash Deposit', 'Cash Withdrawal'] },
  { name: 'Teller 2', domain: 'bank', staffName: 'Sneha K.',  serviceTypes: ['Account Opening', 'Loan Inquiry', 'Cheque'] },
  { name: 'Teller 3', domain: 'bank', staffName: 'Arjun P.',  serviceTypes: ['FD / RD', 'General Inquiry'] },

  // College
  { name: 'Window 1', domain: 'college', staffName: 'Mr. Kumar',  serviceTypes: ['TC / Migration', 'Fee Payment'] },
  { name: 'Window 2', domain: 'college', staffName: 'Ms. Anita',  serviceTypes: ['Bonafide Certificate', 'Scholarship', 'Exam Form'] },
  { name: 'Window 3', domain: 'college', staffName: 'Mr. Raj',    serviceTypes: ['Result Query', 'Hostel Related'] },

  // Food Court
  { name: 'Stall 1', domain: 'foodcourt', staffName: 'Ramu',   serviceTypes: ['North Indian', 'South Indian'] },
  { name: 'Stall 2', domain: 'foodcourt', staffName: 'Chen',   serviceTypes: ['Chinese', 'Fast Food'] },
  { name: 'Stall 3', domain: 'foodcourt', staffName: 'Meena',  serviceTypes: ['Beverages', 'Snacks', 'Desserts'] },

  // Retail
  { name: 'Billing 1', domain: 'retail', staffName: 'Kavya',  serviceTypes: ['Express Checkout (≤5 items)', 'Regular Checkout'] },
  { name: 'Billing 2', domain: 'retail', staffName: 'Suresh', serviceTypes: ['Electronics Billing', 'Online Order Pickup'] },
  { name: 'Billing 3', domain: 'retail', staffName: 'Leena',  serviceTypes: ['Customer Service', 'Returns / Exchange'] },
];

async function seed() {
  await mongoose.connect(MONGO_URI);
  console.log('✅ MongoDB connected');

  // Admin
  const existing = await Admin.findOne({ email: defaultAdmin.email });
  if (existing) {
    console.log('ℹ️  Admin already exists:', defaultAdmin.email);
  } else {
    await Admin.create(defaultAdmin);
    console.log('✅ Superadmin created:', defaultAdmin.email, '/ password:', defaultAdmin.password);
  }

  // Counters — only insert if none exist
  const counterCount = await Counter.countDocuments();
  if (counterCount === 0) {
    await Counter.insertMany(defaultCounters);
    console.log(`✅ Inserted ${defaultCounters.length} counters across all domains`);
  } else {
    console.log(`ℹ️  Counters already exist (${counterCount} found) — skipping`);
  }

  await mongoose.disconnect();
  console.log('\n🎉 Seed complete!\n');
  console.log('  Login:    admin@smartq.com');
  console.log('  Password: smartq123\n');
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err.message);
  process.exit(1);
});
