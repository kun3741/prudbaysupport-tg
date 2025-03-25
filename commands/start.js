const { mainMenuKeyboard, requestPhoneKeyboard } = require('../utils/keyboards');
const User = require('../models/User');

async function startCommand(bot, msg) {
  const chatId = msg.chat.id;
  const username = msg.chat.username || 'Без імені';

  if (chatId.toString() === process.env.MANAGER_CHAT_ID) {
    return bot.sendMessage(chatId, "Вітаємо, Менеджере! Виберіть опцію:", {
      reply_markup: {
        keyboard: [
          ["Оформити замовлення", "Зміна статусу замовлення"],
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

  return bot.sendMessage(chatId, `Вітаємо, ${user.name}!`, {
    reply_markup: mainMenuKeyboard()
  });
}

module.exports = startCommand;