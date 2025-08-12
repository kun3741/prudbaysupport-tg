const Ticket = require("../models/Ticket");
const Order = require("../models/Order");
const User = require("../models/User");
const {
  mainMenuKeyboard,
  quickRepliesKeyboard,
  stagesKeyboard,
  backButtonKeyboard,
  personalCabinetKeyboard
} = require("../utils/keyboards");
const Counter = require("../models/Counter");
const {
  showTicketsHistory,
  showTicketDetails,
} = require("../commands/tickets");
const { showManagerOrdersList, sendMainMenu } = require("../commands/start");
const { updateOrderInAirtable } = require("../utils/airtable");
const { showOrderStatus, messagesHandler } = require("./messages");

async function generateTicketId() {
  let counter = await Counter.findOne({ name: "ticketId" });
  if (!counter) {
    counter = new Counter({ name: "ticketId", value: 0 });
  }
  counter.value += 1;
  await counter.save();
  const paddedNumber = counter.value.toString().padStart(4, "0");
  return `ticket-${paddedNumber}`;
}

async function showManagerOrderDetails(bot, chatId, messageId, orderMongoId) {
  try {
    const order = await Order.findById(orderMongoId);

    if (!order) {
      console.error(`[showManagerOrderDetails] Order not found: ${orderMongoId}`);
      return bot.editMessageText("Помилка: Замовлення не знайдено.", {
        chat_id: chatId, message_id: messageId,
        reply_markup: { inline_keyboard: [[{ text: "◀️ Назад", callback_data: "back_to_order_list" }]] },
      });
    }
    if (!order.orderId) { console.error(`[showManagerOrderDetails] Order ID missing: ${orderMongoId}`); }

    const createdAtDate = order.createdAt
      ? new Date(order.createdAt).toLocaleString("uk-UA", { timeZone: "Europe/Kiev", })
      : "Невідомо";

    const orderDetailsText = `📦 Деталі замовлення ID: ${order.orderId || "N/A"}

🏷️ Товар: ${order.productName || "Не вказано"}

👤 Клієнт:
   - Юзернейм: @${order.username || "N/A"}
   - ПІБ: ${order.fullName || "N/A"}
   - Телефон: ${order.phoneNumber || "N/A"}

🚚 Доставка:
   - Місто: ${order.city || "N/A"}
   - Відділення НП: ${order.novaPost || "N/A"}
   - Вартість доставки: ${order.deliveryPrice != null ? order.deliveryPrice + " грн" : "Не вказано"}

📊 Статус: ${order.status || "Замовлення створено"}
📅 Створено: ${createdAtDate}`;

    console.log(`[showManagerOrderDetails] Displaying details for Order ID: ${order.orderId}`);
    const keyboard = [ [{ text: "◀️ Назад до списку замовлень", callback_data: "back_to_order_list" }] ];
    if (order.orderId) { keyboard.unshift([{ text: "📊 Змінити статус", callback_data: `change_status_${order.orderId}` }]); }

    await bot.editMessageText(orderDetailsText, {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: keyboard },
    });

  } catch (error) {
    console.error(`[showManagerOrderDetails] Error showing details:`, error);
    await bot.editMessageText("Не вдалося завантажити деталі замовлення.", {
        chat_id: chatId, message_id: messageId,
        reply_markup: { inline_keyboard: [ [{ text: "◀️ Назад", callback_data: "back_to_order_list" }] ] },
      }).catch((editErr) => console.error("Failed to edit msg on error:", editErr));
  }
}


async function callbackQueryHandler(bot, query, photoUploadState, orderData, profileViewState, addressChangeState, directMessageState, bonusChangeState, shippingInfoState, receiptUploadState, broadcastState) {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const data = query.data;
  const userId = query.from.id;
  const managerId = process.env.MANAGER_CHAT_ID;

  console.log(`[CALLBACK_QUERY] Data: ${data}, UserID: ${userId}, ChatID: ${chatId}, ManagerID Env: ${managerId}`);
  const isManager = userId.toString() === managerId;
  console.log(`[CALLBACK_QUERY] isManager Check: ${isManager}`);
  
  if (isManager && (data === 'create_order_ua' || data === 'create_order_abroad')) {
    const direction = data === 'create_order_ua' ? 'В Україну' : 'За кордон';
    orderData[chatId] = {
      step: 0,
      data: { direction },
      fields: direction === 'В Україну'
        ? ["username", "fullName", "phoneNumber", "productName", "city", "novaPost", "totalPrice", "netProfit", "orderId"]
        : ["username", "englishFullName", "phoneNumber", "productName", "country", "city", "region", "address", "postcode", "totalPrice", "netProfit", "orderId"],
      questions: direction === 'В Україну'
        ? [
            "Введіть @юзернейм клієнта: (без @)",
            "Введіть Прізвище, Ім'я, По-Батькові клієнта:",
            "Введіть номер телефону клієнта (формат +380xxxxxxxxx) або 'Так', щоб використати номер з бази:",
            "Введіть назву товару:",
            "Введіть місто-отримувача:",
            "Введіть номер відділення Нової Пошти:",
            "Введіть вартість товару (число):",
            "Введіть чистий прибуток (число):",
            "Введіть ID замовлення:"
          ]
        : [
            "Введіть @юзернейм клієнта: (без @)",
            "Введіть ПІБ латиницею (англійською):",
            "Введіть номер телефону клієнта у міжнародному форматі (наприклад, +48..., +33...):",
            "Введіть назву товару:",
            "Введіть країну:",
            "Введіть місто:",
            "Введіть область/район/провінцію (або напишіть 'Пропустити'):",
            "Введіть адресу проживання:",
            "Введіть поштовий індекс:",
            "Введіть вартість товару (число):",
            "Введіть чистий прибуток (число):",
            "Введіть ID замовлення:"
          ]
    };
    bot.answerCallbackQuery(query.id);
    return bot.editMessageText(orderData[chatId].questions[0], { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [[{ text: 'Відмінити оформлення', callback_data: 'cancel_order' }]] } });
  }

  if (data === "current_page") { bot.answerCallbackQuery(query.id, { text: "Ви вже тут" }); return; }

  if (data && data.startsWith("view_order_")) { console.log(`[CALLBACK_QUERY] view_order_ START`); if (isManager) { console.log(`[CALLBACK_QUERY] isManager TRUE for view_order_`); try { bot.answerCallbackQuery(query.id); const orderMongoId = data.split("_")[2]; console.log(`[CALLBACK_QUERY] Extracted Order Mongo ID: ${orderMongoId}`); await showManagerOrderDetails(bot, chatId, messageId, orderMongoId); console.log(`[CALLBACK_QUERY] showManagerOrderDetails finished.`); } catch (error) { console.error("[CALLBACK_QUERY] Error inside 'view_order_' processing:", error); try { await bot.answerCallbackQuery(query.id, { text: 'Помилка обробки', show_alert: true }); } catch (ansErr) { console.error("Failed to answer query on error:", ansErr); } } return; } else { console.log(`[CALLBACK_QUERY] isManager FALSE for view_order_`); bot.answerCallbackQuery(query.id, { text: "Лише для менеджера." }); return; } }
  if (data === "back_to_order_list") { console.log(`[CALLBACK_QUERY] back_to_order_list START`); if (isManager) { console.log(`[CALLBACK_QUERY] isManager TRUE for back_to_order_list`); try { bot.answerCallbackQuery(query.id); await showManagerOrdersList(bot, chatId, messageId); console.log(`[CALLBACK_QUERY] showManagerOrdersList (back) finished.`); } catch (error) { console.error("[CALLBACK_QUERY] Error inside 'back_to_order_list':", error); try { await bot.answerCallbackQuery(query.id, { text: 'Помилка повернення', show_alert: true }); } catch (ansErr) { console.error("Failed to answer query on error:", ansErr); } } return; } else { console.log(`[CALLBACK_QUERY] isManager FALSE for back_to_order_list`); bot.answerCallbackQuery(query.id); return; } }
  if (data.startsWith("change_status_") && isManager) { 
    bot.answerCallbackQuery(query.id); 
    const orderId = data.split("_")[2]; 
    const order = await Order.findOne({ orderId }); 
    if (!order) { 
      return bot.answerCallbackQuery(query.id, { text: "Замовлення не знайдено." }); 
    } 
    const currentStatus = order.status || "Створено"; 
    console.log(`[CALLBACK_QUERY] Manager req status change for Order ID: ${orderId}`); 
    return bot.editMessageText(`Виберіть статус для ID: ${orderId} (@${order.username})\nПоточний: ${currentStatus}`, { 
      chat_id: chatId, 
      message_id: messageId, 
      reply_markup: { 
        inline_keyboard: [ 
          [{ text: "Етап купівлі ✅", callback_data: `set_status_${orderId}_1` }], 
          [{ text: "Викуплено, відпр. 🇨🇳 ✅", callback_data: `set_status_${orderId}_2` }], 
          [{ text: "Прибув склад, перевірка ✅", callback_data: `set_status_${orderId}_3` }], 
          [{ text: "Надіслати фото 📷", callback_data: `set_status_${orderId}_4_photo` }], 
          [{ text: "Фото підтверджено 👍", callback_data: `set_status_${orderId}_5_confirm` }], 
          [{ text: "Скомплектовано", callback_data: `status_comp_${orderId}` }], 
          [{ text: "Відправлено ✅", callback_data: `status_shipped_${orderId}` }], 
          [{ text: "Доставка оплачена ✅", callback_data: `status_paid_${orderId}` }], 
          [{ text: "Відгук ❤️", callback_data: `status_feedback_${orderId}` }], 
          [{ text: "◀️ Назад (до деталей)", callback_data: `view_order_${order._id}` }] 
        ] 
      } 
    }); 
  }

  if (data === "cancel_status_change" && isManager) {
    console.log(`[CALLBACK_QUERY] Manager cancelled status change.`);
    bot.answerCallbackQuery(query.id, { text: "Зміна статусу скасована." });
    const orderId = query.message.text.match(/ID: (\S+)/)?.[1];
    if (orderId) {
      const order = await Order.findOne({ orderId });
      return bot.editMessageText(
        `Виберіть новий статус для замовлення ID: ${orderId} (@${
          order?.username || "N/A"
        })\nПоточний: ${order?.status || "N/A"}`,
        {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: query.message.reply_markup,
        }
      );
    } else {
      return bot.editMessageText("Зміну статусу скасовано.", {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: null,
      });
    }
  }
  if (data.startsWith("cancel_photo_upload_") && isManager) {
    const orderId = data.split("_")[3];
    console.log(
      `[CALLBACK_QUERY] Manager cancelled photo upload for Order ID: ${orderId}.`
    );
    delete photoUploadState[chatId];
    bot.answerCallbackQuery(query.id, { text: "Надсилання фото скасовано." });
    const order = await Order.findOne({ orderId });
    return bot.editMessageText(
      `Виберіть новий статус для замовлення ID: ${orderId} (@${
        order?.username || "N/A"
      })\nПоточний: ${order?.status || "N/A"}`,
      {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "Етап купівлі ✅",
                callback_data: `set_status_${orderId}_1`,
              },
            ],
            [
              {
                text: "Викуплено, відпр. на склад 🇨🇳 ✅",
                callback_data: `set_status_${orderId}_2`,
              },
            ],
            [
              {
                text: "Прибув на склад, перевірка ✅",
                callback_data: `set_status_${orderId}_3`,
              },
            ],
            [
              {
                text: "Надіслати фото-звіт 📷",
                callback_data: `set_status_${orderId}_4_photo`,
              },
            ],
            [
              {
                text: "Фотозвіт підтверджено клієнтом 👍",
                callback_data: `set_status_${orderId}_5_confirm`,
              },
            ],
            [
              {
                text: "Скомплектовано, до відправки ✅",
                callback_data: `set_status_${orderId}_6_pack`,
              },
            ],
            [
              {
                text: "Прибув до України ✅",
                callback_data: `set_status_${orderId}_7`,
              },
            ],
            [
              {
                text: "Відправлено клієнту (ТТН) ✅",
                callback_data: `set_status_${orderId}_8_sent`,
              },
            ],
            [
              {
                text: "◀️ Назад (до деталей замовл.)",
                callback_data: `view_order_${order?._id}`,
              },
            ],
          ],
        },
      }
    );
  }

  if (data === "send_all_photos" && isManager) {
    console.log("[CALLBACK_QUERY] 'send_all_photos' button pressed.");
    if (
      !photoUploadState[chatId] ||
      !photoUploadState[chatId].photos ||
      photoUploadState[chatId].photos.length === 0
    ) {
      console.log("[CALLBACK_QUERY] No photos found in state to send.");
      return bot.answerCallbackQuery(query.id, {
        text: "Немає фото для надсилання.",
      });
    }
    const session = photoUploadState[chatId];
    if (!session.clientId) {
      console.error(
        "[CALLBACK_QUERY] Client ID not found in photo upload session."
      );
      delete photoUploadState[chatId];
      return bot.answerCallbackQuery(query.id, {
        text: "Помилка: ID клієнта не знайдено.",
      });
    }

    try {
      const mediaGroup = session.photos.map((fileId) => ({
        type: "photo",
        media: fileId,
      }));
      await bot.sendMediaGroup(session.clientId, mediaGroup);
      console.log(
        `[CALLBACK_QUERY] Photo report sent to Client ID: ${session.clientId} for Order ID: ${session.orderId}`
      );
      const order = await Order.findOne({ orderId: session.orderId });
      if (order) {
        order.status = "Фотозвіт готовий.";
        await order.save();
        console.log(
          `[CALLBACK_QUERY] Order ID: ${session.orderId} status updated to 'Фотозвіт готовий.'`
        );
      } else {
        console.warn(
          `[CALLBACK_QUERY] Order ${session.orderId} not found to update status after sending photos.`
        );
      }
      await bot.sendMessage(
        session.clientId,
        "Фотозвіт вашого замовлення готовий!"
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
      await bot.sendMessage(
        session.clientId,
        "Будь ласка, підтвердіть, що все підходить.\nЯкщо є питання - використовуйте '🙇‍♂️ Зв'язок з менеджером'.",
        {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "Все підходить ✅",
                  callback_data: `confirm_photos_${session.orderId}`,
                },
              ],
            ],
          },
        }
      );
      await bot.editMessageText("Фотозвіт успішно надіслано клієнту ✅", {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: null,
      });
      bot.answerCallbackQuery(query.id);
    } catch (error) {
      console.error("[CALLBACK_QUERY] Error sending photo report:", error);
      bot.answerCallbackQuery(query.id, {
        text: "Помилка надсилання фото.",
        show_alert: true,
      });
      await bot.editMessageText(
        "Не вдалося надіслати фото клієнту. Перевірте, чи бот не заблокований.\nСпробуйте надіслати ще раз або скасуйте.",
        {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "📤 Надіслати всі фото",
                  callback_data: "send_all_photos",
                },
              ],
              [
                {
                  text: "❌ Скасувати надсилання фото",
                  callback_data: `cancel_photo_upload_${session.orderId}`,
                },
              ],
            ],
          },
        }
      );
    } finally {
      if (photoUploadState[chatId]) {
        console.log(
          `[CALLBACK_QUERY] Clearing photo upload state for Chat ID: ${chatId}`
        );
        delete photoUploadState[chatId];
      }
    }
    return;
  }

  if (data.startsWith("confirm_photos_")) {
    const orderId = data.split("_")[2];
    console.log(
      `[CALLBACK_QUERY] Client (User ID: ${userId}) confirmed photos for Order ID: ${orderId}`
    );
    bot.answerCallbackQuery(query.id, { text: "Дякуємо за підтвердження!" });
    await bot.editMessageText(
      "Дякуємо! Менеджер продовжить обробку замовлення.\nЯкщо у вас виникнуть питання, звертайтеся до менеджера.",
      {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: null,
      }
    );
    const order = await Order.findOne({ orderId });
    if (order) {
      bot.sendMessage(
        process.env.MANAGER_CHAT_ID,
        `Клієнт @${
          order.username || query.from.username || userId
        } підтвердив фотозвіт для замовлення ID: ${orderId}.`,
        {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "Встановити статус 'Фото підтверджено'",
                  callback_data: `set_status_${orderId}_5_confirm`,
                },
              ],
            ],
          },
        }
      );
    } else {
      bot.sendMessage(
        process.env.MANAGER_CHAT_ID,
        `Клієнт (ID: ${userId}) підтвердив фотозвіт для замовлення ID: ${orderId} (Замовлення не знайдено!).`
      );
    }
    return;
  }

  if (data === "cancel_order" && isManager) {
    if (orderData[chatId]) {
      delete orderData[chatId];
      bot.answerCallbackQuery(query.id, { text: "Оформлення скасовано." });
      console.log(`[CALLBACK_QUERY] Order creation cancelled by manager.`);
      return bot.editMessageText("Оформлення замовлення було скасовано.", {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: null,
      });
    } else {
      bot.answerCallbackQuery(query.id, {
        text: "Немає активного процесу оформлення.",
      });
      return bot.editMessageText("Немає активного процесу оформлення.", {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: null,
      });
    }
  }

  if (data.startsWith("quick_reply_")) {
    console.log(`[CALLBACK_QUERY] Processing quick reply: ${data}`);
    if (isManager) {
      return bot.answerCallbackQuery(query.id);
    }
    switch (data) {
      case "quick_reply_1":
        bot.editMessageText(
          `Чи можливий накладний платіж?\n\nЯкщо товар в наявності в Україні🇺🇦\n\n1️⃣ По повній оплаті за реквізитами.\n\n2️⃣ При отриманні замовлення на пошті (діє 150 грн передплата).\n\n- Ми змушені брати 150 грн передоплати для того щоб компенсувати вартість доставки в обидві сторони, за умови якщо клієнт на забере товар на пошті. Це не додаткова оплата, ми відрахуємо цю суму від вартості товару.`,
          {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: "Гаразд, якщо товар під замовлення з-за кордону? 🇨🇳",
                    callback_data: "quick_reply_1_1",
                  },
                ],
                [{ text: "◀️ Назад", callback_data: "quick_reply_back" }],
                [{ text: "Меню", callback_data: "quick_reply_menu" }],
              ],
            },
          }
        );
        break;
      case "quick_reply_1_1":
        bot.editMessageText(
          `1️⃣ Передоплата 100% від вартості товару, оплата за доставку повідомляється Вам разом із фото-звітом\n\n- під замовлення означає що ми привеземо товар необхідної Вам моделі у необхідному Вам розмірі, тобто це індивідуальне замовлення спеціально для Вас, а передоплату 100% від вартості ми змушені брати щоб бути впевненому, що Ви дочекаєтеся коли прибуде Ваше замовлення.`,
          {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
              inline_keyboard: [
                [{ text: "◀️ Назад", callback_data: "quick_reply_1" }],
                [{ text: "Меню", callback_data: "quick_reply_menu" }],
              ],
            },
          }
        );
        break;
      case "quick_reply_2":
        bot.editMessageText(
          `Обмін\\повернення товару з наявності\n\nУ нас є можливість обміну/повернення товару в період 7 днів з моменту замовлення🔄\n\nУмови обміну/повернення:\n\n1️⃣ Товар не носився, він чистий та збережено його товарний вигляд.\n\n2️⃣ Збережено заводську упаковку та всі бірки.\n\n3️⃣ Оплату за доставку обміну/повернення здійснює покупець`,
          {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
              inline_keyboard: [
                [{ text: "◀️ Назад", callback_data: "quick_reply_back" }],
                [{ text: "Меню", callback_data: "quick_reply_menu" }],
              ],
            },
          }
        );
        break;
      case "quick_reply_3":
        bot.editMessageText(
          `Обмін\\повернення товару під замовлення\n\n1️⃣ Ми привезли не той товар що Ви замовляли.\n2️⃣ Ми привезли не той розмір що Ви замовляли.\n3️⃣ Ми привезли товар з браком ( Пляма, пошкодження )\n\nТакож, хочемо пояснити що "під замовлення" означає що ми замовляємо з-за кордону 1 розмір певної моделі спеціально для Вас. Це індивідуальне замовлення. Тому Ви не зможете його повернути якщо Вам модель не сподобається або розмір не підійде.`,
          {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
              inline_keyboard: [
                [{ text: "◀️ Назад", callback_data: "quick_reply_back" }],
                [{ text: "Меню", callback_data: "quick_reply_menu" }],
              ],
            },
          }
        );
        break;
      case "quick_reply_4":
        bot.editMessageText(
          `Термін доставки\n\nДоставка товару з наявності 🇺🇦 відбувається в період 1-3 робочих днів з моменту отримання передоплати🚛\n\nДоставка товару під замовлення 🇨🇳 відбувається в період 10-20 робочих днів✈️`,
          {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
              inline_keyboard: [
                [{ text: "◀️ Назад", callback_data: "quick_reply_back" }],
                [{ text: "Вартість доставки", callback_data: "quick_reply_5" }],
                [{ text: "Меню", callback_data: "quick_reply_menu" }],
              ],
            },
          }
        );
        break;
      case "quick_reply_5":
        bot.editMessageText(
          `Вартість доставки\n\n1 кг — 18$.\nЯкщо замовлення важить менше 0.5 кг, вартість доставки розраховується як за 0.5 кг.`,
          {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
              inline_keyboard: [
                [{ text: "◀️ Назад", callback_data: "quick_reply_back" }],
                [{ text: "Меню", callback_data: "quick_reply_menu" }],
              ],
            },
          }
        );
        break;
      case "quick_reply_6":
        bot.editMessageText(
          `Хочу замовити у Європу\n\nНе проблема! Ми викупляємо товар та відправляємо Вам напряму з Китаю 🇨🇳, який згодом доставляється DHL на вашу адресу.`,
          {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
              inline_keyboard: [
                [{ text: "◀️ Назад", callback_data: "quick_reply_back" }],
                [{ text: "Меню", callback_data: "quick_reply_menu" }],
              ],
            },
          }
        );
        break;
      case "quick_reply_7":
        await bot.answerCallbackQuery(query.id);
        const existingTicket = await Ticket.findOne({
          user_id: chatId,
          status: "open",
        });
        if (existingTicket) {
          await bot.sendMessage(chatId, "У вас вже є активна або не прийнята заявка. Будь ласка, дочекайтеся відповіді менеджера.");
        } else {
          const ticketId = await generateTicketId();
          const ticket = new Ticket({
            ticket_id: ticketId,
            user_id: chatId,
            status: "open",
            accepted: false,
            activeManagerConversation: false,
            messages: [],
          });
          await ticket.save();
          await User.findOneAndUpdate(
            { user_id: chatId },
            { $push: { tickets: ticketId } }
          );
          const user = await User.findOne({ user_id: chatId });
          const greetingName = user ? (user.name || query.from.first_name) : (query.from.first_name || "Клієнт");
          const kyivDate = new Date(
            new Date().toLocaleString("en-US", { timeZone: "Europe/Kiev" })
          );
          const currentHour = kyivDate.getHours();
          if (currentHour >= 21 || currentHour < 9) {
            await bot.sendMessage(
              chatId,
              `Наші менеджери після 21:00 відпочивають🥱 Зачекайте будь ласка до 9:00.`
            );
            await bot.sendMessage(chatId, `✍️ Напишіть, будь ласка, питання і очікуйте підключення менеджера...`);
          } else {
            await bot.sendMessage(
              chatId,
              `Дякуємо, ${greetingName}, очікуйте підключення менеджера 😉`
            );
          }
          const userNameForManager = user
            ? user.name || "Без імені"
            : "Без імені";
          const userUsernameForManager =
            query.from.username || "Без імені користувача";
          await bot.sendMessage(
            process.env.MANAGER_CHAT_ID,
            `Нова заявка ${ticketId} від ${userNameForManager} (@${userUsernameForManager}). Підтвердити?`,
            {
              reply_markup: {
                inline_keyboard: [
                  [{ text: "Прийняти", callback_data: `accept_${ticketId}` }],
                ],
              },
            }
          );
        }
        await bot
          .deleteMessage(chatId, messageId)
          .catch((e) =>
            console.error("Failed to delete quick replies message:", e.message)
          );
        break;
      case "quick_reply_back":
        await bot.editMessageText("Виберіть питання:", {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: quickRepliesKeyboard(),
        });
        break;
      case "quick_reply_menu":
        await bot.answerCallbackQuery(query.id);
        await bot
          .deleteMessage(chatId, messageId)
          .catch((e) =>
            console.error("Failed to delete quick replies message:", e.message)
          );
        await bot.sendMessage(chatId, "🏡 ГОЛОВНЕ МЕНЮ.", {
          reply_markup: mainMenuKeyboard(),
        });
        break;
      default:
        console.log(`[CALLBACK_QUERY] Unknown quick reply: ${data}`);
        bot.answerCallbackQuery(query.id);
        break;
    }
    if (!["quick_reply_7", "quick_reply_menu", "quick_reply_back"].includes(data)) {
      await bot.answerCallbackQuery(query.id);
    } else if (data === "quick_reply_back"){
      await bot.answerCallbackQuery(query.id);
    }
    return;
  }

  if (data.startsWith("accept_") && isManager) {
    console.log(`[CALLBACK_QUERY] Manager trying to accept/switch ticket: ${data}`);
    const ticketId = data.split("_")[1];
    const ticket = await Ticket.findOne({ ticket_id: ticketId });

    if (ticket) {
      if (ticket.status === 'closed') {
         await bot.answerCallbackQuery(query.id, { text: `Заявка ${ticketId} вже закрита.`, show_alert: true });
         return bot.editMessageText(`Заявка ${ticketId} вже закрита.`, { chat_id: chatId, message_id: messageId, reply_markup: null }).catch(e => console.error("Error editing message for closed ticket:", e));
      }

      await Ticket.updateMany(
        { status: "open", accepted: true, activeManagerConversation: true, _id: { $ne: ticket._id } },
        { $set: { activeManagerConversation: false } }
      );

      const firstTimeAcceptance = !ticket.accepted;
      ticket.accepted = true;
      ticket.activeManagerConversation = true;
      ticket.lastMessageAt = new Date();
      await ticket.save();

      await bot.answerCallbackQuery(query.id, {
        text: firstTimeAcceptance ? `Заявку ${ticketId} прийнято` : `Переключено на заявку ${ticketId}`,
      });

      const userClient = await User.findOne({ user_id: ticket.user_id });
      const clientName = userClient ? userClient.name : null;
      const clientUsername = userClient ? userClient.username : null;
      let clientDisplayName = `ID ${ticket.user_id}`;
      if (clientName && clientUsername) {
        clientDisplayName = `${clientName} (@${clientUsername})`;
      } else if (clientName) {
        clientDisplayName = `${clientName} (ID: ${ticket.user_id})`;
      } else if (clientUsername) {
        clientDisplayName = `@${clientUsername} (ID: ${ticket.user_id})`;
      }


      const messageForManager = firstTimeAcceptance
        ? `Заявка ${ticketId} від ${clientDisplayName} прийнята. Напишіть повідомлення клієнту.`
        : `Ви переключились на заявку ${ticketId} (${clientDisplayName}). Напишіть повідомлення клієнту.`;

      await bot.editMessageText(
        messageForManager,
        {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: {
            inline_keyboard: [
              [{ text: "Завершити листування", callback_data: `close_${ticketId}_manager` }],
            ],
          },
        }
      ).catch(e => console.error("Error editing manager message on accept:", e));

      if (firstTimeAcceptance) {
        try {
          await bot.sendMessage(
            ticket.user_id,
            `✅ В чат підключився менеджер prudbaydelivery ®`,
            {
              reply_markup: {
                keyboard: [["📤 Вийти і завершити чат"]],
                resize_keyboard: true,
                one_time_keyboard: false,
              },
            }
          );
        } catch (sendError) {
          console.error(
            `[CALLBACK_QUERY] Failed to send 'manager connected' message to user ${ticket.user_id}:`,
            sendError.message
          );
           if (sendError.response && sendError.response.statusCode === 403) {
             bot.sendMessage(chatId, `Не вдалося надіслати повідомлення клієнту ${clientDisplayName} (можливо, бот заблокований). Заявка ${ticketId} прийнята.`);
           }
        }

        if (ticket.messages.length > 0) {
          const userMessages = ticket.messages.filter((msg) => msg.from === "user");
          if (userMessages.length > 0) {
            let messagesText = `Повідомлення від ${clientDisplayName} (заявка ${ticketId}):\n`;
            userMessages.forEach((msg) => {
              const msgDate = new Date(msg.timestamp);
              const msgTime = `${msgDate.getHours()}:${msgDate.getMinutes().toString().padStart(2, "0")}`;
              messagesText += `(${msgTime}): ${msg.text}\n`;
            });
            await bot.sendMessage(process.env.MANAGER_CHAT_ID, messagesText).catch(e => console.error("Error sending pending messages to manager:", e));
          }
        }
      }
    } else {
      console.error(`[CALLBACK_QUERY] Ticket ${ticketId} not found for acceptance.`);
      await bot.answerCallbackQuery(query.id, { text: "Заявку не знайдено", show_alert: true });
      await bot.deleteMessage(chatId, messageId).catch((e) => console.error("Failed to delete msg for non-existent ticket:", e.message));
    }
    return;
  }


  if (data.startsWith("close_")) {
    console.log(`[CALLBACK_QUERY] Attempting to close ticket: ${data}`);
    const [_, ticketId, role] = data.split("_");
    const ticket = await Ticket.findOne({ ticket_id: ticketId });

    if (!ticket) {
      console.error(`[CALLBACK_QUERY] Ticket ${ticketId} not found for closing.`);
      bot.answerCallbackQuery(query.id, { text: "Заявку не знайдено" });
      if (isManager) {
        bot.editMessageText("Заявку не знайдено.", {chat_id: chatId, message_id: messageId, reply_markup: null}).catch(e => {});
      }
      return;
    }

    if (ticket.status === "closed") {
      console.log(`[CALLBACK_QUERY] Ticket ${ticketId} is already closed.`);
      bot.answerCallbackQuery(query.id, { text: `Заявка ${ticketId} вже закрита` });
      if (role === "manager") {
        bot.editMessageText(`Заявка ${ticketId} вже закрита.`, {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: null,
        }).catch(e => {});
      }
      return;
    }

    ticket.status = "closed";
    ticket.activeManagerConversation = false;
    await ticket.save();
    console.log(`[CALLBACK_QUERY] Ticket ${ticketId} closed by ${role || "user callback"}.`);
    bot.answerCallbackQuery(query.id, { text: `Заявку ${ticketId} закрито` });

    if (role === "manager") {
      try {
        await bot.sendMessage(
          ticket.user_id,
          `🧑🏻‍💻 Менеджер завершив листування.\nЯкщо у Вас ще залишились питання або потрібна допомога — Ви завжди можете розпочати новий чат за допомогою меню 😊`,
          { reply_markup: mainMenuKeyboard() }
        );
      } catch (sendError) {
        console.error(
          `[CALLBACK_QUERY] Failed to send 'ticket closed by manager' msg to user ${ticket.user_id}:`,
          sendError.message
        );
      }
      const userClient = await User.findOne({ user_id: ticket.user_id });
      const clientName = userClient ? userClient.name : null;
      const clientUsername = userClient ? userClient.username : null;
      let clientDisplayName = `ID ${ticket.user_id}`;
      if (clientName && clientUsername) {
        clientDisplayName = `${clientName} (@${clientUsername})`;
      } else if (clientName) {
        clientDisplayName = `${clientName} (ID: ${ticket.user_id})`;
      } else if (clientUsername) {
        clientDisplayName = `@${clientUsername} (ID: ${ticket.user_id})`;
      }

      await bot.editMessageText(`Листування по заявці ${ticketId} з клієнтом ${clientDisplayName} завершено.`, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: null,
      }).catch(e => console.error("Error editing manager message on close:", e));
    } else {
      const user = await User.findOne({ user_id: ticket.user_id });
      const userName = user ? (user.name || query.from.first_name) : (query.from.first_name || "Без імені");
      const userUsername = user ? (user.username || query.from.username) : (query.from.username || "N/A");
      await bot.sendMessage(
        process.env.MANAGER_CHAT_ID,
        `Клієнт ${userName} (@${userUsername}) закрив заявку ${ticketId} через callback.`,
      );
       await bot.editMessageText(`🔒 Ваше звернення ${ticketId} закрито.`, {
          chat_id: chatId, 
          message_id: messageId,
          reply_markup: null,
        }).catch(e => {});
        await bot.sendMessage(chatId, `🏡 ГОЛОВНЕ МЕНЮ.`, { 
            reply_markup: mainMenuKeyboard()
        });
    }
    return;
  }

  if (data.startsWith("view_tickets_") && isManager) {
    console.log(`[CALLBACK_QUERY] Manager viewing tickets history: ${data}`);
    const parts = data.split("_");
    const type = parts[2];
    const page = parseInt(parts[3], 10);
    bot.answerCallbackQuery(query.id);
    await showTicketsHistory(bot, chatId, type, page, messageId);
    return;
  }
  if (data.startsWith("details_") && isManager) {
    console.log(`[CALLBACK_QUERY] Manager viewing ticket details: ${data}`);
    const ticketId = data.split("_")[1];
    bot.answerCallbackQuery(query.id);
    await showTicketDetails(bot, chatId, ticketId, messageId);
    return;
  }
  if (data === "back_to_ticket_options" && isManager) {
    console.log(`[CALLBACK_QUERY] Manager going back to ticket type options.`);
    bot.answerCallbackQuery(query.id);
    bot.editMessageText("Виберіть тип заявок для перегляду:", {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: {
        inline_keyboard: [
          [{ text: "Всі заявки", callback_data: "view_tickets_all_1" }],
          [{ text: "Відкриті заявки", callback_data: "view_tickets_open_1" }],
          [{ text: "Закриті заявки", callback_data: "view_tickets_closed_1" }],
        ],
      },
    });
    return;
  }
  if (data === "back_to_ticket_list" && isManager) {
    console.log(
      `[CALLBACK_QUERY] Manager going back to ticket list.`
    );
    let type = "all"; 
    if (query.message.text && query.message.text.includes("Відкриті заявки")) type = "open";
    else if (query.message.text && query.message.text.includes("Закриті заявки")) type = "closed";

    bot.answerCallbackQuery(query.id);
    await showTicketsHistory(bot, chatId, type, 1, messageId);
    return;
  }

  if (data.startsWith("stage_status_") || data.startsWith("status_question_")) {
    console.log(`[CALLBACK_QUERY] Client asking status/stage question: ${data}`);
    if (isManager) return bot.answerCallbackQuery(query.id);

    let responseText = "";
    let questionKey = data;
    if (data.startsWith("stage_status_")) { 
        questionKey = "status_question_" + data.split("_")[2];
    }

    switch (questionKey) {
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
        responseText = "Доставка оплачується протягом 4-х днів з моменту формування посилки, у випадку запізнення - посилка затримується у Німеччині, подальша доставка не можлива.";
        break;
      case "status_question_6":
        responseText = "Посилки відправляються кожного дня до 19:00, після відправлення Вам надійте ТТН на ваш обліковий запис Нової Пошти.";
        break;
      default:
        responseText = "Невідоме питання. Спробуйте ще раз або зверніться до менеджера.";
        console.warn("[CALLBACK_QUERY] Unhandled status/stage question type:", data);
        break;
    }
    await bot.editMessageText(responseText, {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: {
        inline_keyboard: [[{ text: "◀️ Назад", callback_data: "status_back" }]], 
      },
    });
    bot.answerCallbackQuery(query.id);
    return;
  }

  if (data === "stage_back" || data === "status_back") {
    console.log(`[CALLBACK_QUERY] Client going back to order status view (via ${data}).`);
    if (isManager) return bot.answerCallbackQuery(query.id);
    const user = await User.findOne({ user_id: chatId });
    if (!user || !user.username) {
      await bot.editMessageText(
        "Не вдалося отримати статус. Перевірте юзернейм або зверніться до менеджера.",
        { chat_id: chatId, message_id: messageId, reply_markup: null }
      );
      return bot.answerCallbackQuery(query.id);
    }
    const orders = await Order.find({ username: user.username }).sort({
      createdAt: -1,
    });
    if (!orders || orders.length === 0) {
      await bot.editMessageText("Замовлень для @" + user.username + " ще немає, зверніться до менеджера для його створення.", {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: null,
      });
      return bot.answerCallbackQuery(query.id);
    }
    const latestOrder = orders[0];
    const status = latestOrder.status || "Замовлення створено";
    const orderIdToDisplay = latestOrder.orderId || "Невідомий";
    let responseText = `Ваше останнє замовлення ID: ${orderIdToDisplay}\nСтатус: ${status}`;
    let inlineKeyboard = [];

    switch (status) {
      case "Замовлення прийнято та на етапі купівлі ✅":
        inlineKeyboard = [[{ text: "Коли я можу дізнатися новий статус?", callback_data: "status_question_1" }]];
        break;
      case "Товар викуплено та відправлено на склад в Китаї ✅":
        inlineKeyboard = [[{ text: "Коли товар прибуде на склад?", callback_data: "status_question_2" }]];
        break;
      case "Товар прибув на склад та готується до перевірки ✅":
        inlineKeyboard = [[{ text: "Коли я можу отримати фото-звіт?", callback_data: "status_question_3" }]];
        break;
      case "Фотозвіт готовий.":
           inlineKeyboard = [[{ text: "Все підходить ✅", callback_data: `confirm_photos_${latestOrder.orderId}` }]];
           responseText += "\nОчікуємо на ваше підтвердження фотозвіту.";
           break;
      case "Посилка успішно скомплектована та готується до відправки ✅":
        responseText += `\nВартість доставки: ${latestOrder.deliveryPrice != null ? latestOrder.deliveryPrice + ' грн' : "Очікуйте"} грн.`;
        inlineKeyboard = [[{ text: "Скільки часу у мене є на оплату доставки?", callback_data: "status_question_5" }]];
        break;
      case "Посилка прибула до України та готується до відправлення ✅":
        inlineKeyboard = [[{ text: "Коли я можу очікувати відправлення?", callback_data: "status_question_6" }]];
        break;
    }

    await bot.editMessageText(responseText, {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: inlineKeyboard },
    });
    bot.answerCallbackQuery(query.id);
    return;
  }

  if (data === "show_active_tickets_inline" && isManager) {
    bot.answerCallbackQuery(query.id);
    const activeTickets = await Ticket.find({ status: 'open' }).sort({ created_at: 1 });
    if (activeTickets.length === 0) {
        return bot.editMessageText("Немає активних заявок.", { chat_id: chatId, message_id: messageId, reply_markup: null });
    }
    const ticketButtonsPromises = activeTickets.map(async (ticket) => {
        const userTicket = await User.findOne({ user_id: ticket.user_id });
        const userName = userTicket ? (userTicket.name || userTicket.username || `ID:${ticket.user_id}`) : 'Невідомий';
        const statusIndicator = ticket.accepted ? (ticket.activeManagerConversation ? '🔷' : '✅') : '🆕';
        const buttonText = `${statusIndicator} ${ticket.ticket_id} (${userName})`;
        return [{ text: buttonText, callback_data: `accept_${ticket.ticket_id}` }];
    });
    const ticketButtons = await Promise.all(ticketButtonsPromises);
    return bot.editMessageText("Активні заявки (🆕-нова, ✅-прийнята, 🔷-активна розмова):", { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: ticketButtons } });
  }

  
  if (data === 'pc_status') {
    bot.answerCallbackQuery(query.id);
    return showOrderStatus(bot, chatId, messageId);
  }
  if (data === 'pc_change_address') {
    bot.answerCallbackQuery(query.id);
    addressChangeState[chatId] = { step: 'awaiting_fullname', data: {} };
    return bot.editMessageText("🔄 Оновлення адреси доставки\n\nВведіть Ваші Прізвище, Ім'я, По-Батькові:", {
        chat_id: chatId, message_id: messageId,
        reply_markup: { inline_keyboard: [[{ text: '❌ Скасувати', callback_data: 'cancel_address_change' }]] }
    });
  }
  if (data === 'pc_how_to_get_bonuses') {
    return bot.answerCallbackQuery(query.id, { text: "Бонуси додаються на ваш рахунок після завершення замовлення.", show_alert: true });
  }
  if (data === 'pc_exchange_bonuses') {
    const user = await User.findOne({ user_id: chatId });
    if (!await Order.findOne({ username: user.username })) {
        return bot.answerCallbackQuery(query.id, { text: "Ви ще не оформили жодного замовлення.", show_alert: true });
    }
    return bot.answerCallbackQuery(query.id, { text: `Ваш баланс: ${user.bonusBalance || 0} балів. Функціонал обміну в розробці.`, show_alert: true });
  }
  if (data === 'pc_back_to_main') {
    bot.answerCallbackQuery(query.id);
    await bot.deleteMessage(chatId, messageId).catch(()=>{});
    const user = await User.findOne({user_id: chatId});
    return sendMainMenu(bot, chatId, user.name);
  }
  if (data === 'cancel_address_change') {
    bot.answerCallbackQuery(query.id, { text: 'Зміну адреси скасовано.' });
    delete addressChangeState[chatId];
    return bot.editMessageText('Зміну адреси скасовано.', { chat_id: chatId, message_id: messageId });
  }

  
  if (isManager) {
    if (data === 'send_msg_specific') {
      bot.answerCallbackQuery(query.id);
      directMessageState[chatId] = { step: 1 }; // чекаємо на пошуковий запит
      return bot.editMessageText("Введіть ID замовлення, @username, номер телефону або імʼя клієнта, якому потрібно написати:", { chat_id: chatId, message_id: messageId });
    }
    if (data === 'send_msg_broadcast') {
      bot.answerCallbackQuery(query.id);
      broadcastState[chatId] = { step: 1 };
      return bot.editMessageText("Введіть текст для загальної розсилки всім користувачам:", { chat_id: chatId, message_id: messageId });
    }
    if (data.startsWith('mgr_message_client_')) {
      const targetUserId = data.split('_').pop();
      directMessageState[chatId] = { step: 2, userId: targetUserId };
      bot.answerCallbackQuery(query.id);
      return bot.editMessageText('Введіть текст повідомлення для клієнта:', { chat_id: chatId, message_id: messageId });
    }
    if (data.startsWith('mgr_exchange_bonus_')) {
      const targetUserId = data.split('_').pop();
      const user = await User.findOne({ user_id: targetUserId });
      return bot.answerCallbackQuery(query.id, { 
        text: `Функціонал обміну бонусів для клієнта @${user.username} в розробці. Поточний баланс: ${user.bonusBalance || 0} балів.`, 
        show_alert: true 
      });
    }
    if (data.startsWith('mgr_give_bonus_')) {
      const targetUserId = data.split('_').pop();
      bonusChangeState[chatId] = { step: 1, userId: targetUserId };
      bot.answerCallbackQuery(query.id);
      return bot.editMessageText('Введіть кількість бонусних балів для нарахування:', { chat_id: chatId, message_id: messageId });
    }
  }

  
  if (isManager && data.startsWith('status_comp_')) {
    const orderId = data.split('_').pop();
    photoUploadState[chatId] = { orderId, awaitingPrice: true };
    bot.answerCallbackQuery(query.id);
    return bot.editMessageText(`Введіть вартість доставки для ID: ${orderId}:`, { chat_id: chatId, message_id: messageId });
  }

  if (data.startsWith('get_payment_')) {
    const orderId = data.split('_').pop();
    const paymentDetails = "Отримувач:\nФОП Витвицька Христина Володимирівна\n\nIBAN:\n`UA143220010000026002350062199`\n\nІПН/ЄДРПОУ:\n`3543609308`\n\n❗️ Призначення: Оплата за доставку: " + orderId;
    bot.answerCallbackQuery(query.id);
    return bot.sendMessage(chatId, paymentDetails, { parse_mode: 'Markdown' });
  }

  if (data.startsWith('i_have_paid_')) {
    const orderId = data.split('_').pop();
    receiptUploadState[chatId] = { awaiting: true, orderId };
    bot.answerCallbackQuery(query.id);
    return bot.sendMessage(chatId, "Чудово! Тепер надішліть квитанцію у форматі фото або PDF.");
  }
  
  if (isManager && data.startsWith('status_shipped_')) {
      const orderId = data.split('_').pop();
      shippingInfoState[chatId] = { step: 1, orderId };
      bot.answerCallbackQuery(query.id);
      return bot.editMessageText('Введіть дату відправлення (наприклад, 22.05.2025):', { chat_id: chatId, message_id: messageId });
  }

  if (isManager && data.startsWith('status_paid_')) {
    const orderId = data.split('_').pop();
    const order = await Order.findOneAndUpdate({ orderId }, { status: 'Доставка оплачена ✅' }, { new: true });
    const user = await User.findOne({ username: order.username });
    if(user) await bot.sendMessage(user.user_id, `**Оплату отримано!** ✅\n\nДякуємо — доставка успішно оплачена. Найближчим часом ви отримаєте оновлення щодо статусу замовлення.`);
    bot.answerCallbackQuery(query.id, { text: 'Статус оновлено' });
    return bot.editMessageText('Статус оновлено на "Доставка оплачена ✅".', { chat_id: chatId, message_id: messageId });
  }

  if (isManager && data.startsWith('status_feedback_')) {
    const orderId = data.split('_').pop();
    const order = await Order.findOneAndUpdate({ orderId }, { status: 'Відгук ❤️' }, { new: true });
    const user = await User.findOne({ username: order.username });
    if(user) await bot.sendMessage(user.user_id, `Ваше замовлення успішно доставлено! ❤️\n\nНам буде дуже приємно, якщо ви поділитесь своїми враженнями 📝\n\nЗалиште, будь ласка, короткий відгук — це дуже допомагає нам ставати кращими та дарує натхнення працювати для вас далі! 🌟\n\nЯкщо хочете, можете прикріпити фото — ми будемо раді, і навіть подаруємо Вам знижку на наступне замовлення! 🤗`, {
      reply_markup: { inline_keyboard: [[{ text: 'Залишити відгук', url: 'https://t.me/prudbaymanager' }]] }
    });
    bot.answerCallbackQuery(query.id, { text: 'Статус оновлено' });
    return bot.editMessageText('Статус оновлено на "Відгук ❤️".', { chat_id: chatId, message_id: messageId });
  }

  if (data.startsWith("set_status_") && isManager) {
    bot.answerCallbackQuery(query.id);
    const parts = data.split("_"); const orderId = parts[2]; const statusIndex = parts[3]; const action = parts[4];
    console.log(`[CALLBACK_QUERY] Setting status for Order ID: ${orderId}, Index: ${statusIndex}, Action: ${action}`);
    const order = await Order.findOne({ orderId });
    if (!order) { console.error(`Order not found: ${orderId}`); return; }

    let statusMessage = ""; let notifyClient = true;
    switch (statusIndex) { 
      case "1": statusMessage = "Замовлення прийнято та на етапі купівлі ✅"; break; 
      case "2": statusMessage = "Товар викуплено та відправлено на склад в Китаї ✅"; break; 
      case "3": statusMessage = "Товар прибув на склад та готується до перевірки ✅"; break; 
      case "4": 
        if (action === "photo") { 
          const user = await User.findOne({ username: order.username }); 
          if (!user) { console.error(`Client user @${order.username} not found`); return; } 
          photoUploadState[chatId] = { orderId, clientId: user.user_id, photos: [], awaitingPrice: false }; 
          console.log(`Initiating photo upload state for ${orderId}`); 
          return bot.editMessageText("Надішліть фото. Потім 'Надіслати всі фото'.", { 
            chat_id: chatId, 
            message_id: messageId, 
            reply_markup: { 
              inline_keyboard: [
                [{ text: "📤 Надіслати всі фото", callback_data: "send_all_photos" }], 
                [{ text: "❌ Скасувати", callback_data: `cancel_photo_upload_${orderId}` }]
              ] 
            } 
          }); 
        } 
        notifyClient = false; 
        break; 
      case "5": 
        if (action === "confirm") { 
          statusMessage = "Фотозвіт підтверджено клієнтом 👍"; 
        } else { 
          console.warn(`Unknown action ${action} for status 5.`); 
          notifyClient = false; 
        } 
        break; 
      case "6": 
        if (action === "pack") { 
          photoUploadState[chatId] = { orderId, clientId: null, photos: [], awaitingPrice: true }; 
          const user = await User.findOne({ username: order.username }); 
          if (user) photoUploadState[chatId].clientId = user.user_id; 
          console.log(`Requesting delivery price for ${orderId}`); 
          notifyClient = false; 
          return bot.editMessageText(`Введіть вартість доставки для ID: ${orderId} (@${order.username})`, { 
            chat_id: chatId, 
            message_id: messageId 
          }); 
        } else { 
          console.warn(`Unknown action ${action} for status 6.`); 
          notifyClient = false; 
        } 
        break; 
      case "7": statusMessage = "Посилка прибула до України та готується до відправлення ✅"; break; 
      case "8": 
        if (action === "sent") { 
          statusMessage = "Посилка відправлена клієнту ✅"; 
        } else { 
          console.warn(`Unknown action ${action} for status 8.`); 
          notifyClient = false; 
        } 
        break; 
      default: console.error(`Unknown status index: ${statusIndex}`); return; 
    }

    if (statusMessage) {
      try {
        order.status = statusMessage;
        await order.save();
        console.log(`Order ${orderId} status updated: ${statusMessage}`);
        updateOrderInAirtable(order.orderId, statusMessage, order.productName);

        await bot.editMessageText(
          `Статус замовлення ID: ${orderId} (@${order.username}) оновлено на:\n${statusMessage}`,
          {
            chat_id: chatId, message_id: messageId,
            reply_markup: { inline_keyboard: [ [{ text: "📊 Змінити статус ще раз", callback_data: `change_status_${order.orderId}` }], [{ text: "◀️ Назад до списку", callback_data: "back_to_order_list" }] ] }
          }
        );

        if (notifyClient) {
          const user = await User.findOne({ username: order.username });
          if (user) {
            try {
              let message = `Статус Вашого замовлення ID: ${orderId} оновлено:\n${statusMessage}`;
              if (statusIndex === "8" && action === "sent") { message += "\nОчікуйте на номер ТТН."; }
              await bot.sendMessage(user.user_id, message);
              console.log(`Client @${order.username} notified.`);
            } catch (clientNotifyError) { console.error(`Failed to notify client @${order.username}:`, clientNotifyError.message); }
          } else { console.error(`Client user @${order.username} not found.`); }
        }
      } catch (updateError) { console.error(`Error updating status/msg for Order ${orderId}:`, updateError); bot.sendMessage(chatId, `Помилка оновлення статусу ID: ${orderId}`).catch(()=>{}); }
    } else if (notifyClient === false && statusIndex !== '4' && statusIndex !== '6') {
      await bot.editMessageText(`Дія для статусу ${statusIndex} оброблена.`, { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [[{ text: "◀️ Назад до списку", callback_data: "back_to_order_list" }]] } });
    }
    return;
  }

  if (data === "back_to_cabinet") {
    bot.answerCallbackQuery(query.id);
    await require("./messages").showPersonalCabinet(bot, chatId);
    return;
  }

  if (data.startsWith("confirm_delivery_payment_")) {
    bot.answerCallbackQuery(query.id, { text: "Клієнту надіслано підтвердження!" });
    const orderId = data.replace("confirm_delivery_payment_", "");
    const order = await Order.findOne({ orderId });
    if (!order) return bot.sendMessage(chatId, "Замовлення не знайдено.");
    const user = await User.findOne({ username: order.username });
    if (user) {
      await bot.sendMessage(user.user_id, "Ми успішно отримали оплату, дякуємо ❤️");
    }
    
    return;
  }

  console.log(
    `[CALLBACK_QUERY] Unhandled callback data: ${data} by User ID: ${userId} in message ID: ${messageId}`
  );
  bot
    .answerCallbackQuery(query.id, {text: "Дія не визначена або вже оброблена."})
    .catch((err) =>
      console.error("Error answering unhandled callback query:", err.message)
    );
}

module.exports = callbackQueryHandler;