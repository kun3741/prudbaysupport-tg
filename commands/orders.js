const Order = require('../models/Order');

async function ordersCommand(bot, msg) {
  const chatId = msg.chat.id;

  if (chatId.toString() !== process.env.MANAGER_CHAT_ID) {
    return bot.sendMessage(chatId, "Ця команда доступна тільки для менеджерів.");
  }

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

module.exports = ordersCommand;