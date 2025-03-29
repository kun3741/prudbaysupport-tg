const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  username: String,
  fullName: String,
  phoneNumber: String,
  city: String,
  novaPost: String,
  orderId: String,
  deliveryPrice: Number, // New field for delivery cost
  status: { type: String, default: "Замовлення створено" }, // New field for order status
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Order', orderSchema);