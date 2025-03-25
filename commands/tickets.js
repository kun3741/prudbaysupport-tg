async function ticketsCommand(bot, msg) {
    const chatId = msg.chat.id;
  
    if (chatId.toString() !== process.env.MANAGER_CHAT_ID) {
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
  }
  
  module.exports = ticketsCommand;