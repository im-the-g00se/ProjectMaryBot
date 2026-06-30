const fs = require('node:fs/promises');

const DATA_DIR = '/data';
const QUESTIONS_FILE = '/data/questions.json';
const BLOCKED_USERS_FILE = '/data/blocked_users.json';

async function readJsonArray(filePath) {
  try {
    const fileContent = await fs.readFile(filePath, 'utf8');
    return JSON.parse(fileContent);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }

    await writeJsonArray(filePath, []);
    return [];
  }
}

async function writeJsonArray(filePath, items) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const fileContent = JSON.stringify(items, null, 4);
  await fs.writeFile(filePath, `${fileContent}\n`, 'utf8');
}

async function readQuestions() {
  return readJsonArray(QUESTIONS_FILE);
}

async function writeQuestions(questions) {
  await writeJsonArray(QUESTIONS_FILE, questions);
}

async function readBlockedUsers() {
  return readJsonArray(BLOCKED_USERS_FILE);
}

async function blockUser(userId) {
  const blockedUsers = await readBlockedUsers();

  if (blockedUsers.includes(userId)) {
    return;
  }

  blockedUsers.push(userId);
  await writeJsonArray(BLOCKED_USERS_FILE, blockedUsers);
}

module.exports = {
  blockUser,
  readBlockedUsers,
  readQuestions,
  writeQuestions,
};
