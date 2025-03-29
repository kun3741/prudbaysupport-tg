async function photosHandler(bot, msg, photoUploadState) {
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
  } else {
    return bot.sendMessage(chatId, "Ви не перебуваєте в стані завантаження фото. Натисніть відповідну кнопку для початку.");
  }
}

module.exports = photosHandler;