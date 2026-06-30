const { Markup } = require('telegraf');
const { isAdminUser } = require('./config');

const ADMIN_PREFIX = 'admin';
const BACK_ACTION = `${ADMIN_PREFIX}:back`;
const CANCEL_ACTION = `${ADMIN_PREFIX}:cancel`;
const SAVE_ACTION = `${ADMIN_PREFIX}:save`;
const COUNT_PREFIX = `${ADMIN_PREFIX}:count`;
const PREVIEW_PREFIX = `${ADMIN_PREFIX}:preview`;
const LONG_VARIANT_MAX_LENGTH = 40;
const SHORT_VARIANT_MAX_LENGTH = 20;

function isAdmin(ctx) {
  return isAdminUser(ctx.from?.id);
}

function isAdminEnabled(ctx) {
  return isAdmin(ctx) && !ctx.session.adminDisabled;
}

function getAdminState(ctx) {
  if (!ctx.session.admin) {
    ctx.session.admin = null;
  }

  return ctx.session.admin;
}

function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}

function pushHistory(state) {
  const snapshot = cloneState({ ...state, history: [] });
  state.history.push(snapshot);
}

function backKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('Назад', BACK_ACTION)],
  ]);
}

function countKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('4', `${COUNT_PREFIX}:4`),
      Markup.button.callback('6', `${COUNT_PREFIX}:6`),
    ],
    [Markup.button.callback('Назад', BACK_ACTION)],
  ]);
}

function confirmKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('Сохранить', SAVE_ACTION)],
    [Markup.button.callback('Назад', BACK_ACTION)],
    [Markup.button.callback('Отмена', CANCEL_ACTION)],
  ]);
}

function previewKeyboard(variants) {
  const buttons = variants.map((variant, index) => [
    Markup.button.callback(variant, `${PREVIEW_PREFIX}:${index}`),
  ]);

  return Markup.inlineKeyboard(buttons);
}

function getVariantLimit(state) {
  return state.variantCount === 4 ? LONG_VARIANT_MAX_LENGTH : SHORT_VARIANT_MAX_LENGTH;
}

function getQuestionType(variantCount) {
  return variantCount === 4 ? 'long' : 'short';
}

function formatQuestionListItem(question, index) {
  const lines = [
    `${index + 1}. ${question.title}`,
    `type: ${question.type}`,
  ];

  if (question.isAnswered) {
    const answer = question.variants[question.correctAnswerIndex] || 'не найден';
    lines.push(`правильный ответ: ${answer}`);
    lines.push(`ответил(а): ${question.answererNickname || 'не указано'}`);
    lines.push(`аккаунт: ${question.answererAccount || 'не указан'}`);
  } else {
    lines.push('ответа пока нет');
  }

  return lines.join('\n');
}

async function sendAdminMenu(ctx) {
  ctx.session.admin = null;
  await ctx.reply('Админ-доступ активен.\n/add_question - добавить вопрос\n/list_questions - посмотреть вопросы');
}

async function promptCurrentStep(ctx) {
  const state = getAdminState(ctx);

  if (!state) {
    await sendAdminMenu(ctx);
    return;
  }

  if (state.step === 'count') {
    await ctx.reply('Выбери количество вариантов ответа:', countKeyboard());
    return;
  }

  if (state.step === 'title') {
    await ctx.reply('Введи текст вопроса:', backKeyboard());
    return;
  }

  if (state.step === 'variant') {
    const variantNumber = state.variants.length + 1;
    const limit = getVariantLimit(state);
    await ctx.reply(`Введи вариант ${variantNumber}/${state.variantCount}. Максимум ${limit} символов.`, backKeyboard());
    return;
  }

  if (state.step === 'confirm') {
    await ctx.reply("Предпросмотр");
    await ctx.reply(
      `${state.title}\n\nответь так, как ответила бы Маша`,
      previewKeyboard(state.variants),
    );
    await ctx.reply(`Тип вопроса: ${state.type}`, confirmKeyboard());
  }
}

async function startQuestionCreation(ctx) {
  ctx.session.admin = {
    step: 'count',
    variantCount: null,
    type: null,
    title: '',
    variants: [],
    history: [],
  };

  await promptCurrentStep(ctx);
}

async function handleBack(ctx) {
  const state = getAdminState(ctx);

  if (!state || !state.history.length) {
    await sendAdminMenu(ctx);
    return;
  }

  const previousState = state.history.pop();
  previousState.history = state.history;
  ctx.session.admin = previousState;
  await promptCurrentStep(ctx);
}

async function handleQuestionCount(ctx, count) {
  const state = getAdminState(ctx);

  if (!state || state.step !== 'count') {
    await ctx.answerCbQuery('Команда неактуальна');
    return;
  }

  pushHistory(state);
  state.variantCount = count;
  state.type = getQuestionType(count);
  state.step = 'title';
  await ctx.answerCbQuery();
  await promptCurrentStep(ctx);
}

async function handleAdminText(ctx, text) {
  const state = getAdminState(ctx);

  if (!state) {
    return false;
  }

  const value = text.trim();

  if (state.step === 'title') {
    if (!value) {
      await ctx.reply('Вопрос не должен быть пустым.', backKeyboard());
      return true;
    }

    pushHistory(state);
    state.title = value;
    state.step = 'variant';
    await promptCurrentStep(ctx);
    return true;
  }

  if (state.step === 'variant') {
    const limit = getVariantLimit(state);

    if (!value) {
      await ctx.reply('Вариант ответа не должен быть пустым.', backKeyboard());
      return true;
    }

    if (value.length > limit) {
      await ctx.reply(`Слишком длинный вариант: ${value.length}/${limit}.`, backKeyboard());
      return true;
    }

    pushHistory(state);
    state.variants.push(value);
    state.step = state.variants.length === state.variantCount ? 'confirm' : 'variant';
    await promptCurrentStep(ctx);
    return true;
  }

  await promptCurrentStep(ctx);
  return true;
}

async function saveQuestion(ctx, storage) {
  const state = getAdminState(ctx);

  if (!state || state.step !== 'confirm') {
    await ctx.answerCbQuery('Команда неактуальна');
    return;
  }

  const questions = await storage.readQuestions();
  questions.push({
    isAnswered: false,
    title: state.title,
    type: state.type,
    variants: state.variants,
  });
  await storage.writeQuestions(questions);

  ctx.session.admin = null;
  await ctx.answerCbQuery('Сохранено');
  await ctx.reply('Вопрос добавлен.');
}

async function listQuestions(ctx, storage) {
  const questions = await storage.readQuestions();

  if (!questions.length) {
    await ctx.reply('Вопросов пока нет.');
    return;
  }

  const chunks = [];
  let currentChunk = '';

  questions.forEach((question, index) => {
    const item = `${formatQuestionListItem(question, index)}\n\n`;

    if ((currentChunk + item).length > 3500) {
      chunks.push(currentChunk);
      currentChunk = '';
    }

    currentChunk += item;
  });

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  for (const chunk of chunks) {
    await ctx.reply(chunk.trim());
  }
}

function setupAdmin(bot, storage) {
  bot.command('admin', async (ctx) => {
    if (!isAdmin(ctx)) {
      await ctx.reply('Нет доступа.');
      return;
    }

    ctx.session.adminDisabled = false;
    await sendAdminMenu(ctx);
  });

  bot.command('unadmin', async (ctx) => {
    if (!isAdmin(ctx)) {
      await ctx.reply('Нет доступа.');
      return;
    }

    ctx.session.admin = null;
    ctx.session.adminDisabled = true;
    await ctx.reply('Админ-режим выключен. Теперь можно пользоваться ботом как обычный человек. Чтобы вернуться, нажми /admin.');
  });

  bot.command('add_question', async (ctx) => {
    if (!isAdminEnabled(ctx)) {
      await ctx.reply('Нет доступа.');
      return;
    }

    await startQuestionCreation(ctx);
  });

  bot.command('list_questions', async (ctx) => {
    if (!isAdminEnabled(ctx)) {
      await ctx.reply('Нет доступа.');
      return;
    }

    await listQuestions(ctx, storage);
  });

  bot.action(new RegExp(`^${COUNT_PREFIX}:(4|6)$`), async (ctx) => {
    if (!isAdminEnabled(ctx)) {
      await ctx.answerCbQuery('Нет доступа');
      return;
    }

    await handleQuestionCount(ctx, Number(ctx.match[1]));
  });

  bot.action(BACK_ACTION, async (ctx) => {
    if (!isAdminEnabled(ctx)) {
      await ctx.answerCbQuery('Нет доступа');
      return;
    }

    await ctx.answerCbQuery();
    await handleBack(ctx);
  });

  bot.action(CANCEL_ACTION, async (ctx) => {
    if (!isAdminEnabled(ctx)) {
      await ctx.answerCbQuery('Нет доступа');
      return;
    }

    ctx.session.admin = null;
    await ctx.answerCbQuery('Отменено');
    await sendAdminMenu(ctx);
  });

  bot.action(SAVE_ACTION, async (ctx) => {
    if (!isAdminEnabled(ctx)) {
      await ctx.answerCbQuery('Нет доступа');
      return;
    }

    await saveQuestion(ctx, storage);
  });

  bot.action(new RegExp(`^${PREVIEW_PREFIX}:\\d+$`), async (ctx) => {
    await ctx.answerCbQuery('Это только предпросмотр');
  });

  bot.on('text', async (ctx, next) => {
    if (!isAdminEnabled(ctx) || !getAdminState(ctx)) {
      await next();
      return;
    }

    await handleAdminText(ctx, ctx.message.text);
  });
}

module.exports = {
  setupAdmin,
};
