const { Telegraf, session } = require('telegraf');
const { setupAdmin } = require('./admin');
const { getBotToken, isAdminUser } = require('./config');
const storage = require('./storage');
const { setupUserFlow } = require('./user_flow');

const BLOCKED_USER_TEXT = 'спасибо за то, что помог с подарком! если что-то не так, напиши @the_g00se';

const bot = new Telegraf(getBotToken());

bot.use(session({ defaultSession: () => ({}) }));
bot.use(async (ctx, next) => {
  if (!ctx.from || isAdminUser(ctx.from.id)) {
    await next();
    return;
  }

  const blockedUsers = await storage.readBlockedUsers();

  if (!blockedUsers.includes(ctx.from.id)) {
    await next();
    return;
  }

  if (ctx.callbackQuery) {
    await ctx.answerCbQuery();
  }

  await ctx.reply(BLOCKED_USER_TEXT);
});

setupAdmin(bot, storage);
setupUserFlow(bot, storage);

bot.catch((error, ctx) => {
  console.error(`Bot error for update ${ctx.update.update_id}:`, error);
  ctx.reply('мне очень жаль, но все сломалось((\nпопробуй зайти позже');
});

bot.launch();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
