require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { initAirtable } = require('./utils/airtable');

const User = require('./models/User');
const ticketsCommand = require('./commands/tickets');
const ordersCommand = require('./commands/orders');
const messagesHandler = require('./handlers/messages');
const photosHandler = require('./handlers/photos');
const callbackQueryHandler = require('./handlers/callbackQueries');
const { sendMainMenu, startCommand } = require('./commands/start');

const bot = new TelegramBot(process.env.TOKEN, { polling: true });
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log("MongoDB підключено успішно."))
    .catch(err => console.error("ПОМИЛКА підключення до MongoDB:", err));

initAirtable();

const orderData = {};
const photoUploadState = {};

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'frontend')));

app.get('/', (req, res) => {
    res.send('Telegram bot server is running.');
});


app.listen(PORT, () => {
    console.log(`Сервер запущено на порту ${PORT}`);
});



bot.onText(/\/start/, (msg) => startCommand(bot, msg));

bot.on('contact', async (msg) => {
  const chatId = msg.chat.id;
  const contact = msg.contact;
  if (contact && contact.phone_number) {
    try {
        const user = await User.findOneAndUpdate(
            { user_id: chatId },
            { phone_number: contact.phone_number },
            { new: true, upsert: false }
        );
        if (user) {
            if (!user.name || user.name === '') {
                 return bot.sendMessage(chatId, "Дякуємо! Тепер введіть Ваше ім'я:", {
                     reply_markup: { remove_keyboard: true }
                 });
            } else {
                 await bot.sendMessage(chatId, `Номер телефону оновлено.`, { reply_markup: { remove_keyboard: true } });
                 return sendMainMenu(bot, chatId, user.name);
            }
        } else {
             await bot.sendMessage(chatId, "Будь ласка, спочатку натисніть /start для реєстрації.", {
                reply_markup: { remove_keyboard: true }
             });
        }
    } catch(error) {
         console.error("Помилка обробки контакту:", error);
         await bot.sendMessage(chatId, "Виникла помилка при збереженні номеру.");
    }
  } else {
    return bot.sendMessage(chatId, "Будь ласка, надайте ваш номер телефону через кнопку.");
  }
});


bot.on('message', (msg) => {
    if (msg.contact) {
        return;
    }
    messagesHandler(bot, msg, orderData, photoUploadState);
});

bot.on('photo', (msg) => photosHandler(bot, msg, photoUploadState));

bot.on('callback_query', (query) => callbackQueryHandler(bot, query, photoUploadState, orderData));

bot.on('polling_error', (error) => {
  console.error(`ПОМИЛКА Polling: ${error.code} - ${error.message}`);
});

bot.on('webhook_error', (error) => {
    console.error(`ПОМИЛКА Webhook: ${error.code} - ${error.message}`);
});

process.on('uncaughtException', (error) => {
    console.error('Неперехоплена помилка:', error);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('Необроблений проміс:', promise, 'Причина:', reason);
});


console.log('Бот успішно запущено...');

bot.onText(/\/tickets/, (msg) => ticketsCommand(bot, msg));
bot.onText(/\/orders/, (msg) => ordersCommand(bot, msg));
