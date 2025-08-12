const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  username: String,
  fullName: String,
  englishFullName: String,
  phoneNumber: String,
  city: String,
  novaPost: String,
  
  direction: { type: String, enum: ['В Україну', 'За кордон'], default: 'В Україну' },
  country: String,
  region: String,
  address: String,
  postcode: String,
  
  totalPrice: Number, // Вартість товару
  netProfit: Number,  // Чистий прибуток
  orderId: String,
  productName: String,
  deliveryPrice: Number,
  status: { type: String, default: "Замовлення створено" },
  createdAt: { type: Date, default: Date.now },
  shippingDate: String,
  estimatedArrivalDate: String,
  trackingLink: String,
  receiptSent: { type: Boolean, default: false }
});

module.exports = mongoose.model('Order', orderSchema);