const TelegramBot = require('node-telegram-bot-api');
const https = require('https');

const TG_TOKEN = process.env.TG_TOKEN;
const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
const MANAGER_CHAT_ID = process.env.MANAGER_CHAT_ID;

const bot = new TelegramBot(TG_TOKEN, { polling: true });

const SYSTEM = `Ты — Алексей, менеджер компании по изготовлению столешниц и подоконников из камня. Общаешься в Telegram — берёшь инициативу, ведёшь клиента по воронке, мягко двигаешь к решению.

База знаний:
- Стандарт: ширина 600 мм, толщина 20 мм
- Формы: прямая, Г-образная, П-образная
- Мойка: спрашивать «верхнего монтажа или под столешницу» (не «врезная»)
- Искусственный камень (кварц, керамогранит) — целые листы или половинки. Натуральный (гранит, мрамор) — только целые листы
- Стык лучше под варочную панель, не по мойке
- Крупные изделия >2000 мм — предупреждать про лифт
- Размеры клиент может давать в см, мм или метрах — всегда переводи в мм для фиксации
- Не спрашивай про чертёж если клиент уже дал размеры

Воронка (строго по порядку, один вопрос за раз):
1. Понять изделие и форму
2. Размеры по стенам (по внешнему контуру)
3. Вырезы (мойка, варочная, плинтус)
4. Локация и формат (замер+установка, лифт)
5. Камень (тип, цвет, поверхность — предложить 1-2 варианта)
6. Бюджет — мягко, без давления
7. Резюме параметров
8. Переход в мессенджер — зафиксировать расчёт
9. Допродажа из остатков

Правила тона:
- Никаких «Отлично», «Прекрасно», «Замечательно», восклицательных знаков, комплиментов
- Не повторяй то, что сказал клиент — просто двигайся дальше
- Короткие ответы: 1-3 предложения + один вопрос в конце
- Инициатива всегда у тебя
- Если клиент отвечает односложно и вовлечённость падает — не тяни, дай ориентировочную цену и предложи продолжить
- Если клиент даёт номер телефона — завершай диалог и передавай менеджеру

Когда клиент дал контакт или диалог завершён — добавь в конце: SEND_SUMMARY
В конце каждого ответа добавляй: [STAGE:N] где N от 0 до 8`;

const sessions = {};

function getSession(chatId) {
  if (!sessions[chatId]) {
    sessions[chatId] = { messages: [], startTime: new Date() };
  }
  return sessions[chatId];
}

function askClaude(messages) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      system: SYSTEM,
      messages: messages
    });

    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.content?.[0]?.text || 'Что-то пошло не так.');
        } catch (e) { reject(e); }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function sendSummaryToManager(session, allMessages) {
  if (!MANAGER_CHAT_ID) return;

  const duration = Math.round((new Date() - session.startTime) / 60000);
  const clientMsgs = allMessages.filter(m => m.role === 'user').map(m => m.content).join(' ');
  const phoneMatch = clientMsgs.match(/\+?[78][\s\-]?\d{3}[\s\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2}/);
  const contact = phoneMatch ? phoneMatch[0] : 'не оставил';

  const history = allMessages.slice(-12)
    .map(m => `${m.role === 'user' ? '👤' : '🤖'} ${m.content.replace(/\[STAGE:\d+\]/g, '').replace('SEND_SUMMARY', '').trim()}`)
    .join('\n');

  const summary = `📋 Новый клиент — ${new Date().toLocaleString('ru-RU')}
Диалог: ${duration} мин · ${allMessages.filter(m => m.role === 'user').length} сообщений

Контакт: ${contact}

${history}`;

  bot.sendMessage(MANAGER_CHAT_ID, summary).catch(console.error);
}

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  if (!text) return;

  if (text === '/start') {
    console.log(`/start от chat_id: ${chatId}`);
  }

  const session = getSession(chatId);

  if (text === '/start' && session.messages.length === 0) {
    const greeting = 'Добрый день. Смотрите столешницы — подбираете под конкретный проект или пока изучаете варианты? [STAGE:0]';
    await bot.sendMessage(chatId, greeting.replace(/\[STAGE:\d+\]/g, '').trim());
    session.messages.push({ role: 'assistant', content: greeting });
    return;
  }

  session.messages.push({ role: 'user', content: text });
  bot.sendChatAction(chatId, 'typing');

  try {
    const reply = await askClaude(session.messages);
    session.messages.push({ role: 'assistant', content: reply });

    if (reply.includes('SEND_SUMMARY')) {
      sendSummaryToManager(session, session.messages);
    }

    const clean = reply.replace(/\[STAGE:\d+\]/g, '').replace('SEND_SUMMARY', '').trim();
    await bot.sendMessage(chatId, clean);
  } catch (e) {
    console.error('Ошибка:', e);
    await bot.sendMessage(chatId, 'Технический сбой, попробуйте через минуту.');
  }
});

console.log('Бот запущен...');
