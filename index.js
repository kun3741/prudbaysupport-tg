const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
require('dotenv').config();

const bot = new TelegramBot(process.env.TOKEN, { polling: true });
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });

const MANAGER_CHAT_ID = process.env.MANAGER_CHAT_ID;


const Counter = mongoose.model('Counter', new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  value: { type: Number, default: 0 }
}));

const User = mongoose.model('User', new mongoose.Schema({
  user_id: Number,
  username: String,
  name: String,
  phone_number: String,
  tickets: [String]
}));

const Ticket = mongoose.model('Ticket', new mongoose.Schema({
  ticket_id: String,
  user_id: Number,
  status: String,
  accepted: { type: Boolean, default: false },
  activeManagerConversation: { type: Boolean, default: false },
  messages: [{ from: String, text: String, timestamp: { type: Date, default: Date.now } }],
  created_at: { type: Date, default: Date.now }
}));

async function generateTicketId() {
  let counter = await Counter.findOne({ name: 'ticketId' });
  if (!counter) {
    counter = new Counter({ name: 'ticketId', value: 0 });
  }

  counter.value += 1;
  await counter.save();

  const paddedNumber = counter.value.toString().padStart(4, '0');
  return `ticket-${paddedNumber}`;
}

function requestPhoneKeyboard() {
  return {
    keyboard: [
      [
        {
          text: "📱 Надати номер телефону",
          request_contact: true
        }
      ]
    ],
    resize_keyboard: true,
    one_time_keyboard: true
  };
}

function mainMenuKeyboard() {
  return {
      keyboard: [
        ["🙇‍♂️ Зв'язок з менеджером"], ["💚 Статус замовлення"], 
        ["⚡️ Швидкі відповіді", "🚀 Стадії замовлення"]
      ], resize_keyboard: true
    };
}

function chatKeyboard() {
  return {
    keyboard: [
      ["📤 Вийти і завершити чат"]
    ],
    resize_keyboard: true
  };
}

function quickRepliesKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "Чи можливий накладний платіж?", callback_data: "quick_reply_1" }],
      [{ text: "Обмін\\повернення товару з наявності", callback_data: "quick_reply_2" }],
      [{ text: "Обмін\\повернення товару під замовлення", callback_data: "quick_reply_3" }],
      [{ text: "Термін доставки", callback_data: "quick_reply_4" }],
      [{ text: "Вартість доставки", callback_data: "quick_reply_5" }],
      [{ text: "Хочу замовити у Європу", callback_data: "quick_reply_6" }],
      [{ text: "Немає відповіді на моє питання 🤷‍♂️", callback_data: "quick_reply_7" }],
      [{ text: "Меню", callback_data: "quick_reply_menu" }]
    ]
  };
}

async function sendMainMenu(chatId, userName) {
  try {
    const mainMenuImageUrl = 'https://kun.xxxx.rip/854s791y.jpg';

    await bot.sendMessage(chatId, `Вітаємо, ${userName}!`);

    await bot.sendPhoto(chatId, mainMenuImageUrl, {
      caption: `🏡 ГОЛОВНЕ МЕНЮ. \nВикористовуйте кнопки для навігації`,
      reply_markup: mainMenuKeyboard()
    });
  } catch (error) {
    console.error(`Помилка при відправці головного меню: ${error.message}`);

    await bot.sendMessage(chatId, `🏡 ГОЛОВНЕ МЕНЮ. \nВикористовуйте кнопки для навігації`, {
      reply_markup: mainMenuKeyboard()
    });
  }
}


bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const username = msg.chat.username || 'Без імені';

  if (chatId.toString() === MANAGER_CHAT_ID.toString()) {
    return bot.sendMessage(chatId, "Вітаємо, Менеджере! Виберіть опцію:", {
      reply_markup: {
        keyboard: [
          ["Показати активні заявки"],
          ["Історія заявок"]
        ],
        resize_keyboard: true
      }
    });
  }

  let user = await User.findOne({ user_id: chatId });

  if (!user) {
    user = new User({ user_id: chatId, username, name: '', phone_number: '', tickets: [] });
    await user.save();
  }

  if (!user.phone_number) {
    bot.sendMessage(chatId, "Вітаю, я розумний бот prudbaydelivery🤖");
    return bot.sendMessage(chatId, "Надайте ваш номер телефону:", {
      reply_markup: requestPhoneKeyboard()
    });
  }

  if (!user.name || user.name === '') {
    return bot.sendMessage(chatId, "✍️ Будь ласка, введіть Ваше ім'я:");
  }

  return sendMainMenu(chatId, user.name);
});

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

bot.onText(/\/tickets/, async (msg) => {
  const chatId = msg.chat.id;

  if (chatId.toString() !== MANAGER_CHAT_ID.toString()) {
    return bot.sendMessage(chatId, "Ця команда доступна тільки для менеджерів.");
  }

  bot.sendMessage(chatId, "Виберіть тип заявок для перегляду:", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "Всі заявки", callback_data: "view_tickets_all_1" }],
        [{ text: "Відкриті заявки", callback_data: "view_tickets_open_1" }],
        [{ text: "Закриті заявки", callback_data: "view_tickets_closed_1" }]
      ]
    }
  });
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (text && text.startsWith('/')) return;
  if (msg.contact) return;

  const user = await User.findOne({ user_id: chatId });

  if (user && !user.name && user.phone_number) {
    user.name = text;
    await user.save();

    return bot.sendMessage(chatId, `Дякуємо, ${text}! Ваші дані збережено.`, {
      reply_markup: mainMenuKeyboard()
    });
  }

  if (text === "🙇‍♂️ Зв'язок з менеджером") {
    const existingTicket = await Ticket.findOne({ user_id: chatId, status: 'open' });

    if (existingTicket) {
      return bot.sendMessage(chatId, "У вас вже є активна або не прийнята заявка. Будь ласка, дочекайтеся відповіді менеджера.");
    }

    const ticketId = await generateTicketId();

    const ticket = new Ticket({
      ticket_id: ticketId,
      user_id: chatId,
      status: 'open',
      accepted: false,
      activeManagerConversation: false,
      messages: []
    });
    await ticket.save();

    await User.findOneAndUpdate({ user_id: chatId }, { $push: { tickets: ticketId } });

    const kyivDate = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Kiev' }));
    const currentHour = kyivDate.getHours();
    if (currentHour >= 21 || currentHour < 9) {
      bot.sendMessage(chatId, `Наші менеджери після 21:00 відпочивають🥱 Зачекайте будь ласка до 9:00.`);
      bot.sendMessage(chatId, `✍️ Напишіть, будь ласка, питання і очікуйте підключення менеджера...`);
    } else {
      bot.sendMessage(chatId, `Дякуємо, ${user.name}, очікуйте підключення менеджера 😉`);
    }

    const userName = user ? user.name || "Без імені" : "Без імені";
    const userUsername = msg.chat.username || "Без імені користувача";

    bot.sendMessage(MANAGER_CHAT_ID, `Нова заявка ${ticketId} від ${userName} (@${userUsername}). Підтвердити та почати листування?`, {
      reply_markup: {
        inline_keyboard: [[{ text: "Прийняти", callback_data: `accept_${ticketId}` }]]
      }
    });
    return;
  }

  if (text === "⚡️ Швидкі відповіді") {
    bot.sendMessage(chatId, "Виберіть питання:", {
      reply_markup: quickRepliesKeyboard()
    });
    return;
  }

  if (text === "💚 Статус замовлення") {
    bot.sendMessage(chatId, "потім");
    return;
  }

  if (text === "📤 Вийти і завершити чат") {
    const ticket = await Ticket.findOne({ user_id: chatId, status: 'open', accepted: true });

    if (ticket) {
      ticket.status = 'closed';
      ticket.activeManagerConversation = false;
      await ticket.save();

      bot.sendMessage(chatId, `🔒 Ваше звернення закрито.`, {
        reply_markup: mainMenuKeyboard()
      });

      bot.sendMessage(MANAGER_CHAT_ID, `Клієнт ${user.name} закрив заявку ${ticket.ticket_id}.`);
    } else {
      bot.sendMessage(chatId, "У вас немає активних заявок.");
    }
    return;
  }

  if (text === "Показати активні заявки" && chatId.toString() === MANAGER_CHAT_ID.toString()) {
    const activeTickets = await Ticket.find({ status: 'open' });

    if (activeTickets.length === 0) {
      return bot.sendMessage(MANAGER_CHAT_ID, "Немає активних заявок.");
    }

    const inlineKeyboard = activeTickets.map(ticket => {
      return [{ text: `Заявка ${ticket.ticket_id}`, callback_data: `accept_${ticket.ticket_id}` }];
    });

    bot.sendMessage(MANAGER_CHAT_ID, "Активні заявки:", {
      reply_markup: {
        inline_keyboard: inlineKeyboard
      }
    });
    return;
  }

  if (text === "Історія заявок" && chatId.toString() === MANAGER_CHAT_ID.toString()) {
    bot.sendMessage(chatId, "Виберіть тип заявок для перегляду:", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "Всі заявки", callback_data: "view_tickets_all_1" }],
          [{ text: "Відкриті заявки", callback_data: "view_tickets_open_1" }],
          [{ text: "Закриті заявки", callback_data: "view_tickets_closed_1" }]
        ]
      }
    });
    return;
  }

  if (chatId.toString() === MANAGER_CHAT_ID.toString()) {
    console.log("Менеджер надіслав повідомлення:", text);

    const activeTicket = await Ticket.findOne({ 
      status: 'open', 
      accepted: true,
      activeManagerConversation: true
    });

    if (!activeTicket) {
      return bot.sendMessage(MANAGER_CHAT_ID, "Немає активної заявки для відповіді. Виберіть заявку зі списку.", {
        reply_markup: {
          inline_keyboard: [[{ text: "Показати активні заявки", callback_data: "show_active_tickets" }]]
        }
      });
    }

    if (msg.text) {
      activeTicket.messages.push({ from: 'manager', text: msg.text });
      await activeTicket.save();
      await bot.sendMessage(activeTicket.user_id, msg.text);
    } else if (msg.photo) {
      const fileId = msg.photo[msg.photo.length - 1].file_id;
      const caption = msg.caption || '';
      activeTicket.messages.push({ from: 'manager', text: 'Фото' });
      await activeTicket.save();
      await bot.sendPhoto(activeTicket.user_id, fileId, { caption });
    } else if (msg.document) {
      const fileId = msg.document.file_id;
      activeTicket.messages.push({ from: 'manager', text: 'Документ' });
      await activeTicket.save();
      await bot.sendDocument(activeTicket.user_id, fileId);
    } else if (msg.sticker) {
      const fileId = msg.sticker.file_id;
      activeTicket.messages.push({ from: 'manager', text: 'Стікер' });
      await activeTicket.save();
      await bot.sendSticker(activeTicket.user_id, fileId);
    } else if (msg.video) {
      const fileId = msg.video.file_id;
      activeTicket.messages.push({ from: 'manager', text: 'Відео' });
      await activeTicket.save();
      await bot.sendVideo(activeTicket.user_id, fileId);
    } else if (msg.forward_from_chat) {
      const forwardFromChatId = msg.forward_from_chat.id;
      const messageId = msg.forward_from_message_id;
      activeTicket.messages.push({ from: 'manager', text: 'Переслане повідомлення' });
      await activeTicket.save();
      await bot.forwardMessage(activeTicket.user_id, forwardFromChatId, messageId);
    }
  } else {
    console.log(`Користувач надіслав повідомлення:`, text);

    const activeTicket = await Ticket.findOne({ 
      user_id: chatId, 
      status: 'open',
      accepted: true 
    });

    if (activeTicket) {
      if (msg.text) {
        activeTicket.messages.push({ from: 'user', text: msg.text });
        await activeTicket.save();
        await bot.sendMessage(MANAGER_CHAT_ID, `Від ${user.name} (@${msg.chat.username}, ID заявки: ${activeTicket.ticket_id}):\n${msg.text}`);
      } else if (msg.photo) {
        const fileId = msg.photo[msg.photo.length - 1].file_id;
        const caption = msg.caption || '';
        activeTicket.messages.push({ from: 'user', text: 'Фото' });
        await activeTicket.save();
        await bot.sendPhoto(MANAGER_CHAT_ID, fileId, { caption: `Від ${user.name} (@${msg.chat.username}, ID заявки: ${activeTicket.ticket_id})\n${caption}` });
      } else if (msg.document) {
        const fileId = msg.document.file_id;
        activeTicket.messages.push({ from: 'user', text: 'Документ' });
        await activeTicket.save();
        await bot.sendDocument(MANAGER_CHAT_ID, fileId, { caption: `Від ${user.name} (@${msg.chat.username}, ID заявки: ${activeTicket.ticket_id})` });
      } else if (msg.sticker) {
        const fileId = msg.sticker.file_id;
        activeTicket.messages.push({ from: 'user', text: 'Стікер' });
        await activeTicket.save();
        await bot.sendSticker(MANAGER_CHAT_ID, fileId);
      } else if (msg.video) {
        const fileId = msg.video.file_id;
        activeTicket.messages.push({ from: 'user', text: 'Відео' });
        await activeTicket.save();
        await bot.sendVideo(MANAGER_CHAT_ID, fileId, { caption: `Від ${user.name} (@${msg.chat.username}, ID заявки: ${activeTicket.ticket_id})` });
      } else if (msg.forward_from_chat) {
        const forwardFromChatId = msg.forward_from_chat.id;
        const messageId = msg.forward_from_message_id;
        activeTicket.messages.push({ from: 'user', text: 'Переслане повідомлення' });
        await activeTicket.save();
        await bot.forwardMessage(MANAGER_CHAT_ID, forwardFromChatId, messageId);
      }
    } else {
      const pendingTicket = await Ticket.findOne({
        user_id: chatId,
        status: 'open',
        accepted: false
      });

      if (pendingTicket) {
        if (msg.text) {
          pendingTicket.messages.push({ from: 'user', text: msg.text });
          await pendingTicket.save();
          bot.sendMessage(chatId, `Дякуємо, ${user.name}, очікуйте підключення менеджера 😉`);
        } else if (msg.photo) {
          const fileId = msg.photo[msg.photo.length - 1].file_id;
          const caption = msg.caption || '';
          pendingTicket.messages.push({ from: 'user', text: 'Фото' });
          await pendingTicket.save();
          await bot.sendPhoto(MANAGER_CHAT_ID, fileId, { caption: `Від ${user.name} (@${msg.chat.username}, ID заявки: ${pendingTicket.ticket_id})\n${caption}` });
        } else if (msg.document) {
          const fileId = msg.document.file_id;
          pendingTicket.messages.push({ from: 'user', text: 'Документ' });
          await pendingTicket.save();
          await bot.sendDocument(MANAGER_CHAT_ID, fileId, { caption: `Від ${user.name} (@${msg.chat.username}, ID заявки: ${pendingTicket.ticket_id})` });
        } else if (msg.sticker) {
          const fileId = msg.sticker.file_id;
          pendingTicket.messages.push({ from: 'user', text: 'Стікер' });
          await pendingTicket.save();
          await bot.sendSticker(MANAGER_CHAT_ID, fileId);
        } else if (msg.video) {
          const fileId = msg.video.file_id;
          pendingTicket.messages.push({ from: 'user', text: 'Відео' });
          await pendingTicket.save();
          await bot.sendVideo(MANAGER_CHAT_ID, fileId, { caption: `Від ${user.name} (@${msg.chat.username}, ID заявки: ${pendingTicket.ticket_id})` });
        } else if (msg.forward_from_chat) {
          const forwardFromChatId = msg.forward_from_chat.id;
          const messageId = msg.forward_from_message_id;
          pendingTicket.messages.push({ from: 'user', text: 'Переслане повідомлення' });
          await pendingTicket.save();
          await bot.forwardMessage(MANAGER_CHAT_ID, forwardFromChatId, messageId);
        }
      } else {
        bot.sendMessage(chatId, "У вас немає активних заявок. Виберіть '🙇‍♂️ Зв'язок з менеджером', щоб створити нову заявку.");
      }
    }
  }
});

const TICKETS_PER_PAGE = 5;

async function showTicketsHistory(chatId, type, page = 1, messageId = null) {
  let tickets = [];
  let ticketQuery = {};

  if (type === "all") {
    ticketQuery = {};
  } else if (type === "open") {
    ticketQuery = { status: 'open' };
  } else if (type === "closed") {
    ticketQuery = { status: 'closed' };
  }

  tickets = await Ticket.find(ticketQuery).sort({ created_at: -1 });

  if (tickets.length === 0) {
    const messageText = "Заявок цього типу не знайдено.";
    const replyMarkup = {
      inline_keyboard: [
        [{ text: "Назад", callback_data: "back_to_ticket_options" }]
      ]
    };

    if (messageId) {
      await bot.editMessageText(messageText, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: replyMarkup
      });
    } else {
      await bot.sendMessage(chatId, messageText, {
        reply_markup: replyMarkup
      });
    }
    return;
  }

  const totalPages = Math.ceil(tickets.length / TICKETS_PER_PAGE);
  const startIndex = (page - 1) * TICKETS_PER_PAGE;
  const endIndex = startIndex + TICKETS_PER_PAGE;
  const ticketsToShow = tickets.slice(startIndex, endIndex);

  const formattedTickets = await Promise.all(ticketsToShow.map(async (ticket) => {
    const user = await User.findOne({ user_id: ticket.user_id });
    const userName = user ? user.username || "Без імені користувача" : "Без імені користувача";

    const date = new Date(ticket.created_at);
    const formattedDate = `${date.getDate()}.${date.getMonth() + 1}.${date.getFullYear()} ${date.getHours()}:${date.getMinutes().toString().padStart(2, '0')}`;

    return {
      text: `[${formattedDate}] ${ticket.ticket_id} @${userName}`,
      callback_data: `details_${ticket.ticket_id}`
    };
  }));

  const ticketButtons = formattedTickets.map(ticket => {
    return [{ text: ticket.text, callback_data: ticket.callback_data }];
  });

  const navigationButtons = [];
  if (page > 1) {
    navigationButtons.push({ text: "⬅️ Назад", callback_data: `view_tickets_${type}_${page - 1}` });
  }
  if (page < totalPages) {
    navigationButtons.push({ text: "➡️ Вперед", callback_data: `view_tickets_${type}_${page + 1}` });
  }

  const messageText = "Виберіть заявку для перегляду деталей:";
  const replyMarkup = {
    inline_keyboard: [
      ...ticketButtons,
      navigationButtons,
      [{ text: "Назад", callback_data: "back_to_ticket_options" }]
    ]
  };

  if (messageId) {
    await bot.editMessageText(messageText, {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: replyMarkup
    });
  } else {
    await bot.sendMessage(chatId, messageText, {
      reply_markup: replyMarkup
    });
  }
}

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const data = query.data;

  if (data.startsWith("quick_reply_")) {
    switch (data) {
      case "quick_reply_1":
        bot.editMessageText(`Чи можливий накладний платіж?\n\nЯкщо товар в наявності в Україні🇺🇦\n\n1️⃣ По повній оплаті за реквізитами.\n\n2️⃣ При отриманні замовлення на пошті (діє 150 грн передплата).\n\n- Ми змушені брати 150 грн передоплати для того щоб компенсувати вартість доставки в обидві сторони, за умови якщо клієнт на забере товар на пошті. Це не додаткова оплата, ми відрахуємо цю суму від вартості товару.`, {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: {
            inline_keyboard: [
              [{ text: "Гаразд, якщо товар під замовлення з-за кордону? 🇨🇳", callback_data: "quick_reply_1_1" }],
              [{ text: "◀️ Назад", callback_data: "quick_reply_back" }],
              [{ text: "Меню", callback_data: "quick_reply_menu" }]
            ]
          }
        });
        break;
      case "quick_reply_1_1":
        bot.editMessageText(`1️⃣ Передоплата 100% від вартості товару, оплата за доставку повідомляється Вам разом із фото-звітом\n\n- під замовлення означає що ми привеземо товар необхідної Вам моделі у необхідному Вам розмірі, тобто це індивідуальне замовлення спеціально для Вас, а передоплату 100% від вартості ми змушені брати щоб бути впевненому, що Ви дочекаєтеся коли прибуде Ваше замовлення.`, {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: {
            inline_keyboard: [
              [{ text: "◀️ Назад", callback_data: "quick_reply_back" }],
              [{ text: "Меню", callback_data: "quick_reply_menu" }]
            ]
          }
        });
        break;
      case "quick_reply_2":
        bot.editMessageText(`Обмін\\повернення товару з наявності\n\nУ нас є можливість обміну/повернення товару в період 7 днів з моменту замовлення🔄\n\nУмови обміну/повернення:\n\n1️⃣ Товар не носився, він чистий та збережено його товарний вигляд.\n\n2️⃣ Збережено заводську упаковку та всі бірки.\n\n3️⃣ Оплату за доставку обміну/повернення здійснює покупець`, {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: {
            inline_keyboard: [
              [{ text: "◀️ Назад", callback_data: "quick_reply_back" }],
              [{ text: "Меню", callback_data: "quick_reply_menu" }]
            ]
          }
        });
        break;
      case "quick_reply_3":
        bot.editMessageText(`Обмін\\повернення товару під замовлення\n\n1️⃣ Ми привезли не той товар що Ви замовляли.\n2️⃣ Ми привезли не той розмір що Ви замовляли.\n3️⃣ Ми привезли товар з браком ( Пляма, пошкодження )\n\nТакож, хочемо пояснити що “під замовлення” означає що ми замовляємо з-за кордону 1 розмір певної моделі спеціально для Вас. Це індивідуальне замовлення. Тому Ви не зможете його повернути якщо Вам модель не сподобається або розмір не підійде.`, {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: {
            inline_keyboard: [
              [{ text: "◀️ Назад", callback_data: "quick_reply_back" }],
              [{ text: "Меню", callback_data: "quick_reply_menu" }]
            ]
          }
        });
        break;
      case "quick_reply_4":
        bot.editMessageText(`Термін доставки\n\nДоставка товару з наявності 🇺🇦 відбувається в період 1-3 робочих днів з моменту отримання передоплати🚛\n\nДоставка товару під замовлення 🇨🇳 відбувається в період 10-20 робочих днів✈️`, {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: {
            inline_keyboard: [
              [{ text: "◀️ Назад", callback_data: "quick_reply_back" }],
              [{ text: "Вартість доставки", callback_data: "quick_reply_5" }],
              [{ text: "Меню", callback_data: "quick_reply_menu" }]
            ]
          }
        });
        break;
      case "quick_reply_5":
        bot.editMessageText(`Вартість доставки\n\n1 кг — 18$.\nЯкщо замовлення важить менше 0.5 кг, вартість доставки розраховується як за 0.5 кг.`, {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: {
            inline_keyboard: [
              [{ text: "◀️ Назад", callback_data: "quick_reply_back" }],
              [{ text: "Меню", callback_data: "quick_reply_menu" }]
            ]
          }
        });
        break;
      case "quick_reply_6":
        bot.editMessageText(`Хочу замовити у Європу\n\nНе проблема! Ми викупляємо товар та відправляємо Вам напряму з Китаю 🇨🇳, який згодом доставляється DHL на вашу адресу.`, {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: {
            inline_keyboard: [
              [{ text: "◀️ Назад", callback_data: "quick_reply_back" }],
              [{ text: "Меню", callback_data: "quick_reply_menu" }]
            ]
          }
        });
        break;
      case "quick_reply_7":
          const ticketId = await generateTicketId();
  
          const ticket = new Ticket({
            ticket_id: ticketId,
            user_id: chatId,
            status: 'open',
            accepted: false,
            activeManagerConversation: false,
            messages: []
          });
          await ticket.save();
  
          await User.findOneAndUpdate({ user_id: chatId }, { $push: { tickets: ticketId } });
  
          const kyivDate = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Kiev' }));
          const currentHour = kyivDate.getHours();
          if (currentHour >= 21 || currentHour < 9) {
            bot.sendMessage(chatId, `Наші менеджери після 21:00 відпочивають🥱 Зачекайте будь ласка до 9:00.`);
            bot.sendMessage(chatId, `✍️ Напишіть, будь ласка, питання і очікуйте підключення менеджера...`);
          } else {
            bot.sendMessage(chatId, `Дякуємо, очікуйте підключення менеджера 😉`);
          }
  
          const user = await User.findOne({ user_id: chatId });
          const userName = user ? user.name || "Без імені" : "Без імені";
          const userUsername = query.message.chat.username || "Без імені користувача";
  
          bot.sendMessage(MANAGER_CHAT_ID, `Нова заявка ${ticketId} від ${userName} (@${userUsername}). Підтвердити та почати листування?`, {
            reply_markup: {
              inline_keyboard: [[{ text: "Прийняти", callback_data: `accept_${ticketId}` }]]
            }
          });
          break;
      case "quick_reply_back":
        bot.editMessageText("Виберіть питання:", {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: quickRepliesKeyboard()
        });
        break;
      case "quick_reply_menu":
        bot.sendMessage(chatId, "🏡 ГОЛОВНЕ МЕНЮ. \nВикористовуйте кнопки для навігації", {
          reply_markup: mainMenuKeyboard()
        });
        break;
    }
    bot.answerCallbackQuery(query.id);
    return;
  }

  if (data.startsWith("accept_")) {
    const ticketId = data.split("_")[1];
    const ticket = await Ticket.findOne({ ticket_id: ticketId });

    if (ticket) {
      ticket.accepted = true;
      ticket.activeManagerConversation = true;
      await ticket.save();

      await Ticket.updateMany(
        { ticket_id: { $ne: ticketId }, activeManagerConversation: true },
        { activeManagerConversation: false }
      );

      const user = await User.findOne({ user_id: ticket.user_id });
      const userName = user ? user.name || "Без імені" : "Без імені";

      bot.sendMessage(ticket.user_id, `✅ В чат підключився менеджер prudbaydelivery ®`, {
        reply_markup: {
          keyboard: [["📤 Вийти і завершити чат"]],
          resize_keyboard: true
        }
      });

      if (ticket.messages.length > 0) {
        const userMessages = ticket.messages.filter(msg => msg.from === 'user');
        if (userMessages.length > 0) {
          let messagesText = `Повідомлення від ${userName} (${ticketId}):\n`;
          userMessages.forEach(msg => {
            messagesText += `- ${msg.text}\n`;
          });
          bot.sendMessage(MANAGER_CHAT_ID, messagesText);
        }
      }

      bot.sendMessage(MANAGER_CHAT_ID, `Заявка ${ticketId} прийнята. Напишіть повідомлення клієнту.`, {
        reply_markup: {
          inline_keyboard: [[{ text: "Завершити листування", callback_data: `close_${ticketId}_manager` }]]
        }
      });

      bot.answerCallbackQuery(query.id, { text: `Заявку ${ticketId} прийнято` });
    }
  }  
  else if (data.startsWith("close_")) {
    const [_, ticketId, role] = data.split("_");
    const ticket = await Ticket.findOne({ ticket_id: ticketId });

    if (!ticket) {
      bot.answerCallbackQuery(query.id, { text: "Заявку не знайдено" });
      return;
    }

    if (ticket.status === 'closed') {
      bot.answerCallbackQuery(query.id, { text: `Заявка ${ticketId} вже закрита` });

      if (role === "manager") {
        bot.sendMessage(MANAGER_CHAT_ID, `Заявка ${ticketId} вже закрита.`);
      } else if (role === "user") {
        bot.sendMessage(chatId, `🔒 Ваше звернення вже закрито.`);
      }
      return;
    }

    ticket.status = 'closed';
    ticket.activeManagerConversation = false;
    await ticket.save();

    const user = await User.findOne({ user_id: ticket.user_id });
    const userName = user ? user.name || "Без імені" : "Без імені";

    if (role === "manager") {
      bot.sendMessage(ticket.user_id, `🔒 Ваше звернення закрито.`, {
        reply_markup: mainMenuKeyboard()
      });
      bot.sendMessage(MANAGER_CHAT_ID, `Листування по заявці ${ticketId} завершено.`);
    } else if (role === "user") {
      bot.sendMessage(MANAGER_CHAT_ID, `Клієнт ${userName} закрив заявку ${ticketId}.`, {
        reply_markup: {
          inline_keyboard: [[{ text: "Закрити заявку в системі", callback_data: `close_${ticketId}_manager` }]]
        }
      });
      bot.sendMessage(ticket.user_id, `🔒 Ваше звернення закрито.`, {
        reply_markup: mainMenuKeyboard()
      });
    }

    bot.answerCallbackQuery(query.id, { text: `Заявку ${ticketId} закрито` });
  }

  if (data.startsWith("view_tickets_")) {
    const parts = data.split("_");
    const type = parts[2];
    const page = parseInt(parts[3], 10);
    await showTicketsHistory(chatId, type, page, messageId);
    bot.answerCallbackQuery(query.id);
    return;
  }

  if (data.startsWith("details_")) {
    const ticketId = data.split("_")[1];
    const ticket = await Ticket.findOne({ ticket_id: ticketId });

    if (!ticket) {
      bot.answerCallbackQuery(query.id, { text: "Заявку не знайдено" });
      return;
    }

    const user = await User.findOne({ user_id: ticket.user_id });
    const userName = user ? user.name || "Без імені" : "Без імені";
    const userUsername = user ? user.username || "Без імені користувача" : "Без імені користувача";

    const date = new Date(ticket.created_at);
    const formattedDate = `${date.getDate()}.${date.getMonth() + 1}.${date.getFullYear()} ${date.getHours()}:${date.getMinutes().toString().padStart(2, '0')}`;

    let message = `🎫 *Детальна інформація про заявку ${ticket.ticket_id}*\n`
      + `👤 Користувач: ${userName} (@${userUsername})\n`
      + `📅 Створено: ${formattedDate}\n`
      + `📊 Статус: ${ticket.status === 'open' ? '🟢 Відкрита' : '🔴 Закрита'}\n`
      + `📨 Прийнята: ${ticket.accepted ? '✅' : '❌'}\n\n`
      + `*Історія повідомлень:*\n`;

    if (ticket.messages.length === 0) {
      message += "Повідомлень немає.";
    } else {
      ticket.messages.forEach((msg, index) => {
        const msgDate = new Date(msg.timestamp);
        const msgTime = `${msgDate.getHours()}:${msgDate.getMinutes().toString().padStart(2, '0')}`;

        message += `${index + 1}. ${msg.from === 'user' ? '👤 Користувач' : '👨‍💼 Менеджер'} (${msgTime}):\n${msg.text}\n\n`;
      });
    }

    await bot.editMessageText(message, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "Назад до списку", callback_data: "back_to_ticket_list" }]
        ]
      }
    });

    bot.answerCallbackQuery(query.id);
    return;
  }

  if (data === "back_to_ticket_options") {
    bot.editMessageText("Виберіть тип заявок для перегляду:", {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: {
        inline_keyboard: [
          [{ text: "Всі заявки", callback_data: "view_tickets_all_1" }],
          [{ text: "Відкриті заявки", callback_data: "view_tickets_open_1" }],
          [{ text: "Закриті заявки", callback_data: "view_tickets_closed_1" }]
        ]
      }
    });
    bot.answerCallbackQuery(query.id);
    return;
  }

  if (data === "back_to_ticket_list") {
    const type = "all"; // або "open" або "closed" залежно від вашої логіки
    await showTicketsHistory(chatId, type, 1, messageId);
    bot.answerCallbackQuery(query.id);
    return;
  }
});

bot.on('callback_query', async (query) => {
  if (query.data === "current_page") {
    bot.answerCallbackQuery(query.id, { text: "Ви вже на цій сторінці" });
  }
});

// Ініціалізація лічильника
async function initializeCounter() {
  const counter = await Counter.findOne({ name: 'ticketId' });
  if (!counter) {
    await new Counter({ name: 'ticketId', value: 0 }).save();
    console.log('Лічильник заявок ініціалізовано');
  }
}


initializeCounter().catch(err => console.error('Помилка ініціалізації лічильника:', err));