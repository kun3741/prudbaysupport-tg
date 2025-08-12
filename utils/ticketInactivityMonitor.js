const Ticket = require('../models/Ticket');
const User = require('../models/User');
const { mainMenuKeyboard } = require('./keyboards');

const INACTIVITY_TIMEOUT = 30 * 60 * 1000;
const CHECK_INTERVAL = 1 * 60 * 1000;

async function checkInactiveTickets(bot) {
    try {
        const thirtyMinutesAgo = new Date(Date.now() - INACTIVITY_TIMEOUT);

        const inactiveTickets = await Ticket.find({
            status: 'open',
            accepted: true,
            lastMessageAt: { $lt: thirtyMinutesAgo }
        });

        for (const ticket of inactiveTickets) {
            console.log(`[InactivityMonitor] Ticket ${ticket.ticket_id} is inactive. Closing.`);

            ticket.status = 'closed';
            ticket.activeManagerConversation = false;
            await ticket.save();

            try {
                await bot.sendMessage(
                    ticket.user_id,
                    "🥺 На жаль, ми довго не отримували від Вас відповіді.\nЯкщо у Вас ще залишились питання або потрібна допомога — Ви завжди можете розпочати новий чат за допомогою меню 😊",
                    { reply_markup: mainMenuKeyboard() }
                );
            } catch (clientError) {
                console.error(`[InactivityMonitor] Failed to send inactivity message to client ${ticket.user_id} for ticket ${ticket.ticket_id}:`, clientError.message);
                if (clientError.response && clientError.response.statusCode === 403) {
                    console.warn(`[InactivityMonitor] Bot might be blocked by user ${ticket.user_id}. Ticket ${ticket.ticket_id} still closed.`);
                }
            }

            const clientUser = await User.findOne({ user_id: ticket.user_id });
            const clientUsername = clientUser ? (clientUser.username || `ID:${clientUser.user_id}`) : 'unknown_user';
            const clientName = clientUser ? (clientUser.name || 'Без імені') : 'Невідомий клієнт';

            try {
                if (process.env.MANAGER_CHAT_ID) {
                    await bot.sendMessage(
                        process.env.MANAGER_CHAT_ID,
                        `🔔 Автоматичне закриття заявки\nЗаявка #${ticket.ticket_id} (клієнт: ${clientName} @${clientUsername}) була автоматично закрита через тривалу відсутність відповіді.`
                    );
                } else {
                    console.warn("[InactivityMonitor] MANAGER_CHAT_ID is not set in .env. Cannot notify manager about auto-closure.");
                }
            } catch (managerError) {
                console.error(`[InactivityMonitor] Failed to send inactivity notification to manager for ticket ${ticket.ticket_id}:`, managerError.message);
            }
        }
    } catch (error) {
        console.error("[InactivityMonitor] Critical error in checkInactiveTickets:", error);
    }
}

function startInactivityMonitor(bot) {
    if (!bot) {
        console.error("[InactivityMonitor] Bot instance is required to start the inactivity monitor.");
        return;
    }
    console.log('Ticket inactivity monitor started. Checking every minute for tickets inactive for 30 minutes.');
    setInterval(() => checkInactiveTickets(bot), CHECK_INTERVAL);
}

module.exports = { startInactivityMonitor };