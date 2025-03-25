const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  user_id: Number,
  username: String,
  name: String,
  phone_number: String,
  tickets: [String]
});

module.exports = mongoose.model('User', userSchema);