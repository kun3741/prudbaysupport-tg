const Ticket = require('../models/Ticket');
const Order = require('../models/Order');
const User = require('../models/User');
const { mainMenuKeyboard, quickRepliesKeyboard, stagesKeyboard, backButtonKeyboard } = require('../utils/keyboards');
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

async function callbackQueryHandler(bot, query, photoUploadState, orderData) {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const data = query.data;

  if (query.data === "current_page") {
    bot.answerCallbackQuery(query.id, { text: "Ви вже на цій сторінці" });
    return;
  }

  if (data.startsWith("change_status_")) {
    bot.answerCallbackQuery(query.id);
    const orderId = data.split("_")[2];
    const order = await Order.findOne({ orderId });

    if (!order) {
      return bot.answerCallbackQuery(query.id, { text: "Замовлення не знайдено." });
    }

    const currentStatus = order.status || "Замовлення створено";
    await bot.sendMessage(chatId, `Поточний статус замовлення ID: ${orderId}:\n${currentStatus}`);

    return bot.editMessageText(`Виберіть новий статус для замовлення ID: ${orderId}`, {
      chat_id: chatId,
      message_id: query.message.message_id,
      reply_markup: {
        inline_keyboard: [
          [{ text: "Замовлення прийнято та на етапі купівлі ✅", callback_data: `set_status_${orderId}_1` }],
          [{ text: "Товар викуплено та відправлено на склад в Китаї ✅", callback_data: `set_status_${orderId}_2` }],
          [{ text: "Товар прибув на склад та готується до перевірки ✅", callback_data: `set_status_${orderId}_3` }],
          [{ text: "Надіслати фото-звіт", callback_data: `set_status_${orderId}_4_photo` }],
          [{ text: "Посилка пройшла перевірку та комплектується ✅", callback_data: `set_status_${orderId}_5` }],
          [{ text: "Посилка успішно скомплектована та готується до відправки ✅", callback_data: `set_status_${orderId}_6_pack` }],
          [{ text: "Посилка прибула до України та готується до відправлення ✅", callback_data: `set_status_${orderId}_7` }]
        ]
      }
    });
  }

  if (data.startsWith("set_status_")) {
    bot.answerCallbackQuery(query.id);
    const parts = data.split("_");
    const orderId = parts[2];
    const status = parts[3];
    const action = parts[4];

    const order = await Order.findOne({ orderId });

    if (!order) {
      return bot.answerCallbackQuery(query.id, { text: "Замовлення не знайдено." });
    }

    if (status === "6" && order.deliveryPrice) {
      return bot.sendMessage(chatId, `Статус "Посилка успішно скомплектована" вже виконано з вартістю доставки: ${order.deliveryPrice} грн.\nВи впевнені, що хочете змінити статус?`, {
        reply_markup: {
          inline_keyboard: [
            [{ text: "Так, змінити", callback_data: `force_set_status_${orderId}_${status}` }],
            [{ text: "Ні, залишити як є", callback_data: "cancel_status_change" }]
          ]
        }
      });
    }

    if (status === "4" && order.status === "Фотозвіт готовий.") {
      return bot.sendMessage(chatId, `Фотозвіт вже надіслано клієнту.\nВи впевнені, що хочете змінити статус?`, {
        reply_markup: {
          inline_keyboard: [
            [{ text: "Так, змінити", callback_data: `force_set_status_${orderId}_${status}` }],
            [{ text: "Ні, залишити як є", callback_data: "cancel_status_change" }]
          ]
        }
      });
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
        statusMessage = "Товар прибув на склад та готується до перевірки ✅";
        break;
      case "4":
        if (action === "photo") {
          const user = await User.findOne({ username: order.username });
          if (!user) {
            return bot.answerCallbackQuery(query.id, { text: "Клієнта не знайдено." });
          }

          photoUploadState[chatId] = { orderId, clientId: user.user_id, photos: [] };

          return bot.editMessageText("Будь ласка, надішліть фото. Коли завершите, натисніть кнопку 'Надіслати всі фото'.", {
            chat_id: chatId,
            message_id: query.message.message_id,
            reply_markup: {
              inline_keyboard: [
                [{ text: "📤 Надіслати всі фото", callback_data: "send_all_photos" }]
              ]
            }
          });
        }
        break;
      case "5":
          statusMessage = "Посилка пройшла перевірку та комплектується ✅";
          break;
      case "6":
        statusMessage = "Посилка успішно скомплектована та готується до відправки ✅";
        photoUploadState[chatId] = { orderId, awaitingPrice: true };
        return bot.editMessageText("Введіть вартість доставки для цього замовлення:", {
          chat_id: chatId,
          message_id: query.message.message_id
        });
      case "7":
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
        let message = `Ваше замовлення ID: ${orderId} оновлено на:\n${statusMessage}`;
        if (status === "6" && order.deliveryPrice) {
          message += `\nВартість доставки: ${order.deliveryPrice} грн.`;
        }
        bot.sendMessage(user.user_id, message);
      }
    }
  }

  if (data.startsWith("force_set_status_")) {
    const parts = data.split("_");
    const orderId = parts[2];
    const status = parts[3];

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
        statusMessage = "Товар прибув на склад та готується до перевірки ✅";
        break;
      case "4":
        statusMessage = "Фотозвіт готовий.";
        break;
      case "5":
        statusMessage = "Посилка успішно скомплектована та готується до відправки ✅";
        break;
      case "6":
        statusMessage = "Посилка прибула до України та готується до відправлення ✅";
        break;
      default:
        return bot.answerCallbackQuery(query.id, { text: "Невідомий статус." });
    }

    order.status = statusMessage;
    await order.save();

    bot.answerCallbackQuery(query.id, { text: "Статус оновлено." });
    bot.sendMessage(chatId, `Статус замовлення ID: ${orderId} оновлено на:\n${statusMessage}`);
  }

  if (data === "cancel_status_change") {
    bot.answerCallbackQuery(query.id, { text: "Зміна статусу скасована." });
  }

  if (data === "send_all_photos") {
    if (!photoUploadState[chatId] || !photoUploadState[chatId].photos || photoUploadState[chatId].photos.length === 0) {
      return bot.sendMessage(chatId, "Немає фото для надсилання.");
    }

    const session = photoUploadState[chatId];
    if (!session.clientId) {
      return bot.sendMessage(chatId, "ID клієнта не знайдено. Перевірте дані та спробуйте ще раз.");
    }

    try {
      const mediaGroup = session.photos.map((fileId) => ({
        type: "photo",
        media: fileId,
      }));
  
      await bot.sendMediaGroup(session.clientId, mediaGroup);

      const order = await Order.findOne({ orderId: session.orderId });
      if (order) {
        order.status = "Фотозвіт готовий.";
        await order.save();
      }

      bot.sendMessage(session.clientId, "Фотозвіт вашого замовлення готовий!",);
      setTimeout(() => {
        bot.sendMessage(session.clientId, "Будь ласка, підтвердіть, що все підходить.\nЯкщо є питання - використовуйте '🙇‍♂️ Зв'язок з менеджером'.", {
          reply_markup: {
            inline_keyboard: [
              [{ text: "Все підходить ✅", callback_data: `confirm_photos_${session.orderId}` }]
            ]
          }
        });
      }, 300);

      bot.sendMessage(chatId, "Фотозвіт успішно надіслано клієнту ✅");
      delete photoUploadState[chatId];
    } catch (error) {
      console.error("Помилка при надсиланні фото клієнту:", error);
      bot.sendMessage(chatId, "Не вдалося надіслати фото клієнту.");
    }
    return;
  }

  if (data === "send_all_photos") {
    const session = photoUploadState[chatId];
  
    if (!session || !session.photos || session.photos.length === 0) {
      return bot.answerCallbackQuery(query.id, { text: "Немає фото для надсилання." });
    }
  
    try {
      const mediaGroup = session.photos.map((fileId) => ({
        type: "photo",
        media: fileId,
      }));
  
      await bot.sendMediaGroup(session.clientId, mediaGroup);
      setTimeout(() => {
        bot.sendMessage(session.clientId, "Фотозвіт вашого замовлення уже готовий!");
      }, 100);
      
  
      bot.sendMessage(chatId, "Фотозвіт успішно надіслано клієнту ✅");
  
      delete photoUploadState[chatId];
  
      bot.answerCallbackQuery(query.id, { text: "Фото успішно надіслано клієнту." });
    } catch (error) {
      console.error("Помилка при надсиланні фото клієнту:", error);
      bot.sendMessage(chatId, "Не вдалося надіслати фото клієнту. Спробуйте ще раз.");
      bot.answerCallbackQuery(query.id, { text: "Помилка при надсиланні фото." });
    }
  }

  if (data.startsWith("confirm_photos_")) {
    const orderId = data.split("_")[2];
  
    bot.answerCallbackQuery(query.id, { text: "Дякуємо за підтвердження!" });
    await bot.sendMessage(chatId, "Дякуємо!\nЯкщо у вас виникнуть питання, звертайтеся до менеджера.");
  
    bot.sendMessage(process.env.MANAGER_CHAT_ID, `Клієнт ID: ${orderId} підтвердив фотозвіт.`);
  }


  if (data === "cancel_order") {
    if (orderData[chatId]) {
      delete orderData[chatId];
      bot.answerCallbackQuery(query.id, { text: "Оформлення замовлення скасовано." });
      return bot.editMessageText("Оформлення замовлення було скасовано.", {
        chat_id: chatId,
        message_id: query.message.message_id
      });
    } else {
      bot.answerCallbackQuery(query.id, { text: "Немає активного процесу оформлення замовлення." });
    }
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
    const type = "all";
    await showTicketsHistory(bot, chatId, type, 1, messageId);
    bot.answerCallbackQuery(query.id);
    return;
  }

  if (data.startsWith("stage_status_")) {
    let responseText = "";
    switch (data) {
      case "stage_status_1":
        responseText = "Статус оновлюється протягом 24-годин, після оновлення ви отримаєте сповіщення.";
        break;
      case "stage_status_2":
        responseText = "Середній термін - 3 дні, Ви одразу отримаєте сповіщення.";
        break;
      case "stage_status_3":
        responseText = "Зазвичай фото-звіт надходить протягом години після того як товар прибув на склад.";
        break;
      case "stage_status_5":
        responseText = "Доставка оплачується протягом 4-х днів з моменту формування посилки. У випадку запізнення - посилка затримується у Німеччині, подальша доставка не можлива.";
        break;
      case "stage_status_6":
        responseText = "Посилки відправляються кожного дня до 19:00. Після відправлення Вам надійте ТТН на ваш обліковий запис Нової Пошти.";
        break;
    }
    bot.editMessageText(responseText, {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: backButtonKeyboard()
    });
  }

  if (data === "stage_back") {
    bot.editMessageText("Виберіть стадію замовлення:", {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: stagesKeyboard()
    });
  }

  if (data.startsWith("status_question_")) {
    let responseText = "";
    switch (data) {
      case "status_question_1":
        responseText = "Статус оновлюється протягом 24-годин, після оновлення ви отримаєте сповіщення.";
        break;
      case "status_question_2":
        responseText = "Середній термін - 3 дні, Ви одразу отримаєте сповіщення.";
        break;
      case "status_question_3":
        responseText = "Зазвичай фото-звіт надходить протягом години після того як товар прибув на склад.";
        break;
      case "status_question_5":
        responseText = "Доставка оплачується протягом 4-х днів з моменту формування посилки. У випадку запізнення - посилка затримується у Німеччині, подальша доставка не можлива.";
        break;
      case "status_question_6":
        responseText = "Посилки відправляються кожного дня до 19:00. Після відправлення Вам надійте ТТН на ваш обліковий запис Нової Пошти.";
        break;
    }

    bot.editMessageText(responseText, {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: {
        inline_keyboard: [
          [{ text: "◀️ Назад", callback_data: "status_back" }]
        ]
      }
    });
  }

  if (data === "status_back") {
    const user = await User.findOne({ user_id: chatId });

    if (!user) {
      bot.editMessageText("Користувача не знайдено. Зверніться до менеджера.", {
        chat_id: chatId,
        message_id: messageId
      });
      return;
    }

    const orders = await Order.find({ username: user.username });

    if (!orders || orders.length === 0) {
      bot.editMessageText("Замовлень ще немає, зверніться до менеджера для його створення.", {
        chat_id: chatId,
        message_id: messageId
      });
      return;
    }

    const latestOrder = orders[orders.length - 1];
    const status = latestOrder.status || "Замовлення створено";
    const orderId = latestOrder.orderId || "Невідомий";

    let responseText = `Ваше замовлення ID: ${orderId}\nСтатус: ${status}`;

    let inlineKeyboard = [];
    switch (status) {
      case "Замовлення прийнято та на етапі купівлі ✅":
        inlineKeyboard = [
          [{ text: "Коли я можу дізнатися новий статус?", callback_data: "status_question_1" }]
        ];
        break;
      case "Товар викуплено та відправлено на склад в Китаї ✅":
        inlineKeyboard = [
          [{ text: "Коли товар прибуде на склад?", callback_data: "status_question_2" }]
        ];
        break;
      case "Товар прибув на склад та готується до перевірки ✅":
        inlineKeyboard = [
          [{ text: "Коли я можу отримати фото-звіт?", callback_data: "status_question_3" }]
        ];
        break;
      case "Посилка успішно скомплектована та готується до відправки ✅":
        responseText += `\nВартість доставки: ${latestOrder.deliveryPrice || "Невідомо"} грн.`;
        inlineKeyboard = [
          [{ text: "Скільки часу у мене є на оплату доставки?", callback_data: "status_question_5" }]
        ];
        break;
      case "Посилка прибула до України та готується до відправлення ✅":
        inlineKeyboard = [
          [{ text: "Коли я можу очікувати відправлення?", callback_data: "status_question_6" }]
        ];
        break;
    }

    bot.editMessageText(responseText, {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: {
        inline_keyboard: inlineKeyboard
      }
    });
  }
}

module.exports = callbackQueryHandler;