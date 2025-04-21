const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  username: String,
  fullName: String,
  phoneNumber: String,
  city: String,
  novaPost: String,
  orderId: String,
  productName: String,
  deliveryPrice: Number,
  status: { type: String, default: "Замовлення створено" },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Order', orderSchema);