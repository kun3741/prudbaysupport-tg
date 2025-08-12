const User = require('../models/User');
const Order = require('../models/Order');

async function photosHandler(bot, msg, photoUploadState, receiptUploadState) {
  const chatId = msg.chat.id;

  if (photoUploadState[chatId]) {
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    photoUploadState[chatId].photos.push(fileId);

    return bot.sendMessage(chatId, "Фото додано. Коли завершите, натисніть кнопку 'Надіслати всі фото'.", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "📤 Надіслати всі фото", callback_data: "send_all_photos" }]
        ]
      }
    });
  } else if (receiptUploadState[chatId] && receiptUploadState[chatId].awaiting) {
    const fileId = msg.photo ? msg.photo[msg.photo.length - 1].file_id : msg.document.file_id;
    const { orderId } = receiptUploadState[chatId];
    try {
        const user = await User.findOne({ user_id: chatId });
        const caption = `🧾 Нова квитанція для замовлення ID: ${orderId}\nВід клієнта: ${user.name || 'N/A'} (@${user.username || 'N/A'})`;
        
        if (msg.photo) {
            await bot.sendPhoto(process.env.MANAGER_CHAT_ID, fileId, { caption: caption,
                reply_markup: {
                    inline_keyboard: [[{ text: "Оплата доставки підтверджена", callback_data: `confirm_delivery_payment_${orderId}` }]]
                }
            });
        } else if (msg.document) {
            await bot.sendDocument(process.env.MANAGER_CHAT_ID, fileId, { caption: caption,
                reply_markup: {
                    inline_keyboard: [[{ text: "Оплата доставки підтверджена", callback_data: `confirm_delivery_payment_${orderId}` }]]
                }
            });
        }
        
        await Order.updateOne({ orderId }, { receiptSent: true });
        
        await bot.sendMessage(chatId, '📥 Дякуємо! Квитанцію отримано ✅\n\nОчікуйте підтвердження від менеджера найближчим часом.\nЯк тільки оплата буде перевірена — ви отримаєте оновлення статусу замовлення.', {
            reply_markup: {
                inline_keyboard: [[{ text: "Повернутися в меню", callback_data: "pc_back_to_main" }]]
            }
        });
    } catch (error) {
        console.error("Помилка обробки квитанції:", error);
        await bot.sendMessage(chatId, "Сталася помилка при обробці квитанції. Спробуйте ще раз або зверніться до менеджера.");
    } finally {
        delete receiptUploadState[chatId];
    }
    return;
  } else {
    console.log(`Фото отримано від ${chatId}, але користувач не в стані photoUploadState.`);
  }
}

module.exports = photosHandler;