const { mainMenuKeyboard, quickRepliesKeyboard } = require('../utils/keyboards');
const User = require('../models/User');
const Ticket = require('../models/Ticket');
const Order = require('../models/Order');
const Counter = require('../models/Counter');

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

async function messagesHandler(bot, msg, orderData, photoUploadState) {
  const chatId = msg.chat.id;
  const text = msg.text || ''; 

  if (text && text.startsWith('/')) return;

  const user = await User.findOne({ user_id: chatId });


  if (text === "Оформити замовлення" && chatId.toString() === process.env.MANAGER_CHAT_ID) {
    orderData[chatId] = { step: 0, data: {} };
    return bot.sendMessage(chatId, "Введіть @юзернейм клієнта: (без @)");
  }


  if (orderData[chatId]) {
    const currentStep = orderData[chatId].step;
    const fields = ["username", "fullName", "phoneNumber", "city", "npDepartment", "orderId"];
    const questions = [
      "Введіть @юзернейм клієнта: (без @)",
      "Введіть Прізвище, Ім'я, По-Батькові клієнта:",
      "Чи використовувати номер телефону з бази? (Так/Ні):",
      "Введіть місто-отримувача:",
      "Введіть номер відділення Нової Пошти:",
      "Введіть ID замовлення:"
    ];

    if (currentStep < fields.length) {
      const field = fields[currentStep];
      if (field === "phoneNumber" && text.toLowerCase() === "так") {
        const user = await User.findOne({ username: orderData[chatId].data.username });
        if (user && user.phone_number) {
          orderData[chatId].data.phoneNumber = user.phone_number;
        } else {
          return bot.sendMessage(chatId, "Номер телефону не знайдено в базі. Введіть новий номер:");
        }
      } else if (field === "phoneNumber") {
        if (!text.match(/^\+380\d{9}$/)) {
          return bot.sendMessage(chatId, "Номер телефону повинен починатися з +380 і містити 9 цифр. Спробуйте ще раз:");
        }
        orderData[chatId].data.phoneNumber = text;
      } else {
        orderData[chatId].data[field] = text;
      }

      orderData[chatId].step++;

      if (orderData[chatId].step < fields.length) {
        return bot.sendMessage(chatId, questions[orderData[chatId].step]);
      } else {
        const order = new Order(orderData[chatId].data);
        await order.save();

        delete orderData[chatId];

        bot.sendMessage(chatId, "Замовлення успішно оформлено!");

        const user = await User.findOne({ username: order.username });
        if (user) {
          return bot.sendMessage(user.user_id, `Ваше замовлення успішно оформлено! ID замовлення: ${order.orderId}`);
        } else {
          return bot.sendMessage(chatId, "Клієнта не знайдено в базі. Повідомлення про замовлення не надіслано.");
        }
      }
    }
  }

  if (photoUploadState[chatId]) return;

  if (text.startsWith("Вартість доставки:")) {
    const parts = text.split(":");
    const cost = parts[1]?.trim();

    if (!cost || isNaN(cost)) {
      return bot.sendMessage(chatId, "Будь ласка, введіть коректну вартість доставки (число).");
    }

    const orderId = Object.keys(photoUploadState).find(key => photoUploadState[key].orderId);
    const order = await Order.findOne({ orderId });

    if (order) {
      order.deliveryCost = cost;
      await order.save();

      bot.sendMessage(chatId, `Вартість доставки для замовлення ID: ${orderId} встановлено: ${cost} грн.`);
      const user = await User.findOne({ username: order.username });
      if (user) {
        bot.sendMessage(user.user_id, `Ваше замовлення ID: ${orderId} оновлено. Вартість доставки: ${cost} грн.`);
      }
    }
  }

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

    bot.sendMessage(process.env.MANAGER_CHAT_ID, `Нова заявка ${ticketId} від ${userName} (@${userUsername}). Підтвердити та почати листування?`, {
      reply_markup: {
        inline_keyboard: [[{ text: "Прийняти", callback_data: `accept_${ticketId}` }]]
      }
    });
    return;
  }

  if (text === "Зміна статусу замовлення" && chatId.toString() === process.env.MANAGER_CHAT_ID) {
    const orders = await Order.find();

    if (orders.length === 0) {
      return bot.sendMessage(chatId, "Немає замовлень для зміни статусу.");
    }

    const inlineKeyboard = orders.map(order => {
      return [{ text: `ID: ${order.orderId} @${order.username}`, callback_data: `change_status_${order.orderId}` }];
    });

    return bot.sendMessage(chatId, "Виберіть замовлення для зміни статусу:", {
      reply_markup: {
        inline_keyboard: inlineKeyboard
      }
    });
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

      bot.sendMessage(process.env.MANAGER_CHAT_ID, `Клієнт ${user.name} закрив заявку ${ticket.ticket_id}.`);
    } else {
      bot.sendMessage(chatId, "У вас немає активних заявок.");
    }
    return;
  }

  if (text === "Показати активні заявки" && chatId.toString() === process.env.MANAGER_CHAT_ID) {
    const activeTickets = await Ticket.find({ status: 'open' });

    if (activeTickets.length === 0) {
      return bot.sendMessage(process.env.MANAGER_CHAT_ID, "Немає активних заявок.");
    }

    const inlineKeyboard = activeTickets.map(ticket => {
      return [{ text: `Заявка ${ticket.ticket_id}`, callback_data: `accept_${ticket.ticket_id}` }];
    });

    bot.sendMessage(process.env.MANAGER_CHAT_ID, "Активні заявки:", {
      reply_markup: {
        inline_keyboard: inlineKeyboard
      }
    });
    return;
  }

  if (text === "Історія заявок" && chatId.toString() === process.env.MANAGER_CHAT_ID) {
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

  if (chatId.toString() === process.env.MANAGER_CHAT_ID) {
    console.log("Менеджер надіслав повідомлення:", text);

    const activeTicket = await Ticket.findOne({ 
      status: 'open', 
      accepted: true,
      activeManagerConversation: true
    });

    if (!activeTicket) {
      return bot.sendMessage(process.env.MANAGER_CHAT_ID, "Немає активної заявки для відповіді. Виберіть заявку зі списку.", {
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
        await bot.sendMessage(process.env.MANAGER_CHAT_ID, `Від ${user.name} (@${msg.chat.username}, ID заявки: ${activeTicket.ticket_id}):\n${msg.text}`);
      } else if (msg.photo) {
        const fileId = msg.photo[msg.photo.length - 1].file_id;
        const caption = msg.caption || '';
        activeTicket.messages.push({ from: 'user', text: 'Фото' });
        await activeTicket.save();
        await bot.sendPhoto(process.env.MANAGER_CHAT_ID, fileId, { caption: `Від ${user.name} (@${msg.chat.username}, ID заявки: ${activeTicket.ticket_id})\n${caption}` });
      } else if (msg.document) {
        const fileId = msg.document.file_id;
        activeTicket.messages.push({ from: 'user', text: 'Документ' });
        await activeTicket.save();
        await bot.sendDocument(process.env.MANAGER_CHAT_ID, fileId, { caption: `Від ${user.name} (@${msg.chat.username}, ID заявки: ${activeTicket.ticket_id})` });
      } else if (msg.sticker) {
        const fileId = msg.sticker.file_id;
        activeTicket.messages.push({ from: 'user', text: 'Стікер' });
        await activeTicket.save();
        await bot.sendSticker(process.env.MANAGER_CHAT_ID, fileId);
      } else if (msg.video) {
        const fileId = msg.video.file_id;
        activeTicket.messages.push({ from: 'user', text: 'Відео' });
        await activeTicket.save();
        await bot.sendVideo(process.env.MANAGER_CHAT_ID, fileId, { caption: `Від ${user.name} (@${msg.chat.username}, ID заявки: ${activeTicket.ticket_id})` });
      } else if (msg.forward_from_chat) {
        const forwardFromChatId = msg.forward_from_chat.id;
        const messageId = msg.forward_from_message_id;
        activeTicket.messages.push({ from: 'user', text: 'Переслане повідомлення' });
        await activeTicket.save();
        await bot.forwardMessage(process.env.MANAGER_CHAT_ID, forwardFromChatId, messageId);
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
          await bot.sendPhoto(process.env.MANAGER_CHAT_ID, fileId, { caption: `Від ${user.name} (@${msg.chat.username}, ID заявки: ${pendingTicket.ticket_id})\n${caption}` });
        } else if (msg.document) {
          const fileId = msg.document.file_id;
          pendingTicket.messages.push({ from: 'user', text: 'Документ' });
          await pendingTicket.save();
          await bot.sendDocument(process.env.MANAGER_CHAT_ID, fileId, { caption: `Від ${user.name} (@${msg.chat.username}, ID заявки: ${pendingTicket.ticket_id})` });
        } else if (msg.sticker) {
          const fileId = msg.sticker.file_id;
          pendingTicket.messages.push({ from: 'user', text: 'Стікер' });
          await pendingTicket.save();
          await bot.sendSticker(process.env.MANAGER_CHAT_ID, fileId);
        } else if (msg.video) {
          const fileId = msg.video.file_id;
          pendingTicket.messages.push({ from: 'user', text: 'Відео' });
          await pendingTicket.save();
          await bot.sendVideo(process.env.MANAGER_CHAT_ID, fileId, { caption: `Від ${user.name} (@${msg.chat.username}, ID заявки: ${pendingTicket.ticket_id})` });
        } else if (msg.forward_from_chat) {
          const forwardFromChatId = msg.forward_from_chat.id;
          const messageId = msg.forward_from_message_id;
          pendingTicket.messages.push({ from: 'user', text: 'Переслане повідомлення' });
          await pendingTicket.save();
          await bot.forwardMessage(process.env.MANAGER_CHAT_ID, forwardFromChatId, messageId);
        }
      } else {
        bot.sendMessage(chatId, "У вас немає активних заявок. Виберіть '🙇‍♂️ Зв'язок з менеджером', щоб створити нову заявку.");
      }
    }
  }
}

module.exports = messagesHandler;