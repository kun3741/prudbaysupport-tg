const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  user_id: Number,
  username: String,
  name: String,
  phone_number: String,
  tickets: [String],
  bonusBalance: { type: Number, default: 0 },
  deliveryFullName: String,
  deliveryPhoneNumber: String,
  deliveryCity: String,
  deliveryNovaPost: String
});

module.exports = mongoose.model('User', userSchema);