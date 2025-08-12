const { mainMenuKeyboard, quickRepliesKeyboard, stagesKeyboard, personalCabinetKeyboard } = require('../utils/keyboards');
const User = require('../models/User');
const Ticket = require('../models/Ticket');
const Order = require('../models/Order');
const Counter = require('../models/Counter');
const { showManagerOrdersList, sendMainMenu } = require('../commands/start');
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

async function messagesHandler(bot, msg, orderData, photoUploadState, profileViewState, addressChangeState, directMessageState, bonusChangeState, shippingInfoState, receiptUploadState, broadcastState) {
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
      await bot.sendMessage(user.user_id, `Ваше замовлення ID: ${orderId} успішно скомплектовано ✅\nВартість доставки: ${price} грн (Будь ласка, оплатіть доставку протягом 5-ти днів)`, {
        reply_markup: {
          inline_keyboard: [
            [{ text: "Отримати реквізити на оплату", callback_data: `get_payment_${orderId}` }],
            [{ text: "Я оплатив", callback_data: `i_have_paid_${orderId}` }],
            [{ text: "Скільки часу у мене є на оплату доставки?", callback_data: "status_question_5" }]
          ]
        }
      });
    }

    return bot.sendMessage(chatId, `Вартість доставки для замовлення ID: ${orderId} встановлено: ${price} грн. Повідомлення клієнту надіслано.`);
  }

  if (text === "Оформити замовлення" && isManager) {
    return bot.sendMessage(chatId, "Оберіть напрямок доставки для замовлення:", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "В Україну", callback_data: "create_order_ua" }],
          [{ text: "За кордон", callback_data: "create_order_abroad" }],
          [{ text: "❌ Скасувати", callback_data: "cancel_order" }]
        ]
      }
    });
  }

  if (orderData[chatId] && isManager) {
    const state = orderData[chatId];
    const currentStep = state.step;
    const fields = state.fields;
    const questions = state.questions;

    if (currentStep < fields.length) {
      const field = fields[currentStep];

      if (field === "phoneNumber") {
        if (text.toLowerCase() === "так") {
          const clientUsername = state.data.username;
          if (!clientUsername) {
            delete orderData[chatId];
            return bot.sendMessage(chatId, "Помилка: юзернейм клієнта не вказано на попередньому кроці. Оформлення скасовано.");
          }
          const clientUser = await User.findOne({ username: clientUsername });
          if (clientUser && clientUser.phone_number) {
            state.data.phoneNumber = clientUser.phone_number;
          } else {
            return bot.sendMessage(chatId, `Номер телефону для @${clientUsername} не знайдено в базі або ви не ввели 'Так'.\n${questions[currentStep]}`);
          }
        } else {
          const isUA = state.data.direction === 'В Україну';
          const validUa = /^\+380\d{9}$/.test(text);
          const validIntl = /^\+\d{6,15}$/.test(text);
          if ((isUA && !validUa) || (!isUA && !validIntl)) {
            const hint = isUA ? "+380XXXXXXXXX" : "+48..., +33..., +1..., тощо";
            return bot.sendMessage(chatId, `Невірний формат номеру. Введіть у форматі ${hint}.\n${questions[currentStep]}`);
          }
          state.data.phoneNumber = text;
        }
      } else if (field === "region") {
        if (text.toLowerCase() === "пропустити" || text.toLowerCase() === "пропустити" || text === "-") {
          state.data.region = "";
        } else {
          state.data.region = text;
        }
      } else if (field === "totalPrice" || field === "netProfit") {
        const num = parseFloat(text.replace(/,/g, '.'));
        if (isNaN(num)) {
          return bot.sendMessage(chatId, `Будь ласка, введіть числове значення.\n${questions[currentStep]}`);
        }
        state.data[field] = num;
      } else {
        state.data[field] = text;
      }

      state.step++;

      if (state.step < fields.length) {
        let nextQuestion = questions[state.step];
        return bot.sendMessage(chatId, nextQuestion, {
          reply_markup: {
            inline_keyboard: [
              [{ text: "Відмінити оформлення", callback_data: "cancel_order" }]
            ]
          }
        });
      } else {
        const data = { ...state.data };
        const existingOrder = await Order.findOne({ orderId: data.orderId });
        if (existingOrder) {
          await bot.sendMessage(chatId, `❗️ Замовлення з ID: ${data.orderId} вже існує! Оформлення скасовано.`);
          delete orderData[chatId];
          return;
        }
        let orderPayload = {
          username: data.username,
          productName: data.productName,
          orderId: data.orderId,
          totalPrice: data.totalPrice,
          netProfit: data.netProfit,
          direction: data.direction,
        };
        if (data.direction === 'За кордон') {
          Object.assign(orderPayload, {
            englishFullName: data.englishFullName,
            phoneNumber: data.phoneNumber,
            country: data.country,
            city: data.city,
            region: data.region || '',
            address: data.address,
            postcode: data.postcode,
          });
        } else {
          Object.assign(orderPayload, {
            fullName: data.fullName,
            phoneNumber: data.phoneNumber,
            city: data.city,
            novaPost: data.novaPost,
          });
        }

        const newOrder = new Order(orderPayload);
        await newOrder.save();
        addOrderToAirtable(newOrder);

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


  if (photoUploadState[chatId] && text !== "📤 Надіслати всі фото") {
    return;
  }

  if (!isManager) {
    
    if (text === '👤 Персональний кабінет') {
      return showPersonalCabinet(bot, chatId);
    }
    const user = await User.findOne({ user_id: chatId });

    if (!user && text) {
        console.log(`Ignoring message from unknown user ID: ${chatId} who hasn't started the bot.`);
        return bot.sendMessage(chatId, "Будь ласка, натисніть /start щоб розпочати роботу з ботом.");
    }
    if (user && !text && !msg.photo && !msg.document && !msg.sticker && !msg.video && !msg.forward_from_chat && !msg.contact) {
        console.log(`Ignoring empty or unhandled service message from user ID: ${chatId}`);
        return;
    }

    if (user && !user.name && user.phone_number && text) {
      user.name = text;
      await user.save();
      await bot.sendMessage(chatId, `Дякуємо, ${text}! Ваші дані збережено.`);
      return sendMainMenu(bot, chatId, user.name);
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
      const greetingName = user.name || msg.from.first_name || "Клієнт";
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
        bot.sendMessage(chatId, "Користувача не знайдено. Будь ласка, спочатку запустіть /start.");
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
          inlineKeyboard = [
            [{ text: "Отримати реквізити на оплату", callback_data: `get_payment_${latestOrder.orderId}` }],
            [{ text: "Я оплатив", callback_data: `i_have_paid_${latestOrder.orderId}` }],
            [{ text: "Скільки часу у мене є на оплату доставки?", callback_data: "status_question_5" }]
          ];
          break;
        case "Посилка прибула до України та готується до відправлення ✅":
          inlineKeyboard = [[{ text: "Коли я можу очікувати відправлення?", callback_data: "status_question_6" }]];
          break;
      }

      
      inlineKeyboard.push([{ text: "◀️ Назад до кабінету", callback_data: "back_to_cabinet" }]);

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

        bot.sendMessage(chatId, `🔒 Ваше звернення ${ticket.ticket_id} закрито.`, {
          reply_markup: mainMenuKeyboard()
        });

        bot.sendMessage(process.env.MANAGER_CHAT_ID, `Клієнт ${user.name || msg.from.first_name || 'Без імені'} (@${msg.chat.username || 'N/A'}) закрив заявку ${ticket.ticket_id}.`);
      } else {
        bot.sendMessage(chatId, "У вас немає активних розмов з менеджером для завершення.");
      }
      return;
    }

    if (user && (text || msg.photo || msg.document || msg.sticker || msg.video || msg.forward_from_chat)) {
        const openTicket = await Ticket.findOne({
          user_id: chatId,
          status: 'open',
        }).sort({ accepted: -1 });

        if (openTicket) {
            let messageContent = '';
            let messageType = '';
            let originalMsgTextForLog = 'Повідомлення';

            if (msg.text) { messageContent = msg.text; messageType = 'text'; originalMsgTextForLog = msg.text; }
            else if (msg.photo) { messageContent = msg.photo[msg.photo.length - 1].file_id; messageType = 'photo'; originalMsgTextForLog = msg.caption || 'Фото'; }
            else if (msg.document) { messageContent = msg.document.file_id; messageType = 'document'; originalMsgTextForLog = msg.caption || 'Документ'; }
            else if (msg.sticker) { messageContent = msg.sticker.file_id; messageType = 'sticker'; originalMsgTextForLog = 'Стікер'; }
            else if (msg.video) { messageContent = msg.video.file_id; messageType = 'video'; originalMsgTextForLog = msg.caption || 'Відео'; }
            else if (msg.forward_from_chat || msg.forward_from) { messageType = 'forward'; originalMsgTextForLog = 'Переслане повідомлення';}

            if (messageType) {
                openTicket.messages.push({ from: 'user', text: originalMsgTextForLog, timestamp: new Date() });
                if (openTicket.accepted) {
                    openTicket.lastMessageAt = new Date();
                }
                await openTicket.save();

                if (!openTicket.accepted) {
                    bot.sendMessage(chatId, `Дякуємо, ${user.name || msg.from.first_name || 'Без імені'}, ваше повідомлення додано до заявки ${openTicket.ticket_id}. Очікуйте підключення менеджера 😉`);
                }
                const clientName = user.name || msg.from.first_name || 'Без імені';
                const clientUsername = msg.chat.username ? `@${msg.chat.username}` : '(без юзернейму)';
                const captionForManager = `Від ${clientName} (${clientUsername}, ID заявки: ${openTicket.ticket_id})\n${msg.caption || ''}`;

                 try {
                    switch (messageType) {
                        case 'text': await bot.sendMessage(process.env.MANAGER_CHAT_ID, `${captionForManager.replace(/\n$/, '')}: ${messageContent}`); break;
                        case 'photo': await bot.sendPhoto(process.env.MANAGER_CHAT_ID, messageContent, { caption: captionForManager }); break;
                        case 'document': await bot.sendDocument(process.env.MANAGER_CHAT_ID, messageContent, { caption: captionForManager }); break;
                        case 'sticker':
                             await bot.sendMessage(process.env.MANAGER_CHAT_ID, captionForManager.replace(/\n$/, '') + ' (Стікер)');
                             await bot.sendSticker(process.env.MANAGER_CHAT_ID, messageContent); break;
                        case 'video': await bot.sendVideo(process.env.MANAGER_CHAT_ID, messageContent, { caption: captionForManager }); break;
                        case 'forward':
                             await bot.sendMessage(process.env.MANAGER_CHAT_ID, captionForManager.replace(/\n$/, '') + ' (Переслане повідомлення)');
                             await bot.forwardMessage(process.env.MANAGER_CHAT_ID, msg.chat.id, msg.message_id); break;
                    }
                 } catch (error) {
                     console.error(`Помилка надсилання повідомлення менеджеру від ${chatId} для заявки ${openTicket.ticket_id}:`, error);
                 }
            }
        } else {
          if (!(user && !user.name && user.phone_number && text)) {
              return 'True'
          }
        }
         return;
    }

    
    if (addressChangeState[chatId]) {
      const state = addressChangeState[chatId];
      const cancelKeyboard = { inline_keyboard: [[{ text: '❌ Скасувати', callback_data: 'cancel_address_change' }]] };

      if (state.step === 'awaiting_fullname') {
        state.data.fullName = text.trim();
        state.step = 'awaiting_phone';
        await bot.sendMessage(chatId, 'Введіть Ваш номер телефону:', { reply_markup: cancelKeyboard });
        return;
      } else if (state.step === 'awaiting_phone') {
        state.data.phoneNumber = text.trim();
        state.step = 'awaiting_city';
        await bot.sendMessage(chatId, 'Введіть Ваше місто:', { reply_markup: cancelKeyboard });
        return;
      } else if (state.step === 'awaiting_city') {
        state.data.city = text.trim();
        state.step = 'awaiting_novapost';
        await bot.sendMessage(chatId, 'Введіть номер відділення Нової Пошти:', { reply_markup: cancelKeyboard });
        return;
      } else if (state.step === 'awaiting_novapost') {
        state.data.novaPost = text.trim();
        await User.findOneAndUpdate(
          { user_id: chatId },
          {
            deliveryFullName: state.data.fullName,
            deliveryPhoneNumber: state.data.phoneNumber,
            deliveryCity: state.data.city,
            deliveryNovaPost: state.data.novaPost
          },
          { upsert: true }
        );
        delete addressChangeState[chatId];
        await bot.sendMessage(chatId, '✅ Адресу доставки успішно оновлено!');
        await showPersonalCabinet(bot, chatId);
        return;
      }
    }

    
    if (receiptUploadState[chatId] && receiptUploadState[chatId].awaiting) {
        if (!msg.photo && !msg.document) {
            return bot.sendMessage(chatId, "Будь ласка, надішліть квитанцію у вигляді фотографії або PDF файлу.");
        }
    }
  }

  if (isManager) {
    
    if (directMessageState[chatId] && directMessageState[chatId].step === 1) {
      const queryText = (text || '').trim();
      let targetUser = null;
      
      const orderById = await Order.findOne({ orderId: String(queryText) });
      if (orderById) {
        targetUser = await User.findOne({ username: orderById.username });
      }
      
      if (!targetUser && queryText.startsWith('@')) {
        targetUser = await User.findOne({ username: queryText.slice(1) });
      }
      
      if (!targetUser) {
        const digits = queryText.replace(/\D/g, '');
        if (digits.length >= 6) {
          targetUser = await User.findOne({ phone_number: { $regex: digits } });
        }
      }
      
      if (!targetUser) {
        targetUser = await User.findOne({ name: queryText });
      }
      if (!targetUser) {
        return bot.sendMessage(chatId, 'Клієнта не знайдено. Спробуйте ввести інший запит (ID замовлення / @username / телефон / ПІБ):');
      }
      directMessageState[chatId] = { step: 2, userId: targetUser.user_id };
      return bot.sendMessage(chatId, `Знайдено клієнта: ${targetUser.name || 'Без імені'} (@${targetUser.username || 'N/A'}). Введіть текст повідомлення:`);
    }
    if (shippingInfoState[chatId]) {
      const state = shippingInfoState[chatId];
      if (state.step === 1) {
        state.shippingDate = text.trim();
        state.step = 2;
        return bot.sendMessage(chatId, 'Введіть орієнтовну дату прибуття в Україну (наприклад, 04.06.2025):');
      }
      if (state.step === 2) {
        state.estimatedArrivalDate = text.trim();
        
        const order = await Order.findOne({ orderId: state.orderId });
        if (order && order.direction === 'За кордон') {
          delete shippingInfoState[chatId];
          const updated = await Order.findOneAndUpdate(
            { orderId: state.orderId },
            { status: 'Відправлено ✅', shippingDate: state.shippingDate, estimatedArrivalDate: state.estimatedArrivalDate },
            { new: true }
          );
          const user = await User.findOne({ username: updated.username });
          if (user) {
            const notificationText = `Ваше замовлення вже відправлено 📦✅\n\nОрієнтовна дата прибуття: ${state.estimatedArrivalDate}\n\nОчікуйте сповіщення або дзвінок від кур’єра DHL. \nУ деяких випадках посилку можуть залишити біля дверей.\n\nДля отримання посилання на відстеження — зв’яжіться з менеджером.`;
            await bot.sendMessage(user.user_id, notificationText);
          }
          return bot.sendMessage(chatId, 'Статус оновлено на "Відправлено ✅" (за кордон) та повідомлення клієнту надіслано.');
        }
        state.step = 3;
        return bot.sendMessage(chatId, 'Надішліть посилання на відстеження замовлення:');
      }
      if (state.step === 3) {
        const { orderId, shippingDate, estimatedArrivalDate } = state;
        const trackingLink = text.trim();
        delete shippingInfoState[chatId];
        const order = await Order.findOneAndUpdate(
            { orderId },
            { status: 'Відправлено ✅', shippingDate, estimatedArrivalDate, trackingLink },
            { new: true }
        );
        const user = await User.findOne({ username: order.username });
        if (user) {
          const notificationText = `Ваше замовлення вже відправлено в Україну! 📦✅\n\nДата відправлення: ${shippingDate}\nОрієнтовна дата прибуття в Україну: ${estimatedArrivalDate}\n\nВідстежуйте своє замовлення самостійно за допомогою посилання:\n${trackingLink}\n\nМи повідомимо вас, щойно замовлення прибуде. Дякуємо за очікування! ❤️`;
          await bot.sendMessage(user.user_id, notificationText);
        }
        return bot.sendMessage(chatId, 'Статус оновлено на "Відправлено ✅" та повідомлення клієнту надіслано.');
      }
    }
    if (addressChangeState[chatId]) {
      const state = addressChangeState[chatId];
      const cancelKeyboard = { inline_keyboard: [[{ text: '❌ Скасувати', callback_data: 'cancel_address_change' }]] };
      if (state.step === 'awaiting_fullname') {
        state.data.fullName = text.trim();
        state.step = 'awaiting_phone';
        await bot.sendMessage(chatId, 'Введіть Ваш номер телефону:', { reply_markup: cancelKeyboard });
        return;
      } else if (state.step === 'awaiting_phone') {
        state.data.phoneNumber = text.trim();
        state.step = 'awaiting_city';
        await bot.sendMessage(chatId, 'Введіть Ваше місто:', { reply_markup: cancelKeyboard });
        return;
      } else if (state.step === 'awaiting_city') {
        state.data.city = text.trim();
        state.step = 'awaiting_novapost';
        await bot.sendMessage(chatId, 'Введіть номер відділення Нової Пошти:', { reply_markup: cancelKeyboard });
        return;
      } else if (state.step === 'awaiting_novapost') {
        state.data.novaPost = text.trim();
        await User.findOneAndUpdate(
          { user_id: chatId },
          {
            deliveryFullName: state.data.fullName,
            deliveryPhoneNumber: state.data.phoneNumber,
            deliveryCity: state.data.city,
            deliveryNovaPost: state.data.novaPost
          },
          { upsert: true }
        );
        delete addressChangeState[chatId];
        await bot.sendMessage(chatId, '✅ Адресу доставки успішно оновлено!');
        await showPersonalCabinet(bot, chatId);
        return;
      }
    }
    if (profileViewState[chatId] && profileViewState[chatId].step === 1) {
      const query = text.trim();
      let userToView = null;
      let order = await Order.findOne({ orderId: String(query) });
      if (order) {
        userToView = await User.findOne({ username: order.username });
        if (!userToView) {
          
          let orderInfo = `*Замовлення знайдено:*
` +
            `*ID:* ${order.orderId}\n` +
            `*ПІБ:* ${order.fullName || 'Не вказано'}\n` +
            `*Телефон:* ${order.phoneNumber || 'Не вказано'}\n` +
            `*Username:* @${order.username || 'N/A'}\n` +
            `*Товар:* ${order.productName || 'Не вказано'}\n` +
            `*Місто:* ${order.city || 'Не вказано'}\n` +
            `*Відділення:* ${order.novaPost || 'Не вказано'}\n` +
            `*Статус:* ${order.status || 'Не вказано'}\n`;
          await bot.sendMessage(chatId, orderInfo, { parse_mode: 'Markdown' });
          delete profileViewState[chatId];
          return;
        }
      }
      if (!userToView && query.startsWith('@')) { userToView = await User.findOne({ username: query.substring(1) }); }
      if (!userToView) { userToView = await User.findOne({ phone_number: { $regex: query.replace(/\D/g, '') } }); }
      if (!userToView) { userToView = await User.findOne({ name: query }); }
      
      delete profileViewState[chatId];
      if (userToView) {
        await showManagerProfileView(bot, chatId, userToView);
      } else {
        return bot.sendMessage(chatId, "Користувача не знайдено за вашим запитом.");
      }
      return;
    }
    if (directMessageState[chatId] && directMessageState[chatId].step === 1) {
      const { userId, userName, userUsername } = directMessageState[chatId];
      delete directMessageState[chatId];
      try {
        await bot.sendMessage(userId, `Вам повідомлення від менеджера:\n\n${text}`);
        return bot.sendMessage(chatId, `Повідомлення успішно надіслано клієнту!`);
      } catch (e) {
        return bot.sendMessage(chatId, `Не вдалося надіслати повідомлення. Можливо, користувач заблокував бота.`);
      }
    }
    if (directMessageState[chatId] && directMessageState[chatId].step === 2) {
      const { userId, userName, userUsername } = directMessageState[chatId];
      delete directMessageState[chatId];
      try {
        await bot.sendMessage(userId, `Вам повідомлення від менеджера:\n\n${text}`);
        return bot.sendMessage(chatId, `Повідомлення успішно надіслано клієнту!`);
      } catch (e) {
        return bot.sendMessage(chatId, `Не вдалося надіслати повідомлення. Можливо, користувач заблокував бота.`);
      }
    }
    if (bonusChangeState[chatId] && bonusChangeState[chatId].step === 1) {
      const amount = parseInt(text, 10);
      if (isNaN(amount) || amount <= 0) {
        return bot.sendMessage(chatId, "Будь ласка, введіть коректне числове значення для бонусів.");
      }
      const { userId } = bonusChangeState[chatId];
      delete bonusChangeState[chatId];
      const user = await User.findOneAndUpdate({ user_id: userId }, { $inc: { bonusBalance: amount } }, { new: true });
      await bot.sendMessage(chatId, `✅ Бонуси в кількості ${amount} успішно нараховано клієнту @${user.username}. Новий баланс: ${user.bonusBalance}.`);
      await bot.sendMessage(userId, `Вам нараховано ${amount} бонусних балів! 🎁`);
      return;
    }
    if (receiptUploadState[chatId] && receiptUploadState[chatId].awaiting) {
      if (!msg.photo && !msg.document) {
        return bot.sendMessage(chatId, "Будь ласка, надішліть квитанцію у вигляді фотографії або PDF файлу.");
      }
      return;
    }
    

    if (text === "Зміна статусу замовлення") {
      const orders = await Order.find().sort({ createdAt: -1 });
      if (orders.length === 0) { return bot.sendMessage(chatId, "Немає замовлень для зміни статусу."); }
      const inlineKeyboard = orders.map(order => [{ text: `ID: ${order.orderId || 'N/A'} @${order.username || 'N/A'} (${order.productName || 'Без назви'})`, callback_data: `change_status_${order.orderId}` }]);
      return bot.sendMessage(chatId, "Виберіть замовлення для зміни статусу:", { reply_markup: { inline_keyboard: inlineKeyboard } });
    }

    if (text === "Показати активні заявки") {
        const activeTickets = await Ticket.find({ status: 'open' }).sort({ created_at: 1 });
        if (activeTickets.length === 0) { return bot.sendMessage(process.env.MANAGER_CHAT_ID, "Немає активних заявок."); }

        const ticketButtonsPromises = activeTickets.map(async (ticket) => {
            const userTicket = await User.findOne({ user_id: ticket.user_id });
            const userName = userTicket ? (userTicket.name || userTicket.username || `ID:${ticket.user_id}`) : 'Невідомий';
            const statusIndicator = ticket.accepted ? (ticket.activeManagerConversation ? '🔷' : '✅') : '🆕';
            const buttonText = `${statusIndicator} ${ticket.ticket_id} (${userName})`;
            return [{ text: buttonText, callback_data: `accept_${ticket.ticket_id}` }];
        });
        const ticketButtons = await Promise.all(ticketButtonsPromises);
        return bot.sendMessage(process.env.MANAGER_CHAT_ID, "Активні заявки (🆕-нова, ✅-прийнята, 🔷-активна розмова):", { reply_markup: { inline_keyboard: ticketButtons } });
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
      console.log("Менеджер надіслав:", text || `Тип: ${msg.photo ? 'фото' : msg.document ? 'документ' : 'інше'}`);

      const activeConvTicket = await Ticket.findOne({
        status: 'open',
        accepted: true,
        activeManagerConversation: true
      });

      if (!activeConvTicket) {
        return bot.sendMessage(process.env.MANAGER_CHAT_ID, "Немає активної розмови для відповіді. Будь ласка, виберіть заявку зі списку 'Показати активні заявки', щоб активувати чат.", {
            reply_markup: {
                inline_keyboard: [[{ text: "Показати активні заявки", callback_data: "show_active_tickets_inline" }]]
            }
        });
      }

      let messageType = '';
      let messageContentForSend = '';
      let messageTextForDb = '';
      let sentToClient = false;

      try {
          if (msg.text) {
            messageType = 'text'; messageContentForSend = msg.text; messageTextForDb = msg.text;
            await bot.sendMessage(activeConvTicket.user_id, messageContentForSend);
            sentToClient = true;
          } else if (msg.photo) {
            messageType = 'photo'; messageContentForSend = msg.photo[msg.photo.length - 1].file_id; messageTextForDb = msg.caption || 'Фото';
            await bot.sendPhoto(activeConvTicket.user_id, messageContentForSend, { caption: msg.caption || '' });
            sentToClient = true;
          } else if (msg.document) {
            messageType = 'document'; messageContentForSend = msg.document.file_id; messageTextForDb = msg.caption || 'Документ';
            await bot.sendDocument(activeConvTicket.user_id, messageContentForSend, { caption: msg.caption || '' });
            sentToClient = true;
          } else if (msg.sticker) {
            messageType = 'sticker'; messageContentForSend = msg.sticker.file_id; messageTextForDb = 'Стікер';
            await bot.sendSticker(activeConvTicket.user_id, messageContentForSend);
            sentToClient = true;
          } else if (msg.video) {
            messageType = 'video'; messageContentForSend = msg.video.file_id; messageTextForDb = msg.caption || 'Відео';
            await bot.sendVideo(activeConvTicket.user_id, messageContentForSend, { caption: msg.caption || '' });
            sentToClient = true;
          } else if (msg.forward_from_chat || msg.forward_from) {
            messageType = 'forward'; messageTextForDb = 'Переслане повідомлення';
            await bot.forwardMessage(activeConvTicket.user_id, chatId, msg.message_id);
            sentToClient = true;
          }

          if (sentToClient) {
             activeConvTicket.messages.push({ from: 'manager', text: messageTextForDb, timestamp: new Date() });
             activeConvTicket.lastMessageAt = new Date();
             await activeConvTicket.save();
          } else {
              console.log("Невідомий тип повідомлення від менеджера, не надіслано клієнту.");
          }
      } catch (error) {
           console.error(`Помилка надсилання повідомлення клієнту ${activeConvTicket.user_id} для заявки ${activeConvTicket.ticket_id}:`, error);
           let errorReply = `Помилка надсилання повідомлення клієнту ID ${activeConvTicket.user_id} (заявка ${activeConvTicket.ticket_id}).`;
           if (error.response && error.response.statusCode === 403) {
               errorReply += "\nКлієнт міг заблокувати бота.";
           } else {
               errorReply += "\nПеревірте з'єднання або спробуйте пізніше.";
           }
           bot.sendMessage(chatId, errorReply)
               .catch(e => console.error("Помилка відправки повідомлення про помилку менеджеру:", e));
      }
    }
  }

  if (text === "📤 Надіслати всі фото" && isManager && photoUploadState[chatId]) {
    if (!photoUploadState[chatId].photos || photoUploadState[chatId].photos.length === 0) {
      return bot.sendMessage(chatId, "Немає фото для надсилання. Спочатку завантажте їх.");
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
          console.warn(`[send_all_photos] Order ${session.orderId} not found to update status after sending photos.`);
      }

      await bot.sendMessage(session.clientId, "Фотозвіт вашого замовлення готовий!", { parse_mode: 'Markdown' });
      await new Promise(resolve => setTimeout(resolve, 200));
      await bot.sendMessage(session.clientId, "Будь ласка, підтвердіть, що все підходить.\nЯкщо є питання - використовуйте '🙇‍♂️ Зв'язок з менеджером'.", {
        reply_markup: {
          inline_keyboard: [[{ text: "Все підходить ✅", callback_data: `confirm_photos_${session.orderId}` }]]
        }
      });

      bot.sendMessage(chatId, "Фотозвіт успішно надіслано клієнту ✅");

    } catch (error) {
      console.error("[send_all_photos] Error sending photo report:", error);
      let errorReply = "Не вдалося надіслати фотозвіт клієнту.";
      if (error.response && error.response.statusCode === 403) {
        errorReply += "\nМожливо, бот заблокований клієнтом.";
      }
      errorReply += "\nСпробуйте знову або перевірте консоль.";
      bot.sendMessage(chatId, errorReply);
    } finally {
       if (photoUploadState[chatId]) {
           console.log(`[send_all_photos] Clearing photo upload state for Chat ID: ${chatId}`);
           delete photoUploadState[chatId];
       }
    }
    return;
  }

  
  if (isManager) {
    
    if (text === "Переглянути профіль") {
      profileViewState[chatId] = { step: 1 };
      return bot.sendMessage(chatId, "Введіть ID замовлення, @username, повне ім'я або номер телефону клієнта для пошуку:");
    }
    if (text === "Написати повідомлення") {
      return bot.sendMessage(chatId, 'Оберіть тип повідомлення:', {
        reply_markup: {
          inline_keyboard: [
            [{ text: "📩 Окремому користувачу", callback_data: "send_msg_specific" }],
            [{ text: "📢 Загальне повідомлення", callback_data: "send_msg_broadcast" }]
          ]
        }
      });
    }

    
    if (broadcastState[chatId] && broadcastState[chatId].step === 1) {
      const messageText = text;
      delete broadcastState[chatId];
      const allUsers = await User.find({ user_id: { $ne: process.env.MANAGER_CHAT_ID } });
      let successCount = 0;
      let failureCount = 0;
      await bot.sendMessage(chatId, `🚀 Розпочинаю розсилку...`);
      for (const user of allUsers) {
        try {
          await bot.sendMessage(user.user_id, messageText);
          successCount++;
        } catch (e) {
          failureCount++;
        }
      }
      return bot.sendMessage(chatId, `✅ Розсилку завершено.\n\nНадіслано: ${successCount}\nНе вдалося надіслати: ${failureCount}`);
    }

    
    if (bonusChangeState[chatId] && bonusChangeState[chatId].step === 1) {
      const amount = parseInt(text, 10);
      if (isNaN(amount) || amount <= 0) {
        return bot.sendMessage(chatId, "Будь ласка, введіть коректне числове значення для бонусів.");
      }
      const { userId } = bonusChangeState[chatId];
      delete bonusChangeState[chatId];
      const user = await User.findOneAndUpdate({ user_id: userId }, { $inc: { bonusBalance: amount } }, { new: true });
      await bot.sendMessage(chatId, `✅ Бонуси в кількості ${amount} успішно нараховано клієнту @${user.username}. Новий баланс: ${user.bonusBalance}.`);
      await bot.sendMessage(userId, `Вам нараховано ${amount} бонусних балів! 🎁`);
      return;
    }

    
    if (shippingInfoState[chatId]) {
      const state = shippingInfoState[chatId];
      if (state.step === 1) {
        state.shippingDate = text.trim();
        state.step = 2;
        return bot.sendMessage(chatId, 'Введіть орієнтовну дату прибуття в Україну (наприклад, 04.06.2025):');
      }
      if (state.step === 2) {
        state.estimatedArrivalDate = text.trim();
        state.step = 3;
        return bot.sendMessage(chatId, 'Надішліть посилання на відстеження замовлення:');
      }
      if (state.step === 3) {
        const { orderId, shippingDate, estimatedArrivalDate } = state;
        const trackingLink = text.trim();
        delete shippingInfoState[chatId];
        const order = await Order.findOneAndUpdate(
            { orderId },
            { status: 'Відправлено ✅', shippingDate, estimatedArrivalDate, trackingLink },
            { new: true }
        );
        const user = await User.findOne({ username: order.username });
        if (user) {
          const notificationText = `Ваше замовлення вже відправлено в Україну! 📦✅\n\nДата відправлення: ${shippingDate}\nОрієнтовна дата прибуття в Україну: ${estimatedArrivalDate}\n\nВідстежуйте своє замовлення самостійно за допомогою посилання:\n${trackingLink}\n\nМи повідомимо вас, щойно замовлення прибуде. Дякуємо за очікування! ❤️`;
          await bot.sendMessage(user.user_id, notificationText);
        }
        return bot.sendMessage(chatId, 'Статус оновлено на "Відправлено ✅" та повідомлення клієнту надіслано.');
      }
    }
  }
}

 
function escapeMarkdown(text) {
  if (!text) return '';
  return text.replace(/([_\*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
}

async function showPersonalCabinet(bot, chatId) {
    const user = await User.findOne({ user_id: chatId });
    if (!user) return bot.sendMessage(chatId, "Користувача не знайдено. Будь ласка, натисніть /start.");

    const latestOrder = await Order.findOne({ username: user.username }).sort({ createdAt: -1 });

    let profileText = `*👤 Імʼя користувача:* ${escapeMarkdown(user.name || 'Не вказано')}\n` +
                      `*🔗 Username:* @${escapeMarkdown(user.username || 'N/A')}\n` +
                      `*📞 Телефон:* ${escapeMarkdown(user.phone_number || 'Не вказано')}\n`;

    if (latestOrder) {
        profileText += `*📦 Номер останнього замовлення:* ${escapeMarkdown(latestOrder.orderId)}\n`;
    } else {
        profileText += `*📦 Номер останнього замовлення:* ❌ Ви ще не оформлювали замовлення\n`;
    }

    if (user.bonusBalance && user.bonusBalance > 0) {
        profileText += `*💰 Баланс бонусів:* ${user.bonusBalance} бонусних балів\n`;
    } else {
        profileText += `*💰 Баланс бонусів:* Немає бонусів\n`;
    }

    profileText += `\n`;

    const deliveryAddress = user.deliveryFullName ? user : latestOrder;
    if (deliveryAddress && (deliveryAddress.deliveryCity || deliveryAddress.city)) {
        profileText += `*🚚 Основна адреса доставки:*\n` +
                       `   ПІБ: ${escapeMarkdown(deliveryAddress.deliveryFullName || deliveryAddress.fullName)}\n` +
                       `   Номер телефону: ${escapeMarkdown(deliveryAddress.deliveryPhoneNumber || deliveryAddress.phoneNumber)}\n` +
                       `   Місто: ${escapeMarkdown(deliveryAddress.deliveryCity || deliveryAddress.city)}\n` +
                       `   Відділення: ${escapeMarkdown(deliveryAddress.deliveryNovaPost || deliveryAddress.novaPost)}`;
    }

    await bot.sendMessage(chatId, profileText, {
        parse_mode: 'MarkdownV2',
        reply_markup: personalCabinetKeyboard()
    });
}

async function showManagerProfileView(bot, managerChatId, user) {
  const latestOrder = await Order.findOne({ username: user.username }).sort({ createdAt: -1 });
  let profileText = `*Профіль клієнта*\n\n` +
                    `*👤 Ім'я користувача:* ${escapeMarkdown(user.name || 'Не вказано')}\n` +
                    `*🔗 Username:* @${escapeMarkdown(user.username || 'N/A')}\n` +
                    `*📞 Телефон:* ${escapeMarkdown(user.phone_number || 'Не вказано')}\n`;

  if (latestOrder) {
    profileText += `*📦 Номер останнього замовлення:* ${escapeMarkdown(latestOrder.orderId)}\n`;
  } else {
    profileText += `*📦 Номер останнього замовлення:* ❌ Ви ще не оформлювали замовлення\n`;
  }
  
  if (user.bonusBalance && user.bonusBalance > 0) {
    profileText += `*💰 Баланс бонусів:* ${user.bonusBalance} бонусних балів\n`;
  } else {
    profileText += `*💰 Баланс бонусів:* Немає бонусів\n`;
  }

  profileText += `\n`;

  const deliveryAddress = user.deliveryFullName ? user : latestOrder;
    if (deliveryAddress && (deliveryAddress.deliveryCity || deliveryAddress.city)) {
        profileText += `*🚚 Основна адреса доставки:*\n` +
                       `   Місто: ${escapeMarkdown(deliveryAddress.deliveryCity || deliveryAddress.city)}\n` +
                       `   Відділення: ${escapeMarkdown(deliveryAddress.deliveryNovaPost || deliveryAddress.novaPost)}`;
    }

  await bot.sendMessage(managerChatId, profileText, {
    parse_mode: 'MarkdownV2',
    reply_markup: {
      inline_keyboard: [
        [{ text: "💰 Обміняти бали клієнта", callback_data: `mgr_exchange_bonus_${user.user_id}` }],
        [{ text: "🎁 Видати бали клієнту", callback_data: `mgr_give_bonus_${user.user_id}` }],
        [{ text: "✍️ Написати повідомлення клієнту", callback_data: `mgr_message_client_${user.user_id}` }]
      ]
    }
  });
}

async function showOrderStatus(bot, chatId, messageId) {
  const user = await User.findOne({ user_id: chatId });
  if (!user || !user.username) {
    await bot.editMessageText(
      "Не вдалося отримати статус. Перевірте юзернейм або зверніться до менеджера.",
      { chat_id: chatId, message_id: messageId, reply_markup: null }
    );
    return;
  }
  const orders = await Order.find({ username: user.username }).sort({ createdAt: -1 });
  if (!orders || orders.length === 0) {
    await bot.editMessageText("Замовлень для @" + user.username + " ще немає, зверніться до менеджера для його створення.", {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: null,
    });
    return;
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
      inlineKeyboard = [
        [{ text: "Отримати реквізити на оплату", callback_data: `get_payment_${latestOrder.orderId}` }],
        [{ text: "Я оплатив", callback_data: `i_have_paid_${latestOrder.orderId}` }],
        [{ text: "Скільки часу у мене є на оплату доставки?", callback_data: "status_question_5" }]
      ];
      break;
    case "Посилка прибула до України та готується до відправлення ✅":
      inlineKeyboard = [[{ text: "Коли я можу очікувати відправлення?", callback_data: "status_question_6" }]];
      break;
  }
  
  inlineKeyboard.push([{ text: "◀️ Назад до кабінету", callback_data: "back_to_cabinet" }]);
  await bot.editMessageText(responseText, {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: { inline_keyboard: inlineKeyboard },
  });
}

module.exports = {
  messagesHandler,
  showOrderStatus,
  showPersonalCabinet, 
};