const mongoose = require('mongoose');

const ticketSchema = new mongoose.Schema({
  ticket_id: String,
  user_id: Number,
  status: String,
  accepted: { type: Boolean, default: false },
  activeManagerConversation: { type: Boolean, default: false },
  messages: [{ from: String, text: String, timestamp: { type: Date, default: Date.now } }],
  created_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Ticket', ticketSchema);