const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const express = require('express'); // Added Express
require('dotenv').config();

const User = require('./models/User');
const ticketsCommand = require('./commands/tickets');
const ordersCommand = require('./commands/orders');
const messagesHandler = require('./handlers/messages');
const photosHandler = require('./handlers/photos');
const callbackQueryHandler = require('./handlers/callbackQueries');
const { sendMainMenu, startCommand } = require('./commands/start');

const bot = new TelegramBot(process.env.TOKEN, { polling: true });
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });

const orderData = {};
const photoUploadState = {}; 

// СЕРВЕР ДЛЯ БОТА // СЕРВЕР ДЛЯ БОТА // СЕРВЕР ДЛЯ БОТА
const app = express(); 
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'frontend')));

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
// СЕРВЕР ДЛЯ БОТА // СЕРВЕР ДЛЯ БОТА // СЕРВЕР ДЛЯ БОТА

bot.onText(/\/start/, (msg) => startCommand(bot, msg));
bot.on('contact', async (msg) => {
    const chatId = msg.chat.id;
    const contact = msg.contact;
  
    if (contact && contact.phone_number) {
      const user = await User.findOne({ user_id: chatId });
  
      if (user) {
        user.phone_number = contact.phone_number;
        await user.save();
  
        return bot.sendMessage(chatId, "Дякуємо! Тепер введіть Ваше ім'я:", {
          reply_markup: {
            remove_keyboard: true
          }
        });
      } else {
        return bot.sendMessage(chatId, "Помилка: користувача не знайдено.");
      }
    } else {
      return bot.sendMessage(chatId, "Будь ласка, надайте ваш номер телефону.");
    }
});

bot.on('message', (msg) => {
    if (msg.contact) {
        return; 
    }

    messagesHandler(bot, msg, orderData, photoUploadState);
});
bot.onText(/\/tickets/, (msg) => ticketsCommand(bot, msg));
bot.onText(/\/orders/, (msg) => ordersCommand(bot, msg));
bot.on('photo', (msg) => photosHandler(bot, msg, photoUploadState));
bot.on('callback_query', (query) => callbackQueryHandler(bot, query, photoUploadState, orderData));
