require('dotenv').config();

function getAdminIds() {
  return (process.env.ADMIN_IDS || '')
    .split(',')
    .map((id) => Number(id.trim()))
    .filter((id) => Number.isInteger(id));
}

function isAdminUser(userId) {
  return getAdminIds().includes(userId);
}

function getBotToken() {
  const botToken = process.env.BOT_TOKEN;

  if (!botToken) {
    throw new Error('BOT_TOKEN is not set. Add it to .env or environment variables.');
  }

  return botToken;
}

module.exports = {
  getBotToken,
  isAdminUser,
};
