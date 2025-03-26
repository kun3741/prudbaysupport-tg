const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const startCommand = require('./commands/start');
const ticketsCommand = require('./commands/tickets');
const ordersCommand = require('./commands/orders');
const messagesHandler = require('./handlers/messages');
const photosHandler = require('./handlers/photos');
const callbackQueryHandler = require('./handlers/callbackQueries');

const bot = new TelegramBot(process.env.TOKEN, { polling: true });
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });


const orderData = {};
const photoUploadState = {};

bot.onText(/\/start/, (msg) => startCommand(bot, msg));
bot.onText(/\/tickets/, (msg) => ticketsCommand(bot, msg));
bot.onText(/\/orders/, (msg) => ordersCommand(bot, msg));
bot.on('message', (msg) => messagesHandler(bot, msg, orderData, photoUploadState));
bot.on('photo', (msg) => photosHandler(bot, msg, photoUploadState));
bot.on('callback_query', (query) => callbackQueryHandler(bot, query, photoUploadState));