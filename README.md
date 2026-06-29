# Project Maria Bot

Telegram-бот задает пользователю случайный неотвеченный вопрос из `questions.json`,
сохраняет выбранный вариант ответа, данные профиля Telegram и опциональное сообщение.

## Запуск

1. Установите зависимости:

```bash
npm install
```

2. Создайте файл `.env` рядом с `index.js`:

```env
BOT_TOKEN=your_telegram_bot_token_here
```

3. Запустите бота:

```bash
npm start
```

## Формат результата

После ответа бот дописывает в выбранный вопрос:

- `answererNickname`
- `answererPicUrl`
- `answererAccount`
- `correctAnswerIndex`
- `answererMessage`
- `isAnswered: true`
