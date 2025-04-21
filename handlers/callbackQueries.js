const Ticket = require('../models/Ticket');
const Order = require('../models/Order');
const User = require('../models/User');
const { mainMenuKeyboard, quickRepliesKeyboard, stagesKeyboard, backButtonKeyboard } = require('../utils/keyboards');
const Counter = require('../models/Counter');
const { showTicketsHistory, showTicketDetails } = require('../commands/tickets');
const { showManagerOrdersList } = require('../commands/start');
const { updateOrderInAirtable } = require('../utils/airtable');

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

async function showManagerOrderDetails(bot, chatId, messageId, orderMongoId) {
  try {
    const order = await Order.findById(orderMongoId);

    if (!order) {
      console.error(`[showManagerOrderDetails] Order not found for Mongo ID: ${orderMongoId}`);
      return bot.editMessageText("Помилка: Замовлення не знайдено.", {
        chat_id: chatId, message_id: messageId,
        reply_markup: { inline_keyboard: [[{ text: "◀️ Назад до списку замовлень", callback_data: "back_to_order_list" }]] }
      });
    }

    if (!order.orderId) {
        console.error(`[showManagerOrderDetails] Order ID (system ID) is missing for Mongo ID: ${orderMongoId}`);
    }

    const createdAtDate = order.createdAt ? new Date(order.createdAt).toLocaleString('uk-UA', { timeZone: 'Europe/Kiev' }) : 'Невідомо';

    const orderDetailsText = `
📦 Деталі замовлення ID: ${order.orderId || 'N/A'}data.startsWith("accept_")

🏷️ Товар: ${order.productName || 'Не вказано'}

👤 Клієнт:
   - Юзернейм: @${order.username || 'N/A'}
   - ПІБ: ${order.fullName || 'N/A'}
   - Телефон: ${order.phoneNumber || 'N/A'}

🚚 Доставка:
   - Місто: ${order.city || 'N/A'}
   - Відділення НП: ${order.novaPost || 'N/A'}
   - Вартість доставки: ${order.deliveryPrice != null ? order.deliveryPrice + ' грн' : 'Не вказано'}

📊 Статус: ${order.status || 'Замовлення створено'}
📅 Створено: ${createdAtDate}
    `;
    console.log(`[showManagerOrderDetails] Displaying details for Order ID: ${order.orderId}`);

    const keyboard = [
        [{ text: "◀️ Назад до списку замовлень", callback_data: "back_to_order_list" }]
    ];

    if (order.orderId) {
        keyboard.unshift(
             [{ text: "📊 Змінити статус", callback_data: `change_status_${order.orderId}` }]
        );
    }

    await bot.editMessageText(orderDetailsText, {
      chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard }
    });
  } catch (error) {
    console.error(`[showManagerOrderDetails] Error showing details for Mongo ID ${orderMongoId}:`, error);
    await bot.editMessageText("Не вдалося завантажити деталі замовлення.", {
      chat_id: chatId, message_id: messageId,
      reply_markup: { inline_keyboard: [[{ text: "◀️ Назад до списку замовлень", callback_data: "back_to_order_list" }]] }
    }).catch(editErr => console.error("Failed to edit message on error:", editErr));
  }
}


async function callbackQueryHandler(bot, query, photoUploadState, orderData) {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const data = query.data;
  const userId = query.from.id;
  const managerId = process.env.MANAGER_CHAT_ID;

  console.log(`[CALLBACK_QUERY] Data: ${data}, UserID: ${userId}, ChatID: ${chatId}, ManagerID Env: ${managerId}`);

  const isManager = userId.toString() === managerId;
  console.log(`[CALLBACK_QUERY] isManager Check: ${isManager}`);

  if (data === "current_page") {
    bot.answerCallbackQuery(query.id, { text: "Ви вже на цій сторінці" });
    return;
  }

  if (data && data.startsWith("view_order_")) {
    console.log(`[CALLBACK_QUERY] Condition data.startsWith("view_order_") is TRUE`);
    if (isManager) {
        console.log(`[CALLBACK_QUERY] Condition isManager is TRUE. Processing view_order_${data.split("_")[2]}...`);
        try {
            bot.answerCallbackQuery(query.id);
            const orderMongoId = data.split("_")[2];
            console.log(`[CALLBACK_QUERY] Extracted Order Mongo ID: ${orderMongoId}`);
            await showManagerOrderDetails(bot, chatId, messageId, orderMongoId);
            console.log(`[CALLBACK_QUERY] showManagerOrderDetails finished successfully.`);
        } catch (error) {
            console.error("[CALLBACK_QUERY] Error inside 'view_order_' processing:", error);
             try { await bot.answerCallbackQuery(query.id, { text: 'Помилка обробки запиту', show_alert: true }); }
             catch (ansErr) { console.error("Failed to answer callback query on error:", ansErr); }
        }
        return;
    } else {
        console.log(`[CALLBACK_QUERY] Condition isManager is FALSE. Ignoring 'view_order_' for non-manager.`);
        bot.answerCallbackQuery(query.id, { text: "Ця дія доступна лише менеджеру." });
        return;
    }
  }

  if (data === "back_to_order_list") {
      console.log(`[CALLBACK_QUERY] Condition data === "back_to_order_list" is TRUE`);
       if (isManager) {
          console.log(`[CALLBACK_QUERY] Condition isManager is TRUE. Processing back_to_order_list...`);
          try {
             bot.answerCallbackQuery(query.id);
             await showManagerOrdersList(bot, chatId, messageId);
             console.log(`[CALLBACK_QUERY] showManagerOrdersList (back) finished successfully.`);
          } catch (error) {
              console.error("[CALLBACK_QUERY] Error inside 'back_to_order_list' processing:", error);
               try { await bot.answerCallbackQuery(query.id, { text: 'Помилка повернення до списку', show_alert: true }); }
               catch (ansErr) { console.error("Failed to answer callback query on error:", ansErr); }
          }
          return;
       } else {
          console.log(`[CALLBACK_QUERY] Condition isManager is FALSE. Ignoring 'back_to_order_list' for non-manager.`);
          bot.answerCallbackQuery(query.id);
          return;
       }
  }

  if (data.startsWith("change_status_") && isManager) {
    bot.answerCallbackQuery(query.id);
    const orderId = data.split("_")[2];
    const order = await Order.findOne({ orderId });

    if (!order) {
      return bot.answerCallbackQuery(query.id, { text: "Замовлення не знайдено." });
    }

    const currentStatus = order.status || "Замовлення створено";
    console.log(`[CALLBACK_QUERY] Manager requesting status change for Order ID: ${orderId}`);
    return bot.editMessageText(`Виберіть новий статус для замовлення ID: ${orderId} (@${order.username})\nПоточний: ${currentStatus}`, {
      chat_id: chatId, message_id: messageId,
      reply_markup: { inline_keyboard: [
          [{ text: "Етап купівлі ✅", callback_data: `set_status_${orderId}_1` }],
          [{ text: "Викуплено, відпр. на склад 🇨🇳 ✅", callback_data: `set_status_${orderId}_2` }],
          [{ text: "Прибув на склад, перевірка ✅", callback_data: `set_status_${orderId}_3` }],
          [{ text: "Надіслати фото-звіт 📷", callback_data: `set_status_${orderId}_4_photo` }],
          [{ text: "Фотозвіт підтверджено клієнтом 👍", callback_data: `set_status_${orderId}_5_confirm`}],
          [{ text: "Скомплектовано, до відправки ✅", callback_data: `set_status_${orderId}_6_pack` }],
          [{ text: "Прибув до України ✅", callback_data: `set_status_${orderId}_7` }],
          [{ text: "Відправлено клієнту (ТТН) ✅", callback_data: `set_status_${orderId}_8_sent` }],
          [{ text: "◀️ Назад (до деталей замовл.)", callback_data: `view_order_${order._id}` }]
        ]}
    });
  }

   if (data.startsWith("set_status_") && isManager) {
    bot.answerCallbackQuery(query.id);
    const parts = data.split("_");
    const orderId = parts[2];
    const statusIndex = parts[3];
    const action = parts[4];

    console.log(`[CALLBACK_QUERY] Attempting to set status for Order ID: ${orderId}, StatusIndex: ${statusIndex}, Action: ${action}`);

    const order = await Order.findOne({ orderId });

    if (!order) {
      console.error(`[CALLBACK_QUERY] Order not found for ID: ${orderId} during status update.`);
      return bot.answerCallbackQuery(query.id, { text: "Замовлення не знайдено." });
    }

    let statusMessage = "";
    let notifyClient = true;

    switch (statusIndex) {
      case "1": statusMessage = "Замовлення прийнято та на етапі купівлі ✅"; break;
      case "2": statusMessage = "Товар викуплено та відправлено на склад в Китаї ✅"; break;
      case "3": statusMessage = "Товар прибув на склад та готується до перевірки ✅"; break;
      case "4":
        if (action === "photo") {
          const user = await User.findOne({ username: order.username });
          if (!user) { console.error(`[CALLBACK_QUERY] Client user @${order.username} not found for photo report.`); return bot.answerCallbackQuery(query.id, { text: "Клієнта не знайдено." }); }
          photoUploadState[chatId] = { orderId, clientId: user.user_id, photos: [], awaitingPrice: false };
          console.log(`[CALLBACK_QUERY] Initiating photo upload state for Order ID: ${orderId}, Client ID: ${user.user_id}`);
          return bot.editMessageText("Будь ласка, надішліть фото. Коли завершите, натисніть кнопку 'Надіслати всі фото'.", {
            chat_id: chatId, message_id: messageId,
            reply_markup: { inline_keyboard: [
                [{ text: "📤 Надіслати всі фото", callback_data: "send_all_photos" }],
                [{ text: "❌ Скасувати надсилання фото", callback_data: `cancel_photo_upload_${orderId}` }]
              ]}
          });
        }
        notifyClient = false; break;
      case "5":
         if (action === "confirm") { statusMessage = "Фотозвіт підтверджено клієнтом 👍"; }
         else { console.warn(`[CALLBACK_QUERY] Unknown action '${action}' for status index 5.`); notifyClient = false; }
         break;
      case "6":
        if (action === "pack") {
           photoUploadState[chatId] = { orderId, clientId: null, photos: [], awaitingPrice: true };
           const user = await User.findOne({ username: order.username });
           if (user) photoUploadState[chatId].clientId = user.user_id;
           console.log(`[CALLBACK_QUERY] Requesting delivery price for Order ID: ${orderId}`);
           notifyClient = false;
           return bot.editMessageText(`Введіть вартість доставки для замовлення ID: ${orderId} (@${order.username})`, {
              chat_id: chatId, message_id: messageId });
        } else { console.warn(`[CALLBACK_QUERY] Unknown action '${action}' for status index 6.`); notifyClient = false; }
        break;
      case "7": statusMessage = "Посилка прибула до України та готується до відправлення ✅"; break;
      case "8":
         if (action === "sent") { statusMessage = "Посилка відправлена клієнту ✅"; }
         else { console.warn(`[CALLBACK_QUERY] Unknown action '${action}' for status index 8.`); notifyClient = false; }
        break;
      default:
        console.error(`[CALLBACK_QUERY] Unknown status index: ${statusIndex}`);
        return bot.answerCallbackQuery(query.id, { text: "Невідомий статус." });
    }

    if (statusMessage) {
      order.status = statusMessage;
      await order.save();
      console.log(`[CALLBACK_QUERY] Order ID: ${orderId} status updated to: ${statusMessage}`);
      updateOrderInAirtable(order.orderId, statusMessage, order.productName);

      await bot.editMessageText(`Статус замовлення ID: ${orderId} (@${order.username}) оновлено на:\n${statusMessage}`, {
           chat_id: chatId, message_id: messageId,
           reply_markup: {
               inline_keyboard: [
                    [{ text: "📊 Змінити статус ще раз", callback_data: `change_status_${order.orderId}` }],
                    [{ text: "◀️ Назад до списку замовлень", callback_data: "back_to_order_list" }]
                ]
           }
      });

      if (notifyClient) {
        const user = await User.findOne({ username: order.username });
        if (user) {
          try {
              let message = `Статус Вашого замовлення ID: ${orderId} оновлено:\n${statusMessage}`;
               if (statusIndex === "8" && action === "sent") { message += "\nОчікуйте на номер ТТН."; }
              await bot.sendMessage(user.user_id, message, { parse_mode: 'Markdown'});
              console.log(`[CALLBACK_QUERY] Client @${order.username} notified about status update.`);
          } catch (clientNotifyError) {
              console.error(`[CALLBACK_QUERY] Failed to notify client @${order.username} (ID: ${user.user_id}):`, clientNotifyError.message);
          }
        } else { console.error(`[CALLBACK_QUERY] Client user @${order.username} not found for status notification.`); }
      }
    } else if (notifyClient === false && statusIndex !== '4' && statusIndex !== '6') {
         await bot.editMessageText(`Дія для статусу ${statusIndex} оброблена, але статус не змінено.`, {
             chat_id: chatId, message_id: messageId,
             reply_markup: { inline_keyboard: [[{ text: "◀️ Назад до списку замовлень", callback_data: "back_to_order_list" }]] }
         });
    }
   }

   if (data === "cancel_status_change" && isManager) {
      console.log(`[CALLBACK_QUERY] Manager cancelled status change.`);
    bot.answerCallbackQuery(query.id, { text: "Зміна статусу скасована." });
    const orderId = query.message.text.match(/ID: (\S+)/)?.[1];
    if (orderId) {
        const order = await Order.findOne({orderId});
         return bot.editMessageText(`Виберіть новий статус для замовлення ID: ${orderId} (@${order?.username || 'N/A'})\nПоточний: ${order?.status || 'N/A'}`, {
             chat_id: chatId, message_id: messageId, reply_markup: query.message.reply_markup });
    } else {
         return bot.editMessageText("Зміну статусу скасовано.", {
             chat_id: chatId, message_id: messageId, reply_markup: null });
    }
   }
   if (data.startsWith("cancel_photo_upload_") && isManager) {
      const orderId = data.split("_")[3];
      console.log(`[CALLBACK_QUERY] Manager cancelled photo upload for Order ID: ${orderId}.`);
      delete photoUploadState[chatId];
      bot.answerCallbackQuery(query.id, { text: "Надсилання фото скасовано." });
      const order = await Order.findOne({ orderId });
       return bot.editMessageText(`Виберіть новий статус для замовлення ID: ${orderId} (@${order?.username || 'N/A'})\nПоточний: ${order?.status || 'N/A'}`, {
           chat_id: chatId, message_id: messageId,
            reply_markup: { inline_keyboard: [
                 [{ text: "Етап купівлі ✅", callback_data: `set_status_${orderId}_1` }],
                 [{ text: "Викуплено, відпр. на склад 🇨🇳 ✅", callback_data: `set_status_${orderId}_2` }],
                 [{ text: "Прибув на склад, перевірка ✅", callback_data: `set_status_${orderId}_3` }],
                 [{ text: "Надіслати фото-звіт 📷", callback_data: `set_status_${orderId}_4_photo` }],
                 [{ text: "Фотозвіт підтверджено клієнтом 👍", callback_data: `set_status_${orderId}_5_confirm`}],
                 [{ text: "Скомплектовано, до відправки ✅", callback_data: `set_status_${orderId}_6_pack` }],
                 [{ text: "Прибув до України ✅", callback_data: `set_status_${orderId}_7` }],
                 [{ text: "Відправлено клієнту (ТТН) ✅", callback_data: `set_status_${orderId}_8_sent` }],
                 [{ text: "◀️ Назад (до деталей замовл.)", callback_data: `view_order_${order?._id}` }]
             ]}
       });
   }

   if (data === "send_all_photos" && isManager) {
     console.log("[CALLBACK_QUERY] 'send_all_photos' button pressed.");
    if (!photoUploadState[chatId] || !photoUploadState[chatId].photos || photoUploadState[chatId].photos.length === 0) {
      console.log("[CALLBACK_QUERY] No photos found in state to send.");
      return bot.answerCallbackQuery(query.id, { text: "Немає фото для надсилання." });
    }
    const session = photoUploadState[chatId];
    if (!session.clientId) { console.error("[CALLBACK_QUERY] Client ID not found in photo upload session."); delete photoUploadState[chatId]; return bot.answerCallbackQuery(query.id, { text: "Помилка: ID клієнта не знайдено." }); }

    try {
      const mediaGroup = session.photos.map((fileId) => ({ type: "photo", media: fileId }));
      await bot.sendMediaGroup(session.clientId, mediaGroup);
      console.log(`[CALLBACK_QUERY] Photo report sent to Client ID: ${session.clientId} for Order ID: ${session.orderId}`);
      const order = await Order.findOne({ orderId: session.orderId });
      if (order) { order.status = "Фотозвіт готовий."; await order.save(); console.log(`[CALLBACK_QUERY] Order ID: ${session.orderId} status updated to 'Фотозвіт готовий.'`); }
      else { console.warn(`[CALLBACK_QUERY] Order ${session.orderId} not found to update status after sending photos.`); }
      await bot.sendMessage(session.clientId, "Фотозвіт вашого замовлення готовий!");
      await new Promise(resolve => setTimeout(resolve, 300));
      await bot.sendMessage(session.clientId, "Будь ласка, підтвердіть, що все підходить.\nЯкщо є питання - використовуйте '🙇‍♂️ Зв'язок з менеджером'.", {
          reply_markup: { inline_keyboard: [[{ text: "Все підходить ✅", callback_data: `confirm_photos_${session.orderId}` }]] } });
      await bot.editMessageText("Фотозвіт успішно надіслано клієнту ✅", { chat_id: chatId, message_id: messageId, reply_markup: null });
       bot.answerCallbackQuery(query.id);
    } catch (error) {
      console.error("[CALLBACK_QUERY] Error sending photo report:", error);
      bot.answerCallbackQuery(query.id, { text: "Помилка надсилання фото.", show_alert: true });
       await bot.editMessageText("Не вдалося надіслати фото клієнту. Перевірте, чи бот не заблокований.\nСпробуйте надіслати ще раз або скасуйте.", {
            chat_id: chatId, message_id: messageId,
            reply_markup: { inline_keyboard: [
                [{ text: "📤 Надіслати всі фото", callback_data: "send_all_photos" }],
                [{ text: "❌ Скасувати надсилання фото", callback_data: `cancel_photo_upload_${session.orderId}` }]
              ]}
       });
    } finally {
      if (photoUploadState[chatId]) { console.log(`[CALLBACK_QUERY] Clearing photo upload state for Chat ID: ${chatId}`); delete photoUploadState[chatId]; }
    }
    return;
   }

   if (data.startsWith("confirm_photos_")) {
    const orderId = data.split("_")[2];
    console.log(`[CALLBACK_QUERY] Client (User ID: ${userId}) confirmed photos for Order ID: ${orderId}`);
    bot.answerCallbackQuery(query.id, { text: "Дякуємо за підтвердження!" });
    await bot.editMessageText("Дякуємо! Менеджер продовжить обробку замовлення.\nЯкщо у вас виникнуть питання, звертайтеся до менеджера.", {
        chat_id: chatId, message_id: messageId, reply_markup: null });
    const order = await Order.findOne({ orderId });
    if (order) {
        bot.sendMessage(process.env.MANAGER_CHAT_ID, `Клієнт @${order.username || query.from.username || userId} підтвердив фотозвіт для замовлення ID: ${orderId}.`, {
            reply_markup: { inline_keyboard: [[{ text: "Встановити статус 'Фото підтверджено'", callback_data: `set_status_${orderId}_5_confirm` }]] } });
    } else { bot.sendMessage(process.env.MANAGER_CHAT_ID, `Клієнт (ID: ${userId}) підтвердив фотозвіт для замовлення ID: ${orderId} (Замовлення не знайдено!).`); }
    return;
   }

  if (data === "cancel_order" && isManager) {
    if (orderData[chatId]) {
      delete orderData[chatId];
      bot.answerCallbackQuery(query.id, { text: "Оформлення скасовано." });
      console.log(`[CALLBACK_QUERY] Order creation cancelled by manager.`);
      return bot.editMessageText("Оформлення замовлення було скасовано.", { chat_id: chatId, message_id: messageId, reply_markup: null });
    } else {
      bot.answerCallbackQuery(query.id, { text: "Немає активного процесу оформлення." });
       return bot.editMessageText("Немає активного процесу оформлення.", { chat_id: chatId, message_id: messageId, reply_markup: null });
    }
  }

  if (data.startsWith("quick_reply_")) {
    console.log(`[CALLBACK_QUERY] Processing quick reply: ${data}`);
    if (isManager) { return bot.answerCallbackQuery(query.id); }
    switch (data) {
        case "quick_reply_1": bot.editMessageText(`Чи можливий накладний платіж?\n\nЯкщо товар в наявності в Україні🇺🇦\n\n1️⃣ По повній оплаті за реквізитами.\n\n2️⃣ При отриманні замовлення на пошті (діє 150 грн передплата).\n\n- Ми змушені брати 150 грн передоплати для того щоб компенсувати вартість доставки в обидві сторони, за умови якщо клієнт на забере товар на пошті. Це не додаткова оплата, ми відрахуємо цю суму від вартості товару.`, { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [ [{ text: "Гаразд, якщо товар під замовлення з-за кордону? 🇨🇳", callback_data: "quick_reply_1_1" }], [{ text: "◀️ Назад", callback_data: "quick_reply_back" }], [{ text: "Меню", callback_data: "quick_reply_menu" }] ] } }); break;
        case "quick_reply_1_1": bot.editMessageText(`1️⃣ Передоплата 100% від вартості товару, оплата за доставку повідомляється Вам разом із фото-звітом\n\n- під замовлення означає що ми привеземо товар необхідної Вам моделі у необхідному Вам розмірі, тобто це індивідуальне замовлення спеціально для Вас, а передоплату 100% від вартості ми змушені брати щоб бути впевненому, що Ви дочекаєтеся коли прибуде Ваше замовлення.`, { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [ [{ text: "◀️ Назад", callback_data: "quick_reply_1" }], [{ text: "Меню", callback_data: "quick_reply_menu" }] ] } }); break;
        case "quick_reply_2": bot.editMessageText(`Обмін\\повернення товару з наявності\n\nУ нас є можливість обміну/повернення товару в період 7 днів з моменту замовлення🔄\n\nУмови обміну/повернення:\n\n1️⃣ Товар не носився, він чистий та збережено його товарний вигляд.\n\n2️⃣ Збережено заводську упаковку та всі бірки.\n\n3️⃣ Оплату за доставку обміну/повернення здійснює покупець`, { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [ [{ text: "◀️ Назад", callback_data: "quick_reply_back" }], [{ text: "Меню", callback_data: "quick_reply_menu" }] ] } }); break;
        case "quick_reply_3": bot.editMessageText(`Обмін\\повернення товару під замовлення\n\n1️⃣ Ми привезли не той товар що Ви замовляли.\n2️⃣ Ми привезли не той розмір що Ви замовляли.\n3️⃣ Ми привезли товар з браком ( Пляма, пошкодження )\n\nТакож, хочемо пояснити що “під замовлення” означає що ми замовляємо з-за кордону 1 розмір певної моделі спеціально для Вас. Це індивідуальне замовлення. Тому Ви не зможете його повернути якщо Вам модель не сподобається або розмір не підійде.`, { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [ [{ text: "◀️ Назад", callback_data: "quick_reply_back" }], [{ text: "Меню", callback_data: "quick_reply_menu" }] ] } }); break;
        case "quick_reply_4": bot.editMessageText(`Термін доставки\n\nДоставка товару з наявності 🇺🇦 відбувається в період 1-3 робочих днів з моменту отримання передоплати🚛\n\nДоставка товару під замовлення 🇨🇳 відбувається в період 10-20 робочих днів✈️`, { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [ [{ text: "◀️ Назад", callback_data: "quick_reply_back" }], [{ text: "Вартість доставки", callback_data: "quick_reply_5" }], [{ text: "Меню", callback_data: "quick_reply_menu" }] ] } }); break;
        case "quick_reply_5": bot.editMessageText(`Вартість доставки\n\n1 кг — 18$.\nЯкщо замовлення важить менше 0.5 кг, вартість доставки розраховується як за 0.5 кг.`, { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [ [{ text: "◀️ Назад", callback_data: "quick_reply_back" }], [{ text: "Меню", callback_data: "quick_reply_menu" }] ] } }); break;
        case "quick_reply_6": bot.editMessageText(`Хочу замовити у Європу\n\nНе проблема! Ми викупляємо товар та відправляємо Вам напряму з Китаю 🇨🇳, який згодом доставляється DHL на вашу адресу.`, { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [ [{ text: "◀️ Назад", callback_data: "quick_reply_back" }], [{ text: "Меню", callback_data: "quick_reply_menu" }] ] } }); break;
        case "quick_reply_7":
             await bot.answerCallbackQuery(query.id);
             const existingTicket = await Ticket.findOne({ user_id: chatId, status: 'open' });
              if (existingTicket) { await bot.sendMessage(chatId, "У вас вже є активна заявка."); }
              else {
                   const ticketId = await generateTicketId();
                   const ticket = new Ticket({ ticket_id: ticketId, user_id: chatId, status: 'open', accepted: false, activeManagerConversation: false, messages: [] });
                   await ticket.save();
                   await User.findOneAndUpdate({ user_id: chatId }, { $push: { tickets: ticketId } });
                   const user = await User.findOne({ user_id: chatId });
                   const greetingName = user ? user.name : "Без імені";
                   const kyivDate = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Kiev' }));
                   const currentHour = kyivDate.getHours();
                   if (currentHour >= 21 || currentHour < 9) { await bot.sendMessage(chatId, `Менеджери відпочивають🥱 Зачекайте до 9:00.`); await bot.sendMessage(chatId, `✍️ Напишіть питання...`); }
                   else { await bot.sendMessage(chatId, `Дякуємо, ${greetingName}, очікуйте менеджера 😉`); }
                   const userNameForManager = user ? user.name || "Без імені" : "Без імені";
                   const userUsernameForManager = query.from.username || "Без імені користувача";
                   await bot.sendMessage(process.env.MANAGER_CHAT_ID, `Нова заявка ${ticketId} від ${userNameForManager} (@${userUsernameForManager}). Підтвердити?`, { reply_markup: { inline_keyboard: [[{ text: "Прийняти", callback_data: `accept_${ticketId}` }]] } });
               }
             await bot.deleteMessage(chatId, messageId).catch(e => console.error("Failed to delete quick replies message:", e.message));
             break;
        case "quick_reply_back": await bot.editMessageText("Виберіть питання:", { chat_id: chatId, message_id: messageId, reply_markup: quickRepliesKeyboard() }); break;
        case "quick_reply_menu":
            await bot.answerCallbackQuery(query.id);
            await bot.deleteMessage(chatId, messageId).catch(e => console.error("Failed to delete quick replies message:", e.message));
            await bot.sendMessage(chatId, "🏡 ГОЛОВНЕ МЕНЮ.", { reply_markup: mainMenuKeyboard() }); break;
        default: console.log(`[CALLBACK_QUERY] Unknown quick reply: ${data}`); bot.answerCallbackQuery(query.id); break;
    }
    if (!["quick_reply_7", "quick_reply_menu"].includes(data)) { await bot.answerCallbackQuery(query.id); }
    return;
   }

   if (data.startsWith("accept_") && isManager) {
      console.log(`[CALLBACK_QUERY] Manager trying to accept ticket: ${data}`);
      const ticketId = data.split("_")[1];
      const ticket = await Ticket.findOne({ ticket_id: ticketId });
      if (ticket) {
          if (ticket.accepted) {
               console.log(`[CALLBACK_QUERY] Ticket ${ticketId} already accepted. Setting as active conversation.`);
               await Ticket.updateMany({ _id: { $ne: ticket._id }, status: 'open', accepted: true, activeManagerConversation: true }, { $set: { activeManagerConversation: false } });
               ticket.activeManagerConversation = true; await ticket.save();
                await bot.answerCallbackQuery(query.id, { text: `Переключено на заявку ${ticketId}` });
                await bot.editMessageText(`Ви переключились на заявку ${ticketId}. Напишіть повідомлення клієнту.`, { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [[{ text: "Завершити листування", callback_data: `close_${ticketId}_manager` }]] } });
          } else {
              ticket.accepted = true; ticket.activeManagerConversation = true;
              await Ticket.updateMany({ _id: { $ne: ticket._id }, status: 'open', accepted: true, activeManagerConversation: true }, { $set: { activeManagerConversation: false } });
              await ticket.save(); console.log(`[CALLBACK_QUERY] Ticket ${ticketId} accepted and set as active.`);
              const user = await User.findOne({ user_id: ticket.user_id }); const userName = user ? user.name || "Без імені" : "Без імені";
              try { await bot.sendMessage(ticket.user_id, `✅ В чат підключився менеджер prudbaydelivery ®`, { reply_markup: { keyboard: [["📤 Вийти і завершити чат"]], resize_keyboard: true, one_time_keyboard: false } });
              } catch (sendError) { console.error(`[CALLBACK_QUERY] Failed to send 'manager connected' message to user ${ticket.user_id}:`, sendError.message); }
              if (ticket.messages.length > 0) {
                 const userMessages = ticket.messages.filter(msg => msg.from === 'user');
                 if (userMessages.length > 0) { let messagesText = `Повідомлення від ${userName} (${ticketId}):\n`; userMessages.forEach(msg => { const msgDate = new Date(msg.timestamp); const msgTime = `${msgDate.getHours()}:${msgDate.getMinutes().toString().padStart(2, '0')}`; messagesText += `(${msgTime}): ${msg.text}\n`; }); await bot.sendMessage(process.env.MANAGER_CHAT_ID, messagesText); }
              }
              await bot.answerCallbackQuery(query.id, { text: `Заявку ${ticketId} прийнято` });
              await bot.editMessageText(`Заявка ${ticketId} прийнята. Напишіть повідомлення клієнту.`, { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [[{ text: "Завершити листування", callback_data: `close_${ticketId}_manager` }]] } });
          }
      } else { console.error(`[CALLBACK_QUERY] Ticket ${ticketId} not found for acceptance.`); await bot.answerCallbackQuery(query.id, { text: "Заявку не знайдено", show_alert: true }); await bot.deleteMessage(chatId, messageId).catch(e => console.error("Failed to delete msg:", e.message)); }
       return;
   } else if (data.startsWith("close_")) {
      console.log(`[CALLBACK_QUERY] Attempting to close ticket: ${data}`);
      const [_, ticketId, role] = data.split("_"); const ticket = await Ticket.findOne({ ticket_id: ticketId });
      if (!ticket) { console.error(`[CALLBACK_QUERY] Ticket ${ticketId} not found for closing.`); bot.answerCallbackQuery(query.id, { text: "Заявку не знайдено" }); return; }
      if (ticket.status === 'closed') { console.log(`[CALLBACK_QUERY] Ticket ${ticketId} is already closed.`); bot.answerCallbackQuery(query.id, { text: `Заявка ${ticketId} вже закрита` }); if (role === "manager") { bot.editMessageText(`Заявка ${ticketId} вже закрита.`, { chat_id: chatId, message_id: messageId, reply_markup: null }); } return; }
      ticket.status = 'closed'; ticket.activeManagerConversation = false; await ticket.save(); console.log(`[CALLBACK_QUERY] Ticket ${ticketId} closed by ${role || 'user'}.`);
      bot.answerCallbackQuery(query.id, { text: `Заявку ${ticketId} закрито` });
      if (role === "manager") {
         try { await bot.sendMessage(ticket.user_id, `🔒 Менеджер завершив листування. Ваше звернення закрито.`, { reply_markup: mainMenuKeyboard() }); }
         catch (sendError) { console.error(`[CALLBACK_QUERY] Failed to send 'ticket closed' msg to user ${ticket.user_id}:`, sendError.message); }
         await bot.editMessageText(`Листування по заявці ${ticketId} завершено.`, { chat_id: chatId, message_id: messageId, reply_markup: null });
      } else { const user = await User.findOne({ user_id: ticket.user_id }); const userName = user ? user.name || "Без імені" : "Без імені"; await bot.sendMessage(process.env.MANAGER_CHAT_ID, `Клієнт ${userName} закрив заявку ${ticketId}.`); }
      return;
   }

  if (data.startsWith("view_tickets_") && isManager) { console.log(`[CALLBACK_QUERY] Manager viewing tickets history: ${data}`); const parts = data.split("_"); const type = parts[2]; const page = parseInt(parts[3], 10); bot.answerCallbackQuery(query.id); await showTicketsHistory(bot, chatId, type, page, messageId); return; }
  if (data.startsWith("details_") && isManager) { console.log(`[CALLBACK_QUERY] Manager viewing ticket details: ${data}`); const ticketId = data.split("_")[1]; bot.answerCallbackQuery(query.id); await showTicketDetails(bot, chatId, ticketId, messageId); return; }
  if (data === "back_to_ticket_options" && isManager) { console.log(`[CALLBACK_QUERY] Manager going back to ticket type options.`); bot.answerCallbackQuery(query.id); bot.editMessageText("Виберіть тип заявок для перегляду:", { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [ [{ text: "Всі заявки", callback_data: "view_tickets_all_1" }], [{ text: "Відкриті заявки", callback_data: "view_tickets_open_1" }], [{ text: "Закриті заявки", callback_data: "view_tickets_closed_1" }] ] } }); return; }
  if (data === "back_to_ticket_list" && isManager) { console.log(`[CALLBACK_QUERY] Manager going back to ticket list (defaulting to 'all').`); const type = "all"; bot.answerCallbackQuery(query.id); await showTicketsHistory(bot, chatId, type, 1, messageId); return; }

  if (data.startsWith("stage_status_")) { console.log(`[CALLBACK_QUERY] Client asking stage status question: ${data}`); if (isManager) return bot.answerCallbackQuery(query.id); let responseText = ""; switch (data) { case "stage_status_1": responseText = "Статус оновлюється протягом 24-годин..."; break; case "stage_status_2": responseText = "Середній термін - 3 дні..."; break; case "stage_status_3": responseText = "Зазвичай фото-звіт надходить протягом години..."; break; case "stage_status_5": responseText = "Доставка оплачується протягом 4-х днів..."; break; case "stage_status_6": responseText = "Посилки відправляються до 19:00..."; break; default: responseText = "Невідоме питання."; break; } await bot.editMessageText(responseText, { chat_id: chatId, message_id: messageId, reply_markup: backButtonKeyboard() }); bot.answerCallbackQuery(query.id); return; }
  if (data === "stage_back") { console.log(`[CALLBACK_QUERY] Client going back to stages keyboard.`); if (isManager) return bot.answerCallbackQuery(query.id); await bot.editMessageText("Виберіть стадію замовлення:", { chat_id: chatId, message_id: messageId, reply_markup: stagesKeyboard() }); bot.answerCallbackQuery(query.id); return; }
  if (data.startsWith("status_question_")) { console.log(`[CALLBACK_QUERY] Client asking order status question: ${data}`); if (isManager) return bot.answerCallbackQuery(query.id); let responseText = ""; switch (data) { case "status_question_1": responseText = "Статус оновлюється протягом 24-годин..."; break; case "status_question_2": responseText = "Середній термін - 3 дні..."; break; case "status_question_3": responseText = "Зазвичай фото-звіт надходить протягом години..."; break; case "status_question_5": responseText = "Доставка оплачується протягом 4-х днів..."; break; case "status_question_6": responseText = "Посилки відправляються до 19:00..."; break; default: responseText = "Невідоме питання."; break; } await bot.editMessageText(responseText, { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [[{ text: "◀️ Назад", callback_data: "status_back" }]] } }); bot.answerCallbackQuery(query.id); return; }
  if (data === "status_back") { console.log(`[CALLBACK_QUERY] Client going back to order status view.`); if (isManager) return bot.answerCallbackQuery(query.id); const user = await User.findOne({ user_id: chatId }); if (!user || !user.username) { await bot.editMessageText("Не вдалося отримати статус. Перевірте юзернейм.", { chat_id: chatId, message_id: messageId, reply_markup: null }); return bot.answerCallbackQuery(query.id); } const orders = await Order.find({ username: user.username }).sort({ createdAt: -1 }); if (!orders || orders.length === 0) { await bot.editMessageText("Замовлень ще немає.", { chat_id: chatId, message_id: messageId, reply_markup: null }); return bot.answerCallbackQuery(query.id); } const latestOrder = orders[0]; const status = latestOrder.status || "Замовлення створено"; const orderId = latestOrder.orderId || "Невідомий"; let responseText = `Ваше останнє замовлення ID: ${orderId}\nСтатус: ${status}`; let inlineKeyboard = []; switch (status) { case "Замовлення прийнято та на етапі купівлі ✅": inlineKeyboard = [[{ text: "Коли новий статус?", callback_data: "status_question_1" }]]; break; case "Товар викуплено та відправлено на склад в Китаї ✅": inlineKeyboard = [[{ text: "Коли прибуде?", callback_data: "status_question_2" }]]; break; case "Товар прибув на склад та готується до перевірки ✅": inlineKeyboard = [[{ text: "Коли фото-звіт?", callback_data: "status_question_3" }]]; break; case "Фотозвіт готовий.": inlineKeyboard = [[{ text: "Все підходить ✅", callback_data: `confirm_photos_${latestOrder.orderId}` }]]; responseText += "\nОчікуємо підтвердження."; break; case "Посилка успішно скомплектована та готується до відправки ✅": responseText += `\nДоставка: ${latestOrder.deliveryPrice != null ? latestOrder.deliveryPrice + ' грн' : "Очікуйте"} грн.`; inlineKeyboard = [[{ text: "Час на оплату?", callback_data: "status_question_5" }]]; break; case "Посилка прибула до України та готується до відправлення ✅": inlineKeyboard = [[{ text: "Коли відправлення?", callback_data: "status_question_6" }]]; break; } await bot.editMessageText(responseText, { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: inlineKeyboard } }); bot.answerCallbackQuery(query.id); return; }

  console.log(`[CALLBACK_QUERY] Unhandled callback data: ${data} by User ID: ${userId}`);
  bot.answerCallbackQuery(query.id).catch(err => console.error("Error answering unhandled callback query:", err.message));

}

module.exports = callbackQueryHandler;