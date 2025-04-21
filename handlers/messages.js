const { mainMenuKeyboard, quickRepliesKeyboard, stagesKeyboard } = require('../utils/keyboards');
const User = require('../models/User');
const Ticket = require('../models/Ticket');
const Order = require('../models/Order');
const Counter = require('../models/Counter');
const { showManagerOrdersList } = require('../commands/start');
const { addOrderToAirtable, updateOrderInAirtable } = require('../utils/airtable');

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
  const userId = msg.from.id;

  if (text.startsWith('/') || (msg.entities && msg.entities.some(e => e.type === 'bot_command'))) {
      return;
  }

  const isManager = userId.toString() === process.env.MANAGER_CHAT_ID;

  if (isManager && photoUploadState[chatId] && photoUploadState[chatId].awaitingPrice) {
    const orderId = photoUploadState[chatId].orderId;

    if (isNaN(text)) {
      return bot.sendMessage(chatId, "Будь ласка, введіть коректну вартість доставки (число).");
    }

    const price = parseFloat(text);
    const order = await Order.findOne({ orderId });

    if (!order) {
      delete photoUploadState[chatId];
      return bot.sendMessage(chatId, "Замовлення не знайдено.");
    }

    order.deliveryPrice = price;
    order.status = "Посилка успішно скомплектована та готується до відправки ✅";
    await order.save();

    delete photoUploadState[chatId];

    const user = await User.findOne({ username: order.username });
    if (user) {
      await bot.sendMessage(user.user_id, `Ваше замовлення ID: ${orderId} успішно скомплектовано.\nВартість доставки: ${price} грн.\nБудь ласка, зв'яжіться з менеджером, для уточнення реквізитів. Використовуйте '🙇‍♂️ Зв'язок з менеджером'.`);
    }

    return bot.sendMessage(chatId, `Вартість доставки для замовлення ID: ${orderId} встановлено: ${price} грн. Повідомлення клієнту надіслано.`);
  }

  if (text === "Оформити замовлення" && isManager) {
    orderData[chatId] = { step: 0, data: {} };
    const fields = ["username", "fullName", "phoneNumber", "productName", "city", "novaPost", "orderId"];
    const questions = [
      "Введіть @юзернейм клієнта: (без @)",
      "Введіть Прізвище, Ім'я, По-Батькові клієнта:",
      "Введіть номер телефону клієнта (формат +380xxxxxxxxx) або 'Так', щоб використати номер з бази:",
      "Введіть назву товару:",
      "Введіть місто-отримувача:",
      "Введіть номер відділення Нової Пошти:",
      "Введіть ID замовлення:"
    ];
    return bot.sendMessage(chatId, questions[0], {
      reply_markup: {
        inline_keyboard: [
          [{ text: "Відмінити оформлення", callback_data: "cancel_order" }]
        ]
      }
    });
  }

  if (orderData[chatId] && isManager) {
    const currentStep = orderData[chatId].step;
    const fields = ["username", "fullName", "phoneNumber", "productName", "city", "novaPost", "orderId"];
    const questions = [
      "Введіть @юзернейм клієнта: (без @)",
      "Введіть Прізвище, Ім'я, По-Батькові клієнта:",
      "Введіть номер телефону клієнта (формат +380xxxxxxxxx) або 'Так', щоб використати номер з бази:",
      "Введіть назву товару:",
      "Введіть місто-отримувача:",
      "Введіть номер відділення Нової Пошти:",
      "Введіть ID замовлення:"
    ];

    if (text === "Відмінити оформлення") {
      delete orderData[chatId];
      return bot.sendMessage(chatId, "Оформлення замовлення скасовано.");
    }

    if (currentStep < fields.length) {
      const field = fields[currentStep];

      if (field === "phoneNumber") {
        if (text.toLowerCase() === "так") {
          const clientUsername = orderData[chatId].data.username;
          if (!clientUsername) {
             delete orderData[chatId];
             return bot.sendMessage(chatId, "Помилка: юзернейм клієнта не вказано на попередньому кроці. Оформлення скасовано.");
          }
          const clientUser = await User.findOne({ username: clientUsername });
          if (clientUser && clientUser.phone_number) {
            orderData[chatId].data.phoneNumber = clientUser.phone_number;
          } else {
             orderData[chatId].step--;
            return bot.sendMessage(chatId, "Номер телефону не знайдено в базі або ви не ввели 'Так'. Введіть номер телефону (формат +380xxxxxxxxx):");
          }
        } else {
           if (!text.match(/^\+380\d{9}$/)) {
             return bot.sendMessage(chatId, "Невірний формат номеру. Номер телефону повинен починатися з +380 і містити 9 цифр після. Спробуйте ще раз:");
           }
           orderData[chatId].data.phoneNumber = text;
        }
      } else {
        orderData[chatId].data[field] = text;
      }

      orderData[chatId].step++;

      if (orderData[chatId].step < fields.length) {
        let nextQuestion = questions[orderData[chatId].step];
        return bot.sendMessage(chatId, nextQuestion, {
          reply_markup: {
            inline_keyboard: [
              [{ text: "Відмінити оформлення", callback_data: "cancel_order" }]
            ]
          }
        });
      } else {
        const orderDetails = { ...orderData[chatId].data };
        if (orderDetails.npDepartment) {
            orderDetails.novaPost = orderDetails.npDepartment;
            delete orderDetails.npDepartment;
        }

        const newOrder = new Order(orderDetails);
        await newOrder.save();
        addOrderToAirtable(newOrder)

        const savedOrderId = newOrder.orderId;
        const clientUsername = newOrder.username;

        delete orderData[chatId];

        bot.sendMessage(chatId, `Замовлення ID: ${savedOrderId} успішно оформлено!`);

        const clientUser = await User.findOne({ username: clientUsername });
        if (clientUser) {
          return bot.sendMessage(clientUser.user_id, `Ваше замовлення успішно оформлено! ID замовлення: ${savedOrderId}`);
        } else {
          return bot.sendMessage(chatId, `Клієнта @${clientUsername} не знайдено в базі. Повідомлення про замовлення не надіслано.`);
        }
      }
    }
    return;
  }


  if (photoUploadState[chatId] && text !== "📤 Надіслати всі фото") return;

  if (!isManager) {
    const user = await User.findOne({ user_id: chatId });

    if (!user && text) {
        console.log(`Ignoring message from unknown user ID: ${chatId}`);
        return;
    }
    if (user && !text && !msg.photo && !msg.document && !msg.sticker && !msg.video && !msg.forward_from_chat) {
        return;
    }

    if (user && !user.name && user.phone_number && text) {
      user.name = text;
      await user.save();

      return bot.sendMessage(chatId, `Дякуємо, ${text}! Ваші дані збережено.`, {
        reply_markup: mainMenuKeyboard()
      });
    }

    if (text === "🙇‍♂️ Зв'язок з менеджером") {
        if (!user) return;
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
      const greetingName = user.name || "Без імені";
      if (currentHour >= 21 || currentHour < 9) {
        bot.sendMessage(chatId, `Наші менеджери після 21:00 відпочивають🥱 Зачекайте будь ласка до 9:00.`);
        bot.sendMessage(chatId, `✍️ Напишіть, будь ласка, питання і очікуйте підключення менеджера...`);
      } else {
        bot.sendMessage(chatId, `Дякуємо, ${greetingName}, очікуйте підключення менеджера 😉`);
      }

      const userNameForManager = user.name || "Без імені";
      const userUsernameForManager = msg.chat.username || "Без імені користувача";

      bot.sendMessage(process.env.MANAGER_CHAT_ID, `Нова заявка ${ticketId} від ${userNameForManager} (@${userUsernameForManager}). Підтвердити та почати листування?`, {
        reply_markup: {
          inline_keyboard: [[{ text: "Прийняти", callback_data: `accept_${ticketId}` }]]
        }
      });
      return;
    }

    if (text === "⚡️ Швидкі відповіді") {
      bot.sendMessage(chatId, "Виберіть питання:", {
        reply_markup: quickRepliesKeyboard()
      });
      return;
    }

    if (text === "💚 Статус замовлення") {
      if (!user) {
        bot.sendMessage(chatId, "Користувача не знайдено. Зверніться до менеджера.");
        return;
      }
      if (!user.username) {
          bot.sendMessage(chatId, "Для перевірки статусу замовлення ваш профіль Telegram повинен мати юзернейм (@username). Будь ласка, встановіть його в налаштуваннях Telegram.");
          return;
      }

      const orders = await Order.find({ username: user.username }).sort({ createdAt: -1 });

      if (!orders || orders.length === 0) {
        bot.sendMessage(chatId, "Замовлень для @"+ user.username + " ще немає, зверніться до менеджера для його створення.");
        return;
      }

      const latestOrder = orders[0];
      const status = latestOrder.status || "Замовлення створено";
      const orderId = latestOrder.orderId || "Невідомий";

      let responseText = `Ваше останнє замовлення ID: ${orderId}\nСтатус: ${status}`;
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

      bot.sendMessage(chatId, responseText, {
        reply_markup: {
          inline_keyboard: inlineKeyboard
        }
      });
      return;
    }


    if (text === "📤 Вийти і завершити чат") {
        if (!user) return;
      const ticket = await Ticket.findOne({ user_id: chatId, status: 'open', accepted: true });

      if (ticket) {
        ticket.status = 'closed';
        ticket.activeManagerConversation = false;
        await ticket.save();

        bot.sendMessage(chatId, `🔒 Ваше звернення закрито.`, {
          reply_markup: mainMenuKeyboard()
        });

        bot.sendMessage(process.env.MANAGER_CHAT_ID, `Клієнт ${user.name || 'Без імені'} закрив заявку ${ticket.ticket_id}.`);
      } else {
        bot.sendMessage(chatId, "У вас немає активних заявок для завершення.");
      }
      return;
    }

    if (user && (text || msg.photo || msg.document || msg.sticker || msg.video || msg.forward_from_chat)) {
        const activeTicket = await Ticket.findOne({
          user_id: chatId,
          status: 'open',
          accepted: true
        });

        const pendingTicket = await Ticket.findOne({
          user_id: chatId,
          status: 'open',
          accepted: false
        });

        let targetTicket = activeTicket || pendingTicket;

        if (targetTicket) {
            let messageContent = '';
            let messageType = '';

            if (msg.text) { messageContent = msg.text; messageType = 'text'; targetTicket.messages.push({ from: 'user', text: messageContent }); }
            else if (msg.photo) { messageContent = msg.photo[msg.photo.length - 1].file_id; messageType = 'photo'; targetTicket.messages.push({ from: 'user', text: 'Фото' }); }
            else if (msg.document) { messageContent = msg.document.file_id; messageType = 'document'; targetTicket.messages.push({ from: 'user', text: 'Документ' }); }
            else if (msg.sticker) { messageContent = msg.sticker.file_id; messageType = 'sticker'; targetTicket.messages.push({ from: 'user', text: 'Стікер' }); }
            else if (msg.video) { messageContent = msg.video.file_id; messageType = 'video'; targetTicket.messages.push({ from: 'user', text: 'Відео' }); }
            else if (msg.forward_from_chat || msg.forward_from) { messageType = 'forward'; targetTicket.messages.push({ from: 'user', text: 'Переслане повідомлення' }); }

            if (messageType) {
                await targetTicket.save();

                if (pendingTicket) {
                    bot.sendMessage(chatId, `Дякуємо, ${user.name || 'Без імені'}, ваше повідомлення додано до заявки ${pendingTicket.ticket_id}. Очікуйте підключення менеджера 😉`);
                }

                const clientName = user.name || 'Без імені';
                const clientUsername = msg.chat.username ? `@${msg.chat.username}` : '(без юзернейму)';
                const caption = `Від ${clientName} (${clientUsername}, ID заявки: ${targetTicket.ticket_id})\n${msg.caption || ''}`;

                 try {
                    switch (messageType) {
                        case 'text': await bot.sendMessage(process.env.MANAGER_CHAT_ID, caption.replace('\n', ':\n') + messageContent); break;
                        case 'photo': await bot.sendPhoto(process.env.MANAGER_CHAT_ID, messageContent, { caption }); break;
                        case 'document': await bot.sendDocument(process.env.MANAGER_CHAT_ID, messageContent, { caption }); break;
                        case 'sticker':
                             await bot.sendMessage(process.env.MANAGER_CHAT_ID, caption.replace('\n', ' ') + '(Стікер)');
                             await bot.sendSticker(process.env.MANAGER_CHAT_ID, messageContent); break;
                        case 'video': await bot.sendVideo(process.env.MANAGER_CHAT_ID, messageContent, { caption }); break;
                        case 'forward':
                             await bot.sendMessage(process.env.MANAGER_CHAT_ID, caption.replace('\n', ' ') + '(Переслане повідомлення)');
                             await bot.forwardMessage(process.env.MANAGER_CHAT_ID, msg.chat.id, msg.message_id); break;
                    }
                 } catch (error) {
                     console.error(`Помилка надсилання повідомлення менеджеру від ${chatId}:`, error);
                 }
            }
        } else {
          if (!(user && !user.name && user.phone_number && text)) {
              bot.sendMessage(chatId, "У вас немає активних або очікуючих заявок. Щоб зв'язатися з менеджером, натисніть '🙇‍♂️ Зв'язок з менеджером'.");
          }
        }
         return;
    }
  }


  if (isManager && !orderData[chatId] && !(photoUploadState[chatId] && photoUploadState[chatId].awaitingPrice)) {
    if (text === "Зміна статусу замовлення") {
      const orders = await Order.find();
      if (orders.length === 0) { return bot.sendMessage(chatId, "Немає замовлень для зміни статусу."); }
      const inlineKeyboard = orders.map(order => [{ text: `ID: ${order.orderId || 'N/A'} @${order.username || 'N/A'}`, callback_data: `change_status_${order.orderId}` }]);
      return bot.sendMessage(chatId, "Виберіть замовлення для зміни статусу:", { reply_markup: { inline_keyboard: inlineKeyboard } });
    }

    if (text === "Показати активні заявки") {
        const activeTickets = await Ticket.find({ status: 'open' });
        if (activeTickets.length === 0) { return bot.sendMessage(process.env.MANAGER_CHAT_ID, "Немає активних заявок."); }
        const ticketButtonsPromises = activeTickets.map(async (ticket) => {
            const userTicket = await User.findOne({ user_id: ticket.user_id });
            const buttonText = `Заявка ${ticket.ticket_id} (${userTicket ? (userTicket.name || userTicket.username || 'ID:' + ticket.user_id) : 'Невідомий'})`;
            return [{ text: buttonText, callback_data: `accept_${ticket.ticket_id}` }];
        });
        const ticketButtons = await Promise.all(ticketButtonsPromises);
        return bot.sendMessage(process.env.MANAGER_CHAT_ID, "Активні заявки:", { reply_markup: { inline_keyboard: ticketButtons } });
    }


    if (text === "Створені замовлення") {
        await showManagerOrdersList(bot, chatId);
        return;
    }


    if (text === "Історія заявок") {
      return bot.sendMessage(chatId, "Виберіть тип заявок для перегляду:", {
        reply_markup: {
          inline_keyboard: [
            [{ text: "Всі заявки", callback_data: "view_tickets_all_1" }],
            [{ text: "Відкриті заявки", callback_data: "view_tickets_open_1" }],
            [{ text: "Закриті заявки", callback_data: "view_tickets_closed_1" }]
          ]
        }
      });
    }

    const managerMenuButtons = ["Оформити замовлення", "Зміна статусу замовлення", "Показати активні заявки", "Створені замовлення", "Історія заявок"];
    if (!managerMenuButtons.includes(text) && (text || msg.photo || msg.document || msg.sticker || msg.video || msg.forward_from_chat)) {
      console.log("Менеджер надіслав повідомлення/файл для пересилки:", text || msg.media_group_id || msg.photo?.[0].file_id || msg.document?.file_id || msg.sticker?.file_id || msg.video?.file_id);

      const activeTicket = await Ticket.findOne({
        status: 'open',
        accepted: true,
        activeManagerConversation: true
      });

      if (!activeTicket) {
        return bot.sendMessage(process.env.MANAGER_CHAT_ID, "Немає активної заявки для відповіді. Виберіть заявку зі списку.", {
            reply_markup: {
                inline_keyboard: [[{ text: "Показати активні заявки", callback_data: "show_active_tickets_inline" }]]
            }
        });
      }

      let messageType = '';
      let messageContent = '';
      let sent = false;

      try {
          if (msg.text) { messageType = 'text'; messageContent = msg.text; activeTicket.messages.push({ from: 'manager', text: messageContent }); await bot.sendMessage(activeTicket.user_id, messageContent); sent = true; }
          else if (msg.photo) { messageType = 'photo'; messageContent = msg.photo[msg.photo.length - 1].file_id; activeTicket.messages.push({ from: 'manager', text: 'Фото' }); await bot.sendPhoto(activeTicket.user_id, messageContent, { caption: msg.caption || '' }); sent = true; }
          else if (msg.document) { messageType = 'document'; messageContent = msg.document.file_id; activeTicket.messages.push({ from: 'manager', text: 'Документ' }); await bot.sendDocument(activeTicket.user_id, messageContent, { caption: msg.caption || '' }); sent = true; }
          else if (msg.sticker) { messageType = 'sticker'; messageContent = msg.sticker.file_id; activeTicket.messages.push({ from: 'manager', text: 'Стікер' }); await bot.sendSticker(activeTicket.user_id, messageContent); sent = true; }
          else if (msg.video) { messageType = 'video'; messageContent = msg.video.file_id; activeTicket.messages.push({ from: 'manager', text: 'Відео' }); await bot.sendVideo(activeTicket.user_id, messageContent, { caption: msg.caption || '' }); sent = true; }
          else if (msg.forward_from_chat || msg.forward_from) { messageType = 'forward'; activeTicket.messages.push({ from: 'manager', text: 'Переслане повідомлення' }); await bot.forwardMessage(activeTicket.user_id, chatId, msg.message_id); sent = true; }

          if (sent) {
             await activeTicket.save();
          } else {
              console.log("Невідомий тип повідомлення від менеджера, не надіслано.");
          }
      } catch (error) {
           console.error(`Помилка надсилання повідомлення клієнту ${activeTicket.user_id}:`, error);
           bot.sendMessage(chatId, `Помилка надсилання повідомлення клієнту ID ${activeTicket.user_id}. Спробуйте ще раз або перевірте, чи бот не заблокований.`)
               .catch(e => console.error("Помилка відправки повідомлення про помилку менеджеру:", e));
      }
    }
  }

  if (text === "📤 Надіслати всі фото" && isManager && photoUploadState[chatId]) {
    if (!photoUploadState[chatId].photos || photoUploadState[chatId].photos.length === 0) {
      return bot.sendMessage(chatId, "Немає фото для надсилання.");
    }

    const session = photoUploadState[chatId];
    if (!session.clientId) {
      delete photoUploadState[chatId];
      return bot.sendMessage(chatId, "Помилка: ID клієнта не знайдено в сесії завантаження. Спробуйте почати надсилання звіту знову.");
    }

    try {
      const mediaGroup = session.photos.map((fileId) => ({ type: "photo", media: fileId }));

      await bot.sendMediaGroup(session.clientId, mediaGroup);
      console.log(`[send_all_photos] Photo report sent to Client ID: ${session.clientId} for Order ID: ${session.orderId}`);

      const order = await Order.findOne({ orderId: session.orderId });
      if (order) {
        order.status = "Фотозвіт готовий.";
        await order.save();
        console.log(`[send_all_photos] Order ID: ${session.orderId} status updated to 'Фотозвіт готовий.'`);
      } else {
          console.warn(`[send_all_photos] Order ${session.orderId} not found to update status.`);
      }

      await bot.sendMessage(session.clientId, "Фотозвіт вашого замовлення готовий!", { parse_mode: 'Markdown' });
      await new Promise(resolve => setTimeout(resolve, 300));
      await bot.sendMessage(session.clientId, "Будь ласка, підтвердіть, що все підходить.\nЯкщо є питання - використовуйте '🙇‍♂️ Зв'язок з менеджером'.", {
        reply_markup: {
          inline_keyboard: [[{ text: "Все підходить ✅", callback_data: `confirm_photos_${session.orderId}` }]]
        }
      });

      bot.sendMessage(chatId, "Фотозвіт успішно надіслано клієнту ✅");

    } catch (error) {
      console.error("[send_all_photos] Error sending photo report:", error);
      bot.sendMessage(chatId, "Не вдалося надіслати фотозвіт клієнту. Перевірте, чи бот не заблокований клієнтом, та спробуйте знову.");
    } finally {
       if (photoUploadState[chatId]) {
           console.log(`[send_all_photos] Clearing photo upload state for Chat ID: ${chatId}`);
           delete photoUploadState[chatId];
       }
    }
    return;
  }
}

module.exports = messagesHandler;