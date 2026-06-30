const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const { Telegraf, Markup, session } = require('telegraf');
require('dotenv').config();

const QUESTIONS_FILE = path.join('/data/questions.json');
const AVATARS_DIR = path.join('/data/avatars');
const AVATARS_PUBLIC_PATH = '/avatars';
const AVATAR_SIZE = 256;
const MAX_MESSAGE_LENGTH = 150;
const ANSWER_PREFIX = 'answer';
const MESSAGE_PREFIX = 'message';
const CONFIRM_PREFIX = 'confirm';

const botToken = process.env.BOT_TOKEN;

if (!botToken) {
  throw new Error('BOT_TOKEN is not set. Add it to .env or environment variables.');
}

const bot = new Telegraf(botToken);

bot.use(session({ defaultSession: () => ({}) }));

async function readQuestions() {
  const fileContent = await fs.readFile(QUESTIONS_FILE, 'utf8');
  return JSON.parse(fileContent);
}

async function writeQuestions(questions) {
  const fileContent = JSON.stringify(questions, null, 4);
  await fs.writeFile(QUESTIONS_FILE, `${fileContent}\n`, 'utf8');
}

function getUnansweredQuestionIndexes(questions) {
  return questions
    .map((question, index) => (question.isAnswered ? -1 : index))
    .filter((index) => index !== -1);
}

function getRandomItem(items) {
  const randomIndex = Math.floor(Math.random() * items.length);
  return items[randomIndex];
}

function getUserName(user) {
  const lastName = user.last_name ? ` ${user.last_name}` : '';
  const fullName = `${user.first_name || ''}${lastName}`.trim();
  return fullName || `user_${user.id}`;
}

function getAccountLink(user) {
  const link = user.username ? `https://t.me/${user.username}` : `tg://user?id=${user.id}`;
  return link;
}

async function getUserPicUrl(ctx) {
  let picUrl = '';
  const photos = await ctx.telegram.getUserProfilePhotos(ctx.from.id, 0, 1);

  if (photos.total_count) {
    const photoSizes = photos.photos[0];
    const largestPhoto = photoSizes[photoSizes.length - 1];
    picUrl = await saveUserPic(ctx, largestPhoto.file_id);
  }

  return picUrl;
}

async function downloadFile(fileUrl) {
  const response = await fetch(fileUrl);

  if (!response.ok) {
    throw new Error(`Failed to download file: ${response.status} ${response.statusText}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

async function saveUserPic(ctx, fileId) {
  const fileUrl = await ctx.telegram.getFileLink(fileId);
  const imageBuffer = await downloadFile(fileUrl);
  const fileName = `telegram_${ctx.from.id}.jpg`;
  const filePath = path.join(AVATARS_DIR, fileName);

  await fs.mkdir(AVATARS_DIR, { recursive: true });
  await sharp(imageBuffer)
    .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover' })
    .jpeg({ quality: 85 })
    .toFile(filePath);

  return `${AVATARS_PUBLIC_PATH}/${fileName}`;
}

async function buildAnswererInfo(ctx) {
  const picUrl = await getUserPicUrl(ctx);

  return {
    answererNickname: getUserName(ctx.from),
    answererPicUrl: picUrl,
    answererAccount: getAccountLink(ctx.from),
  };
}

function buildAnswerKeyboard(questionIndex, variants) {
  const buttons = variants.map((variant, index) => [
    Markup.button.callback(variant, `${ANSWER_PREFIX}:${questionIndex}:${index}`),
  ]);

  return Markup.inlineKeyboard(buttons);
}

function buildYesNoKeyboard(prefix) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('Да', `${prefix}:yes`),
      Markup.button.callback('Нет', `${prefix}:no`),
    ],
  ]);
}

function resetSession(ctx) {
  ctx.session.answererInfo = null;
  ctx.session.questionIndex = null;
  ctx.session.answerIndex = null;
  ctx.session.pendingMessage = null;
  ctx.session.waitingForMessage = false;
  ctx.session.messageToEditId = null;
}

async function askQuestionByIndex(ctx, questionIndex) {
  const questions = await readQuestions();
  const question = questions[questionIndex];

  if (!question || question.isAnswered) {
    await ctx.reply('сорри, этот вопрос уже недоступен((\nнажми /start, чтобы взять другой вопрос');
    resetSession(ctx);
    return;
  }

  ctx.session.questionIndex = questionIndex;
  ctx.session.answerIndex = null;
  ctx.session.pendingMessage = null;
  ctx.session.waitingForMessage = false;
  ctx.session.messageToEditId = null;

  await ctx.reply(
    `${question.title}\n\nответь так, как ответила бы Маша`,
    buildAnswerKeyboard(questionIndex, question.variants),
  );
}

async function askRandomQuestion(ctx) {
  const questions = await readQuestions();
  const unansweredIndexes = getUnansweredQuestionIndexes(questions);

  if (!unansweredIndexes.length) {
    await ctx.reply('мне очень жаль, но все вопросы кончились(');
    await ctx.reply('если у тебя есть идеи для вопроса, напиши мне: @the_g00se');
    return;
  }

  const questionIndex = getRandomItem(unansweredIndexes);
  ctx.session.answererInfo = await buildAnswererInfo(ctx);
  await askQuestionByIndex(ctx, questionIndex);
}

async function startDialog(ctx) {
  resetSession(ctx);
  await ctx.reply('привет!\nспасибо за то, что ты не против помочь мне сделать небольшой подарок для Маши\nя уверен, ей будет очень приятно)');
  await ctx.reply('в общем\nмне нужно, чтобы ты попробовал(а) представить, как Маша ответила бы на один вопрос');
  await ctx.reply('не переживай, если ты не уверен(а) в своем ответе)\nответ не обязательно должен быть на 100% совпадающим с тем, что выбрала бы сама Маша, иначе было бы неинтересно)');
  await ctx.reply('сейчас проверю, есть ли вопрос для тебя');
  await askRandomQuestion(ctx);
}

async function saveAnswer(ctx, message) {
  const questions = await readQuestions();
  const question = questions[ctx.session.questionIndex];

  if (!question || question.isAnswered) {
    await ctx.reply('сорри, этот вопрос уже недоступен((\nнажми /start, чтобы взять другой вопрос');
    resetSession(ctx);
    return;
  }

  Object.assign(question, ctx.session.answererInfo, {
    correctAnswerIndex: ctx.session.answerIndex,
    answererMessage: message,
    isAnswered: true,
  });

  await writeQuestions(questions);
  resetSession(ctx);
  await ctx.reply('спасибо! записал ответ)');
  await ctx.reply('если у тебя есть идеи для вопроса, напиши мне: @the_g00se');
}

function buildConfirmText(question, answerIndex, message) {
  const userMessage = message ? `\nСообщение:\n${message}` : '';

  return [
    'Проверь, пожалуйста, все ли правильно:',
    '',
    `Вопрос:\n${question.title}`,
    '',
    `Ответ:\n${question.variants[answerIndex]}`,
    userMessage,
    '',
    'Записать этот ответ?',
  ].join('\n');
}

async function askForConfirmation(ctx, message) {
  const questions = await readQuestions();
  const question = questions[ctx.session.questionIndex];

  if (!question || question.isAnswered) {
    await ctx.reply('сорри, этот вопрос уже недоступен((\nнажми /start, чтобы взять другой вопрос');
    resetSession(ctx);
    return;
}

  ctx.session.pendingMessage = message;
  ctx.session.waitingForMessage = false;
  ctx.session.messageToEditId = null;

  await ctx.reply(
    buildConfirmText(question, ctx.session.answerIndex, message),
    buildYesNoKeyboard(CONFIRM_PREFIX),
  );
}

bot.start(async (ctx) => {
  await startDialog(ctx);
});

bot.action(new RegExp(`^${ANSWER_PREFIX}:(\\d+):(\\d+)$`), async (ctx) => {
  const questionIndex = Number(ctx.match[1]);
  const answerIndex = Number(ctx.match[2]);

  if (ctx.session.questionIndex !== questionIndex) {
    await ctx.answerCbQuery('сорри, этот вопрос уже недоступен((');
    return;
  }

  ctx.session.answerIndex = answerIndex;
  await ctx.answerCbQuery('записал)');
  await ctx.reply(`было бы очень здорово, если бы ты еще и оставил(а) сообщение с пояснением, почему выбрал(а) именно этот вариант\nили просто с поздравлением)\nхочешь?`, buildYesNoKeyboard(MESSAGE_PREFIX));
});

bot.action(new RegExp(`^${MESSAGE_PREFIX}:(yes|no)$`), async (ctx) => {
  const wantsMessage = ctx.match[1] === 'yes';
  await ctx.answerCbQuery();

  if (!ctx.session.answererInfo || ctx.session.answerIndex === null) {
    await ctx.reply('сначала нужно выбрать ответ\nнажми /start, чтобы начать заново.');
    return;
  }

  if (!wantsMessage) {
    await askForConfirmation(ctx, '');
    return;
  }

  ctx.session.waitingForMessage = true;
  await ctx.reply(`напиши сообщение (максимум ${MAX_MESSAGE_LENGTH} символов)`);
});

bot.action(new RegExp(`^${CONFIRM_PREFIX}:(yes|no)$`), async (ctx) => {
  const isConfirmed = ctx.match[1] === 'yes';
  await ctx.answerCbQuery();

  if (!ctx.session.answererInfo || ctx.session.answerIndex === null) {
    await ctx.reply('сначала нужно выбрать ответ\nнажми /start, чтобы начать заново.');
    return;
}

  if (isConfirmed) {
    await saveAnswer(ctx, ctx.session.pendingMessage || '');
    return;
  }

  await askQuestionByIndex(ctx, ctx.session.questionIndex);
});

async function handleAnswererMessage(ctx, text, messageId) {
  const message = text.trim();

  if (message.length > MAX_MESSAGE_LENGTH) {
    ctx.session.messageToEditId = messageId;
    await ctx.reply(`сообщение слишком длинное: ${message.length}/${MAX_MESSAGE_LENGTH}\nпопробуй чуть короче)\nможешь просто изменить сообщение`);
    return;
  }

  ctx.session.messageToEditId = null;
  await askForConfirmation(ctx, message);
}

bot.on('text', async (ctx) => {
  if (!ctx.session.waitingForMessage) {
    await ctx.reply('нажми /start, чтобы начать');
    return;
  }

  await handleAnswererMessage(ctx, ctx.message.text, ctx.message.message_id);
});

bot.on('edited_message', async (ctx) => {
  const message = ctx.editedMessage;

  if (!ctx.session.waitingForMessage || !message.text) {
    return;
  }

  if (ctx.session.messageToEditId !== message.message_id) {
    return;
  }

  await handleAnswererMessage(ctx, message.text, message.message_id);
});

bot.catch((error, ctx) => {
  console.error(`Bot error for update ${ctx.update.update_id}:`, error);
  ctx.reply('мне очень жаль, но все сломалось((\nпопробуй зайти позже');
});

bot.launch();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
