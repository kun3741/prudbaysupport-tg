async function photosHandler(bot, msg, photoUploadState) {
  const chatId = msg.chat.id;

  // Перевірка, чи менеджер у стані завантаження фото
  if (photoUploadState[chatId]) {
    const fileId = msg.photo[msg.photo.length - 1].file_id; // Беремо останнє (найбільше) фото
    photoUploadState[chatId].photos.push(fileId); // Додаємо фото до стану

    return bot.sendMessage(chatId, "Фото додано. Надішліть ще фото або натисніть 'Завершити завантаження'.");
  } else {
    return bot.sendMessage(chatId, "Ви не перебуваєте в стані завантаження фото. Натисніть відповідну кнопку для початку.");
  }
}

module.exports = photosHandler;