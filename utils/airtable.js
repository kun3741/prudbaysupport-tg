const Airtable = require('airtable');

let base;

const ukrainianMonthsNominative = [
    "Січень", "Лютий", "Березень", "Квітень", "Травень", "Червень",
    "Липень", "Серпень", "Вересень", "Жовтень", "Листопад", "Грудень"
];

/**
 * Генерує назву таблиці Airtable на основі поточного місяця та року.
 * @returns {string} Назва таблиці у форматі "Місяць Рік" (напр., "Квітень 2025").
 */
function getCurrentAirtableTableName() {
    const now = new Date();
    const monthIndex = now.getMonth();
    const year = now.getFullYear();
    const monthName = ukrainianMonthsNominative[monthIndex];
    const tableName = `${monthName} ${year}`;
    return tableName;
}

/**
 * Ініціалізує підключення до Airtable.
 */
function initAirtable() {
    if (!process.env.AIRTABLE_API_KEY || !process.env.AIRTABLE_BASE_ID) {
        console.error("ПОМИЛКА: Змінні середовища AIRTABLE_API_KEY або AIRTABLE_BASE_ID не встановлені!");
        base = null;
        return;
    }
    try {
        Airtable.configure({ endpointUrl: 'https://api.airtable.com', apiKey: process.env.AIRTABLE_API_KEY });
        base = Airtable.base(process.env.AIRTABLE_BASE_ID);
        console.log("Airtable ініціалізовано.");
    } catch (error) {
        console.error("ПОМИЛКА ініціалізації Airtable:", error);
        base = null;
    }
}

/**
 * Знаходить запис в Airtable за Order ID у поточній місячній таблиці.
 */
async function findAirtableRecordByOrderId(orderId) {
    if (!base || !orderId) return null;
    const tableName = getCurrentAirtableTableName();
    try {
        const records = await base(tableName).select({
            filterByFormula: `{Name} = "${orderId}"`,
            maxRecords: 1
        }).firstPage();
        if (records && records.length > 0) { console.log(`[Airtable][${tableName}] Знайдено запис ID ${orderId}: ${records[0].id}`); return records[0]; }
        else { console.log(`[Airtable][${tableName}] Запис ID ${orderId} не знайдено.`); return null; }
    } catch (error) {
        console.error(`[Airtable][${tableName}] Помилка пошуку ID ${orderId}:`, error);
        if (error.statusCode === 404) {
             console.error(`[Airtable] Ймовірно, таблиця "${tableName}" не існує в базі ${process.env.AIRTABLE_BASE_ID}`);
        }
        return null;
    }
}

/**
 * Додає нове замовлення в поточну місячну таблицю Airtable.
 */
async function addOrderToAirtable(order) {
    if (!base || !order || !order.orderId) { console.error("[Airtable] Add Error: Missing data."); return; }
    const tableName = getCurrentAirtableTableName();
    const dateValue = order.createdAt ? new Date(order.createdAt) : new Date();
    const isoDateOnlyString = dateValue.toISOString().split('T')[0];
    const airtableData = {
        'Name': order.orderId,
        'Notes': isoDateOnlyString,
        'Status': order.productName || 'Не вказано',
        'Attachments': "Прямує на склад",
    };
    try {
        console.log(`[Airtable][${tableName}] Спроба додати запис ID: ${order.orderId}`);
        const createdRecords = await base(tableName).create([{ fields: airtableData }]);
        console.log(`[Airtable][${tableName}] Створено запис ID: ${createdRecords[0].id} для Order ID: ${order.orderId}`);
    } catch (error) {
        console.error(`[Airtable][${tableName}] Помилка створення запису ID ${order.orderId}:`, error);
        if (error.statusCode === 404) { console.error(`[Airtable] Переконайтесь, що таблиця "${tableName}" існує в базі ${process.env.AIRTABLE_BASE_ID}`); }
        console.error(`[Airtable] Дані:`, airtableData);
    }
}

/**
 * Оновлює статус в поточній місячній таблиці Airtable, для певних значень.
 */
async function updateOrderInAirtable(orderId, newBotStatus, productName) {
    if (!base || !orderId || !newBotStatus) { console.error("[Airtable] Update Error: Missing data."); return; }
    const tableName = getCurrentAirtableTableName();

    const statusMap = {
        "Товар викуплено та відправлено на склад в Китаї ✅": "Прямує на склад",
        "Посилка прибула до України та готується до відправлення ✅": "Добавити трек номер",
        "Посилка відправлена клієнту ✅": "Прямує до одержувача",
    };
    const airtableStatusToSet = statusMap[newBotStatus];

    if (!airtableStatusToSet) { console.log(`[Airtable][${tableName}] Статус '${newBotStatus}' для ID ${orderId} НЕ оновлюється.`); return; }

    const record = await findAirtableRecordByOrderId(orderId);
    if (!record) { console.warn(`[Airtable][${tableName}] Запис для оновлення ID: ${orderId} не знайдено.`); return; }

    const fieldsToUpdate = { 'Attachments': airtableStatusToSet, };

    try {
        console.log(`[Airtable][${tableName}] Спроба оновити ${record.id} (ID: ${orderId}) на '${airtableStatusToSet}'`);
        await base(tableName).update([{ id: record.id, fields: fieldsToUpdate }]);
        console.log(`[Airtable][${tableName}] Оновлено ${record.id} для ID: ${orderId}`);
    } catch (error) {
        console.error(`[Airtable][${tableName}] Помилка оновлення ${record.id} для ID ${orderId}:`, error);
         if (error.statusCode === 404) { console.error(`[Airtable] Ймовірно, таблиця "${tableName}" не існує.`); }
    }
}

module.exports = {
    initAirtable,
    addOrderToAirtable,
    updateOrderInAirtable,
};