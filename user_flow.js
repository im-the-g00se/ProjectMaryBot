const { Markup } = require('telegraf');
const { getUserAvatarPath } = require('./avatars');
const { isAdminUser } = require('./config');

const MAX_MESSAGE_LENGTH = 150;
const ANSWER_PREFIX = 'answer';
const MESSAGE_PREFIX = 'message';
const CONFIRM_PREFIX = 'confirm';

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
  return user.username ? `https://t.me/${user.username}` : `tg://user?id=${user.id}`;
}

async function buildAnswererInfo(ctx) {
  const avatarPath = await getUserAvatarPath(ctx);

  return {
    answererNickname: getUserName(ctx.from),
    answererPicUrl: avatarPath,
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

function resetUserSession(ctx) {
  ctx.session.answererInfo = null;
  ctx.session.questionIndex = null;
  ctx.session.answerIndex = null;
  ctx.session.pendingMessage = null;
  ctx.session.waitingForMessage = false;
  ctx.session.messageToEditId = null;
}

function buildConfirmText(question, answerIndex, message) {
  const userMessage = message ? `\nсообщение:\n${message}` : '';

  return [
    'проверь, пожалуйста, все ли правильно:',
    '',
    `вопрос:\n${question.title}`,
    '',
    `ответ:\n${question.variants[answerIndex]}`,
    userMessage,
    '',
    'записать этот ответ?',
  ].join('\n');
}

async function askQuestionByIndex(ctx, storage, questionIndex) {
  const questions = await storage.readQuestions();
  const question = questions[questionIndex];

  if (!question || question.isAnswered) {
    await ctx.reply('сорри, этот вопрос уже недоступен((\nнажми /start, чтобы взять другой вопрос');
    resetUserSession(ctx);
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

async function askRandomQuestion(ctx, storage) {
  const questions = await storage.readQuestions();
  const unansweredIndexes = getUnansweredQuestionIndexes(questions);

  if (!unansweredIndexes.length) {
    await ctx.reply('мне очень жаль, но все вопросы кончились(');
    await ctx.reply('если у тебя есть идеи для вопроса, напиши мне: @the_g00se');
    return;
  }

  const questionIndex = getRandomItem(unansweredIndexes);
  ctx.session.answererInfo = await buildAnswererInfo(ctx);
  await askQuestionByIndex(ctx, storage, questionIndex);
}

async function startDialog(ctx, storage) {
  resetUserSession(ctx);
  await ctx.reply('привет!\nспасибо за то, что ты не против помочь мне сделать небольшой подарок для Маши\nя уверен, ей будет очень приятно)');
  await ctx.reply('в общем\nмне нужно, чтобы ты попробовал(а) представить, как Маша ответила бы на один вопрос');
  await ctx.reply('не переживай, если ты не уверен(а) в своем ответе)\nответ не обязательно должен быть на 100% совпадающим с тем, что выбрала бы сама Маша, иначе было бы неинтересно)');
  await ctx.reply('сейчас проверю, есть ли вопрос для тебя');
  await askRandomQuestion(ctx, storage);
}

async function saveAnswer(ctx, storage, message) {
  const questions = await storage.readQuestions();
  const question = questions[ctx.session.questionIndex];

  if (!question || question.isAnswered) {
    await ctx.reply('сорри, этот вопрос уже недоступен((\nнажми /start, чтобы взять другой вопрос');
    resetUserSession(ctx);
    return;
  }

  Object.assign(question, ctx.session.answererInfo, {
    correctAnswerIndex: ctx.session.answerIndex,
    answererMessage: message,
    isAnswered: true,
  });

  await storage.writeQuestions(questions);

  if (!isAdminUser(ctx.from.id)) {
    await storage.blockUser(ctx.from.id);
  }

  resetUserSession(ctx);
  await ctx.reply('спасибо! записал ответ)');
  await ctx.reply('если у тебя есть идеи для вопроса, напиши мне: @the_g00se');
}

async function askForConfirmation(ctx, storage, message) {
  const questions = await storage.readQuestions();
  const question = questions[ctx.session.questionIndex];

  if (!question || question.isAnswered) {
    await ctx.reply('сорри, этот вопрос уже недоступен((\nнажми /start, чтобы взять другой вопрос');
    resetUserSession(ctx);
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

async function handleAnswererMessage(ctx, storage, text, messageId) {
  const message = text.trim();

  if (message.length > MAX_MESSAGE_LENGTH) {
    ctx.session.messageToEditId = messageId;
    await ctx.reply(`сообщение слишком длинное: ${message.length}/${MAX_MESSAGE_LENGTH}\nпопробуй чуть короче)\nможешь просто изменить сообщение`);
    return;
  }

  ctx.session.messageToEditId = null;
  await askForConfirmation(ctx, storage, message);
}

function setupUserFlow(bot, storage) {
  bot.start(async (ctx) => {
    await startDialog(ctx, storage);
  });

  bot.action(new RegExp(`^${ANSWER_PREFIX}:(\\d+):(\\d+)$`), async (ctx) => {
    const questionIndex = Number(ctx.match[1]);
    const answerIndex = Number(ctx.match[2]);

    if (ctx.session.questionIndex !== questionIndex) {
      await ctx.answerCbQuery('сорри, этот вопрос уже недоступен((');
      return;
    }

    ctx.session.answerIndex = answerIndex;
    await ctx.answerCbQuery('принято)');
    await ctx.reply(
      'было бы очень здорово, если бы ты еще и оставил(а) сообщение с пояснением, почему выбрал(а) именно этот вариант\nили просто с поздравлением)\nхочешь?',
      buildYesNoKeyboard(MESSAGE_PREFIX),
    );
  });

  bot.action(new RegExp(`^${MESSAGE_PREFIX}:(yes|no)$`), async (ctx) => {
    const wantsMessage = ctx.match[1] === 'yes';
    await ctx.answerCbQuery();

    if (!ctx.session.answererInfo || ctx.session.answerIndex === null) {
      await ctx.reply('сначала нужно выбрать ответ\nнажми /start, чтобы начать заново.');
      return;
    }

    if (!wantsMessage) {
      await askForConfirmation(ctx, storage, '');
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
      await saveAnswer(ctx, storage, ctx.session.pendingMessage || '');
      return;
    }

    await askQuestionByIndex(ctx, storage, ctx.session.questionIndex);
  });

  bot.on('text', async (ctx) => {
    if (!ctx.session.waitingForMessage) {
      await ctx.reply('нажми /start, чтобы начать');
      return;
    }

    await handleAnswererMessage(ctx, storage, ctx.message.text, ctx.message.message_id);
  });

  bot.on('edited_message', async (ctx) => {
    const message = ctx.editedMessage;

    if (!ctx.session.waitingForMessage || !message.text) {
      return;
    }

    if (ctx.session.messageToEditId !== message.message_id) {
      return;
    }

    await handleAnswererMessage(ctx, storage, message.text, message.message_id);
  });
}

module.exports = {
  setupUserFlow,
};
