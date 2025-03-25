module.exports = async function photosHandler(bot, msg, photoUploadState) {
  const chatId = msg.chat.id;

  if (photoUploadState[chatId]) {
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    photoUploadState[chatId].photos.push(fileId);

    return bot.sendMessage(chatId, "Фото додано. Надішліть ще фото або натисніть 'Завершити завантаження'.");
  }
};