const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  username: String,
  fullName: String,
  phoneNumber: String,
  city: String,
  npDepartment: String,
  orderId: String,
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Order', orderSchema);