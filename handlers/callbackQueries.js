const Ticket = require('../models/Ticket');
const Order = require('../models/Order');
const User = require('../models/User');
const { mainMenuKeyboard, quickRepliesKeyboard } = require('../utils/keyboards');
const Counter = require('../models/Counter');
const { showTicketsHistory, showTicketDetails } = require('../commands/tickets');

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

async function callbackQueryHandler(bot, query, photoUploadState) {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const data = query.data;

  if (query.data === "current_page") {
    bot.answerCallbackQuery(query.id, { text: "Ви вже на цій сторінці" });
  }

  if (data.startsWith("change_status_")) {
    const orderId = data.split("_")[2];
    const order = await Order.findOne({ orderId });

    if (!order) {
      return bot.answerCallbackQuery(query.id, { text: "Замовлення не знайдено." });
    }

    return bot.editMessageText(`Виберіть новий статус для замовлення ID: ${orderId}`, {
      chat_id: chatId,
      message_id: query.message.message_id,
      reply_markup: {
        inline_keyboard: [
          [{ text: "Замовлення прийнято та на етапі купівлі ✅", callback_data: `set_status_${orderId}_1` }],
          [{ text: "Товар викуплено та відправлено на склад в Китаї ✅", callback_data: `set_status_${orderId}_2` }],
          [{ text: "Товар прибув на склад та готується до перевірки ✅", callback_data: `set_status_${orderId}_3` }],
          [{ text: "Надіслати фото-звіт", callback_data: `set_status_${orderId}_4_photo` }],
          [{ text: "Посилка пройшла перевірку та комплектується ✅", callback_data: `set_status_${orderId}_4_pack` }],
          [{ text: "Посилка успішно скомплектована та готується до відправки ✅", callback_data: `set_status_${orderId}_5` }],
          [{ text: "Посилка прибула до України та готується до відправлення ✅", callback_data: `set_status_${orderId}_6` }]
        ]
      }
    });
  }

  if (data.startsWith("set_status_")) {
    const parts = data.split("_");
    const orderId = parts[2];
    const status = parts[3];
    const action = parts[4];

    const order = await Order.findOne({ orderId });

    if (!order) {
      return bot.answerCallbackQuery(query.id, { text: "Замовлення не знайдено." });
    }

    let statusMessage = "";

    switch (status) {
      case "1":
        statusMessage = "Замовлення прийнято та на етапі купівлі ✅";
        break;
      case "2":
        statusMessage = "Товар викуплено та відправлено на склад в Китаї ✅";
        break;
      case "3":
        if (!photoUploadState[chatId]) {
          photoUploadState[chatId] = { orderId, photos: [] };
        }
        return bot.editMessageText("Будь ласка, надішліть групу фото для перевірки. Коли завершите, натисніть кнопку 'Підтвердити фотозвіт'.", {
          chat_id: chatId,
          message_id: query.message.message_id,
          reply_markup: {
            inline_keyboard: [
              [{ text: "Підтвердити фотозвіт", callback_data: `confirm_photo_report_${orderId}` }]
            ]
          }
        });
      case "4":
        if (action === "photo") {
          photoUploadState[chatId] = { orderId, photos: [] };
          return bot.editMessageText("Будь ласка, надішліть групу фото, які потрібно переслати клієнту. Коли завершите, натисніть кнопку 'Завершити завантаження'.", {
            chat_id: chatId,
            message_id: query.message.message_id,
            reply_markup: {
              inline_keyboard: [
                [{ text: "Завершити завантаження", callback_data: `finish_photo_upload_${orderId}` }]
              ]
            }
          });
        } else if (action === "pack") {
          statusMessage = "Посилка пройшла перевірку та комплектується.";
        }
        break;
      case "5":
        statusMessage = "Посилка успішно скомплектована та готується до відправки ✅";
        photoUploadState[chatId] = { orderId };
        return bot.editMessageText("Введіть вартість доставки для цього замовлення:", {
          chat_id: chatId,
          message_id: query.message.message_id
        });
      case "6":
        statusMessage = "Посилка прибула до України та готується до відправлення ✅";
        break;
      default:
        return bot.answerCallbackQuery(query.id, { text: "Невідомий статус." });
    }

    if (statusMessage) {
      order.status = statusMessage;
      await order.save();

      bot.answerCallbackQuery(query.id, { text: "Статус оновлено." });

      bot.sendMessage(chatId, `Статус замовлення ID: ${orderId} оновлено на:\n${statusMessage}`);

      const user = await User.findOne({ username: order.username });
      if (user) {
        bot.sendMessage(user.user_id, `Ваше замовлення ID: ${orderId} оновлено на:\n${statusMessage}`);
      }
    }
  }

  if (data.startsWith("finish_photo_upload_")) {
    const orderId = data.split("_")[2];

    if (!photoUploadState[chatId] || photoUploadState[chatId].orderId !== orderId) {
      return bot.answerCallbackQuery(query.id, { text: "Немає фото для завантаження." });
    }

    const photos = photoUploadState[chatId].photos;

    if (photos.length === 0) {
      return bot.answerCallbackQuery(query.id, { text: "Ви не завантажили жодного фото." });
    }

    const order = await Order.findOne({ orderId });
    const user = await User.findOne({ username: order.username });

    if (user) {
      await bot.sendMediaGroup(user.user_id, photos.map(photo => ({ type: "photo", media: photo })));
      await bot.sendMessage(user.user_id, `Ваше замовлення ID: ${orderId} оновлено. Надіслано фото-звіт.`);
    }

    delete photoUploadState[chatId];

    bot.answerCallbackQuery(query.id, { text: "Фото успішно надіслано клієнту." });
    return bot.editMessageText(`Фото-звіт для замовлення ID: ${orderId} успішно надіслано клієнту.`, {
      chat_id: chatId,
      message_id: query.message.message_id
    });
  }

  if (data.startsWith("confirm_photo_report_")) {
    const orderId = data.split("_")[2];

    if (!photoUploadState[chatId] || photoUploadState[chatId].orderId !== orderId) {
      return bot.answerCallbackQuery(query.id, { text: "Немає фото для підтвердження." });
    }

    const photos = photoUploadState[chatId].photos;

    if (photos.length === 0) {
      return bot.answerCallbackQuery(query.id, { text: "Ви не завантажили жодного фото." });
    }

    const order = await Order.findOne({ orderId });
    const user = await User.findOne({ username: order.username });

    if (user) {
      await bot.sendMediaGroup(user.user_id, photos.map(photo => ({ type: "photo", media: photo })));
      await bot.sendMessage(user.user_id, `Ваше замовлення ID: ${orderId} оновлено. Надіслано фото-звіт.`);
    }

    delete photoUploadState[chatId];

    bot.answerCallbackQuery(query.id, { text: "Фото успішно надіслано клієнту." });
    return bot.editMessageText(`Фото-звіт для замовлення ID: ${orderId} успішно надіслано клієнту.`, {
      chat_id: chatId,
      message_id: query.message.message_id
    });
  }


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

        bot.sendMessage(process.env.MANAGER_CHAT_ID, `Нова заявка ${ticketId} від ${userName} (@${userUsername}). Підтвердити та почати листування?`, {
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
          bot.sendMessage(process.env.MANAGER_CHAT_ID, messagesText);
        }
      }

      bot.sendMessage(process.env.MANAGER_CHAT_ID, `Заявка ${ticketId} прийнята. Напишіть повідомлення клієнту.`, {
        reply_markup: {
          inline_keyboard: [[{ text: "Завершити листування", callback_data: `close_${ticketId}_manager` }]]
        }
      });

      bot.answerCallbackQuery(query.id, { text: `Заявку ${ticketId} прийнято` });
    }
  } else if (data.startsWith("close_")) {
    const [_, ticketId, role] = data.split("_");
    const ticket = await Ticket.findOne({ ticket_id: ticketId });

    if (!ticket) {
      bot.answerCallbackQuery(query.id, { text: "Заявку не знайдено" });
      return;
    }

    if (ticket.status === 'closed') {
      bot.answerCallbackQuery(query.id, { text: `Заявка ${ticketId} вже закрита` });

      if (role === "manager") {
        bot.sendMessage(process.env.MANAGER_CHAT_ID, `Заявка ${ticketId} вже закрита.`);
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
      bot.sendMessage(process.env.MANAGER_CHAT_ID, `Листування по заявці ${ticketId} завершено.`);
    } else if (role === "user") {
      bot.sendMessage(process.env.MANAGER_CHAT_ID, `Клієнт ${userName} закрив заявку ${ticketId}.`, {
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
    await showTicketsHistory(bot, chatId, type, page, messageId);
    bot.answerCallbackQuery(query.id);
    return;
  }

  if (data.startsWith("details_")) {
    const ticketId = data.split("_")[1];
    await showTicketDetails(bot, chatId, ticketId, messageId);
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
    await showTicketsHistory(bot, chatId, type, 1, messageId);
    bot.answerCallbackQuery(query.id);
    return;
  }
}

module.exports = callbackQueryHandler;