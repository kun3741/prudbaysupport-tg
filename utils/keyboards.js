function requestPhoneKeyboard() {
    return {
      keyboard: [
        [
          {
            text: "📱 Надати номер телефону",
            request_contact: true
          }
        ]
      ],
      resize_keyboard: true,
      one_time_keyboard: true
    };
  }
  
  function mainMenuKeyboard() {
    return {
      keyboard: [
        ["👤 Персональний кабінет"],
        ["🙇‍♂️ Зв'язок з менеджером"],
        ["⚡️ Швидкі відповіді"]
      ],
      resize_keyboard: true
    };
  }
  
  function quickRepliesKeyboard() {
    return {
      inline_keyboard: [
        [{ text: "Чи можливий накладний платіж?", callback_data: "quick_reply_1" }],
        [{ text: "Обмін\\повернення товару з наявності", callback_data: "quick_reply_2" }],
        [{ text: "Обмін\\повернення товару під замовлення", callback_data: "quick_reply_3" }],
        [{ text: "Термін доставки", callback_data: "quick_reply_4" }],
        [{ text: "Вартість доставки", callback_data: "quick_reply_5" }],
        [{ text: "Хочу замовити у Європу", callback_data: "quick_reply_6" }],
        [{ text: "Немає відповіді на моє питання 🤷‍♂️", callback_data: "quick_reply_7" }],
        [{ text: "Меню", callback_data: "quick_reply_menu" }]
      ]
    };
  }
  
  function stagesKeyboard() {
    return {
      inline_keyboard: [
        [
          { text: "Коли я можу дізнатися новий статус?", callback_data: "stage_status_1" }
        ],
        [
          { text: "Коли товар прибуде на склад?", callback_data: "stage_status_2" }
        ],
        [
          { text: "Коли я можу отримати фото-звіт?", callback_data: "stage_status_3" }
        ],
        [
          { text: "Скільки часу на оплату доставки?", callback_data: "stage_status_5" }
        ],
        [
          { text: "Коли я можу очікувати відправлення?", callback_data: "stage_status_6" }
        ]
      ]
    };
  }
  
  function backButtonKeyboard() {
    return {
      inline_keyboard: [
        [
          { text: "◀️ Назад", callback_data: "stage_back" }
        ]
      ]
    };
  }
  
  function personalCabinetKeyboard() {
    return {
      inline_keyboard: [
        [{ text: "✅ Статус замовлення", callback_data: "pc_status" }],
        [{ text: "🔄 Змінити адресу доставки", callback_data: "pc_change_address" }],
        [{ text: "🎁 Як отримати бонуси?", callback_data: "pc_how_to_get_bonuses" }],
        [{ text: "💰 Обміняти бонуси", callback_data: "pc_exchange_bonuses" }],
        [{ text: "🔙 Повернутися в головне меню", callback_data: "pc_back_to_main" }]
      ]
    };
  }
  
  module.exports = {
    requestPhoneKeyboard,
    mainMenuKeyboard,
    quickRepliesKeyboard,
    stagesKeyboard,
    backButtonKeyboard,
    personalCabinetKeyboard
  };