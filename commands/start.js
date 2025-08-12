const { mainMenuKeyboard, requestPhoneKeyboard } = require('../utils/keyboards');
const User = require('../models/User');
const Order = require('../models/Order');

async function startCommand(bot, msg) {
  try {
    const chatId = msg.chat.id;
    const username = msg.chat.username || 'Без імені';

    let user = await User.findOne({ user_id: chatId });

    if (chatId.toString() === process.env.MANAGER_CHAT_ID) {
      return bot.sendMessage(chatId, "Вітаємо, Менеджере! Виберіть опцію:", {
        reply_markup: {
          keyboard: [
            ["Оформити замовлення", "Зміна статусу замовлення"],
            ["Показати активні заявки", "Створені замовлення"],
            ["Написати повідомлення", "Переглянути профіль"],
            ["Історія заявок"]
          ],
          resize_keyboard: true
        }
      });
    }

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

    return sendMainMenu(bot, chatId, user.name);
  } catch (error) {
    console.error("Помилка у startCommand:", error);
    bot.sendMessage(msg.chat.id, "Сталася помилка. Спробуйте пізніше.");
  }
}

async function showManagerOrdersList(bot, chatId, messageId = null) {
  try {
    const orders = await Order.find().sort({ createdAt: -1 });

    if (orders.length === 0) {
      const text = "Ще не створено жодного замовлення.";
      if (messageId) {
        return bot.editMessageText(text, { chat_id: chatId, message_id: messageId });
      } else {
        return bot.sendMessage(chatId, text);
      }
    }

    const inlineKeyboard = orders.map(order => {
      return [{
        text: `ID: ${order.orderId || 'N/A'} - ${order.fullName || 'Без імені'} (@${order.username || 'N/A'})`,
        callback_data: `view_order_${order._id}`
      }];
    });

    const text = "Список створених замовлень:";
    const options = {
      reply_markup: {
        inline_keyboard: inlineKeyboard
      }
    };

    if (messageId) {
      options.chat_id = chatId;
      options.message_id = messageId;
      await bot.editMessageText(text, options);
    } else {
      await bot.sendMessage(chatId, text, options);
    }
  } catch (error) {
    console.error("Помилка при показі списку замовлень менеджеру:", error);
    bot.sendMessage(chatId, "Не вдалося завантажити список замовлень.");
  }
}

async function sendMainMenu(bot, chatId, name) {
  bot.sendMessage(chatId, `Вітаємо, ${name}!`,);
  setTimeout(() => {
    return bot.sendMessage(chatId, `🏡 ГОЛОВНЕ МЕНЮ.\nВикористовуйте кнопки для навігації`, {
      reply_markup: mainMenuKeyboard()
    });
  }, 300);
  
}


module.exports = { startCommand, sendMainMenu, showManagerOrdersList };