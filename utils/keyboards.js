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
        ["🙇‍♂️ Зв'язок з менеджером"], ["💚 Статус замовлення"], 
        ["⚡️ Швидкі відповіді", "🚀 Стадії замовлення"]
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
  
  module.exports = {
    requestPhoneKeyboard,
    mainMenuKeyboard,
    quickRepliesKeyboard
  };