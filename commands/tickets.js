const Ticket = require('../models/Ticket');
const User = require('../models/User');
const { mainMenuKeyboard } = require('../utils/keyboards');
const Counter = require('../models/Counter');

// Generate a unique ticket ID
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

// Handle the /tickets command
async function ticketsCommand(bot, msg) {
  const chatId = msg.chat.id;

  // Fetch all tickets for the user
  const tickets = await Ticket.find({ user_id: chatId });

  if (tickets.length === 0) {
    return bot.sendMessage(chatId, "У вас немає заявок.");
  }

  // Generate a list of tickets
  const ticketList = tickets.map(ticket => {
    const status = ticket.status === 'open' ? '🟢 Відкрита' : '🔴 Закрита';
    return `🎫 Заявка ID: ${ticket.ticket_id}\nСтатус: ${status}`;
  }).join('\n\n');

  bot.sendMessage(chatId, `Ваші заявки:\n\n${ticketList}`, {
    reply_markup: {
      inline_keyboard: tickets.map(ticket => [
        { text: `Деталі заявки ${ticket.ticket_id}`, callback_data: `details_${ticket.ticket_id}` }
      ])
    }
  });
}

// Handle ticket creation
async function createTicket(bot, chatId, user) {
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
    bot.sendMessage(chatId, `Дякуємо, ${user.name || "Без імені"}, очікуйте підключення менеджера 😉`);
  }

  const userName = user ? user.name || "Без імені" : "Без імені";
  const userUsername = user.username || "Без імені користувача";

  bot.sendMessage(process.env.MANAGER_CHAT_ID, `Нова заявка ${ticketId} від ${userName} (@${userUsername}). Підтвердити та почати листування?`, {
    reply_markup: {
      inline_keyboard: [[{ text: "Прийняти", callback_data: `accept_${ticketId}` }]]
    }
  });
}

// Handle ticket details
async function showTicketDetails(bot, chatId, ticketId, messageId) {
  const ticket = await Ticket.findOne({ ticket_id: ticketId });

  if (!ticket) {
    return bot.sendMessage(chatId, "Заявку не знайдено.");
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

  bot.editMessageText(message, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: "Назад до списку", callback_data: "back_to_ticket_list" }]
      ]
    }
  });
}

// Handle ticket history viewing
// async function showTicketsHistory(bot, chatId, type, page, messageId) {
//   const limit = 5; // Number of tickets per page
//   const skip = (page - 1) * limit;

//   let query = {};
//   if (type === 'open') {
//     query.status = 'open';
//   } else if (type === 'closed') {
//     query.status = 'closed';
//   }

//   const tickets = await Ticket.find(query).skip(skip).limit(limit);
//   const totalTickets = await Ticket.countDocuments(query);

//   if (tickets.length === 0) {
//     return bot.editMessageText("Немає заявок для відображення.", {
//       chat_id: chatId,
//       message_id: messageId
//     });
//   }

//   const ticketList = tickets.map(ticket => {
//     const status = ticket.status === 'open' ? '🟢 Відкрита' : '🔴 Закрита';
//     return `🎫 Заявка ID: ${ticket.ticket_id}\nСтатус: ${status}`;
//   }).join('\n\n');

//   const totalPages = Math.ceil(totalTickets / limit);

//   const inlineKeyboard = [];
//   if (page > 1) {
//     inlineKeyboard.push([{ text: "⬅️ Попередня", callback_data: `view_tickets_${type}_${page - 1}` }]);
//   }
//   if (page < totalPages) {
//     inlineKeyboard.push([{ text: "➡️ Наступна", callback_data: `view_tickets_${type}_${page + 1}` }]);
//   }

//   bot.editMessageText(`Ваші заявки:\n\n${ticketList}`, {
//     chat_id: chatId,
//     message_id: messageId,
//     reply_markup: {
//       inline_keyboard: inlineKeyboard
//     }
//   });
// }

const TICKETS_PER_PAGE = 5;
async function showTicketsHistory(bot, chatId, type, page = 1, messageId = null) {
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

// Handle ticket chat history viewing
async function showTicketChat(bot, chatId, ticketId, messageId) {
  const ticket = await Ticket.findOne({ ticket_id: ticketId });

  if (!ticket) {
    return bot.editMessageText("Заявку не знайдено.", {
      chat_id: chatId,
      message_id: messageId
    });
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

  bot.editMessageText(message, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: "Назад до списку", callback_data: "back_to_ticket_list" }]
      ]
    }
  });
}

// Handle ticket list with buttons for chat history
async function showTicketsWithChat(bot, chatId, type, page, messageId) {
  const limit = 5; // Number of tickets per page
  const skip = (page - 1) * limit;

  let query = {};
  if (type === 'open') {
    query.status = 'open';
  } else if (type === 'closed') {
    query.status = 'closed';
  }

  const tickets = await Ticket.find(query).skip(skip).limit(limit);
  const totalTickets = await Ticket.countDocuments(query);

  if (tickets.length === 0) {
    return bot.editMessageText("Немає заявок для відображення.", {
      chat_id: chatId,
      message_id: messageId
    });
  }

  const ticketList = tickets.map(ticket => {
    const status = ticket.status === 'open' ? '🟢 Відкрита' : '🔴 Закрита';
    return `🎫 Заявка ID: ${ticket.ticket_id}\nСтатус: ${status}`;
  }).join('\n\n');

  const totalPages = Math.ceil(totalTickets / limit);

  const inlineKeyboard = tickets.map(ticket => [
    { text: `Чат заявки ${ticket.ticket_id}`, callback_data: `chat_${ticket.ticket_id}` }
  ]);

  if (page > 1) {
    inlineKeyboard.push([{ text: "⬅️ Попередня", callback_data: `view_tickets_${type}_${page - 1}` }]);
  }
  if (page < totalPages) {
    inlineKeyboard.push([{ text: "➡️ Наступна", callback_data: `view_tickets_${type}_${page + 1}` }]);
  }

  bot.editMessageText(`Ваші заявки:\n\n${ticketList}`, {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: {
      inline_keyboard: inlineKeyboard
    }
  });
}

module.exports = {
  ticketsCommand,
  createTicket,
  showTicketDetails,
  showTicketsHistory,
  showTicketChat,
  showTicketsWithChat
};