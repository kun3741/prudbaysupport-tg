require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { initAirtable } = require('./utils/airtable');

const User = require('./models/User');
const { messagesHandler } = require('./handlers/messages');
const photosHandler = require('./handlers/photos');
const callbackQueryHandler = require('./handlers/callbackQueries');
const { sendMainMenu, startCommand } = require('./commands/start');
const { startInactivityMonitor } = require('./utils/ticketInactivityMonitor');

const bot = new TelegramBot(process.env.TOKEN, { polling: true });

mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => {
        console.log("MongoDB підключено успішно.");
        startInactivityMonitor(bot);
    })
    .catch(err => {
        console.error("ПОМИЛКА підключення до MongoDB:", err);
        process.exit(1);
    });

initAirtable();

const orderData = {}; 
const photoUploadState = {}; 
const profileViewState = {};
const addressChangeState = {};
const directMessageState = {};
const bonusChangeState = {};
const shippingInfoState = {};
const receiptUploadState = {};
const broadcastState = {};

const app = express();
const PORT = process.env.PORT || 3000;


app.get('/', (req, res) => {
    res.send('Telegram bot server is running successfully.');
});

app.listen(PORT, () => {
    console.log(`Сервер запущено на порту ${PORT}`);
});


bot.onText(/\/start/, (msg) => startCommand(bot, msg));

bot.on('contact', async (msg) => {
  const chatId = msg.chat.id;
  const contact = msg.contact;

  if (!contact || !contact.phone_number || (contact.user_id && contact.user_id !== chatId)) {
    if (contact && contact.user_id && contact.user_id !== chatId) {
        console.warn(`User ${chatId} tried to send contact of user ${contact.user_id}. Ignoring.`);
    }
    return bot.sendMessage(chatId, "Будь ласка, поділіться своїм власним номером телефону через кнопку '📱 Надати номер телефону'.");
  }
  
  try {
      let user = await User.findOne({ user_id: chatId });
      if (!user) {
          user = new User({ 
              user_id: chatId, 
              username: msg.from.username || '',
              name: '',
              phone_number: '',
              tickets: [] 
          });
      }
      
      user.phone_number = contact.phone_number;
      await user.save();

      if (!user.name || user.name === '') {
          return bot.sendMessage(chatId, "Дякуємо! Тепер введіть Ваше ім'я:", {
              reply_markup: { remove_keyboard: true } 
          });
      } else {
          await bot.sendMessage(chatId, `Дякуємо, ${user.name}! Ваш номер телефону збережено/оновлено.`, { reply_markup: { remove_keyboard: true } });
          return sendMainMenu(bot, chatId, user.name);
      }
  } catch(error) {
       console.error("Помилка обробки контакту:", error);
       await bot.sendMessage(chatId, "Виникла помилка при збереженні номеру. Спробуйте ще раз або зверніться до підтримки.");
  }
});


bot.on('message', (msg) => {
    if (msg.contact) return;
    messagesHandler(bot, msg, orderData, photoUploadState, profileViewState, addressChangeState, directMessageState, bonusChangeState, shippingInfoState, receiptUploadState, broadcastState);
});

bot.on('photo', (msg) => photosHandler(bot, msg, photoUploadState, receiptUploadState));
bot.on('document', (msg) => photosHandler(bot, msg, photoUploadState, receiptUploadState));

bot.on('callback_query', (query) => {
    callbackQueryHandler(bot, query, photoUploadState, orderData, profileViewState, addressChangeState, directMessageState, bonusChangeState, shippingInfoState, receiptUploadState, broadcastState);
});

bot.on('polling_error', (error) => {
  console.error(`ПОМИЛКА Polling: ${error.code} - ${error.message ? error.message : JSON.stringify(error)}`);
  if (error.message && error.message.includes("ETELEGRAM")) {
    console.error("Telegram API error details:", error.message);
  }
});

bot.on('webhook_error', (error) => {
    console.error(`ПОМИЛКА Webhook: ${error.code} - ${error.message}`);
});

process.on('uncaughtException', (error, origin) => {
    console.error('Неперехоплена помилка (uncaughtException):', error, 'Origin:', origin);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('Необроблений проміс (unhandledRejection):', promise, 'Причина:', reason);
});


console.log('Бот успішно запущено... очікування подій.');

