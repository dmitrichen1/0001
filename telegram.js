'use strict';

const TelegramBot = require('node-telegram-bot-api');
const https = require('https');
const path = require('path');
const fs = require('fs');
const core = require('./core.js');

const TG_TOKEN        = process.env.TG_TOKEN;
const MANAGER_CHAT_ID = process.env.MANAGER_CHAT_ID;

const bot = new TelegramBot(TG_TOKEN, { polling: true });

bot.on('polling_error', (err) => {
  if (err.code === 'ETELEGRAM' && /409/.test(err.message)) {
    console.error('⚠️ Конфликт polling — запущен второй экземпляр. Остановите лишний деплой.');
  } else {
    console.error('polling_error:', err.code, err.message);
  }
});

// ─── Утилиты отправки ──────────────────────────────────────────────────────

async function sendParts(chatId, parts) {
  for (let i = 0; i < parts.length; i++) {
    if (i > 0) {
      bot.sendChatAction(chatId, 'typing');
      await new Promise(r => setTimeout(r, 700));
    }
    try {
      await bot.sendMessage(chatId, parts[i], { parse_mode: 'Markdown' });
    } catch {
      await bot.sendMessage(chatId, parts[i]);
    }
  }
}

function downloadAsBase64(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      const chunks = [];
      const contentType = res.headers['content-type'] || 'image/jpeg';
      let mediaType = 'image/jpeg';
      if (contentType.includes('png'))  mediaType = 'image/png';
      if (contentType.includes('webp')) mediaType = 'image/webp';
      if (contentType.includes('gif'))  mediaType = 'image/gif';
      res.on('data', c => chunks.push(c));
      res.on('end',  () => resolve({ base64: Buffer.concat(chunks).toString('base64'), mediaType }));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// ─── Медиа-функции ─────────────────────────────────────────────────────────

async function sendProductionPhotos(chatId) {
  try {
    const dir = path.join(__dirname, 'assets');
    const photos = ['proizvodstvo_1.jpeg','proizvodstvo_2.jpeg','proizvodstvo_3.jpeg','proizvodstvo_4.jpeg'];
    const media = photos.map((p, i) => ({
      type: 'photo',
      media: fs.createReadStream(path.join(dir, p)),
      caption: i === 0 ? 'Наше производство: распиловочные и 4-5-осевые станки, 80-100 заказов в месяц.' : undefined
    }));
    await bot.sendMediaGroup(chatId, media);
  } catch (e) { console.error('Ошибка отправки фото производства:', e); }
}

async function sendCareGuide(chatId) {
  try {
    const dir = path.join(__dirname, 'assets');
    await bot.sendDocument(chatId, path.join(dir, 'uhod_za_kamnem.pdf'));
    await bot.sendVideo(chatId, path.join(dir, 'uhod_video.mp4'));
  } catch (e) { console.error('Ошибка отправки памятки по уходу:', e); }
}

async function sendEdges(chatId, material) {
  try {
    const dir = path.join(__dirname, 'assets');
    const file    = material === 'akril' ? 'kromki_akril.jpg' : 'kromki_kvarc.jpg';
    const caption = material === 'akril'
      ? 'Варианты кромки для акрила — 4 профиля.'
      : 'Варианты кромки для кварца, гранита и мрамора — 12 профилей.';
    await bot.sendPhoto(chatId, path.join(dir, file), { caption });
  } catch (e) { console.error('Ошибка отправки фото кромок:', e); }
}

// ─── Уведомления менеджеру ─────────────────────────────────────────────────

function toManager(text, opts) {
  if (!MANAGER_CHAT_ID) return;
  return bot.sendMessage(MANAGER_CHAT_ID, text, opts).catch(console.error);
}

function alertManager(clientId, session, rawReply) {
  const name = session.clientName || `клиент ${clientId}`;
  const clientMsgs = session.messages.filter(m => m.role === 'user');
  const lastClient = clientMsgs.length
    ? (typeof clientMsgs[clientMsgs.length - 1].content === 'string'
        ? clientMsgs[clientMsgs.length - 1].content
        : '[фото/чертёж]')
    : '';
  const history = session.messages.slice(-8)
    .map(m => {
      const txt = typeof m.content === 'string' ? m.content : '[медиа]';
      return `${m.role === 'user' ? '👤' : '🤖'} ${txt.replace(/\[STAGE:\d+\]/g, '').replace(/[A-Z_]+MANAGER|SEND_\w+/g, '').trim()}`;
    })
    .join('\n');
  toManager(
    `🚨 ТРЕБУЕТСЯ ВЫ — ${name}\nПоследнее от клиента: "${lastClient}"\n\n${history}`,
    { reply_markup: { inline_keyboard: [[
      { text: `✍️ Ответить (${name})`, callback_data: `reply_${clientId}` },
      { text: '▶️ Вернуть боту',       callback_data: `resume_${clientId}` }
    ]]}}
  );
}

function sendSummaryToManager(sessionId, session) {
  const duration   = Math.round((new Date() - session.startTime) / 60000);
  const clientMsgs = session.messages.filter(m => m.role === 'user')
                       .map(m => typeof m.content === 'string' ? m.content : '').join(' ');
  const phoneMatch = clientMsgs.match(/\+?[78][\s\-]?\(?\d{3}\)?[\s\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2}/);
  const contact    = phoneMatch ? phoneMatch[0] : 'не оставил';
  const history    = session.messages.slice(-14)
    .map(m => {
      const txt = typeof m.content === 'string' ? m.content : '[медиа]';
      return `${m.role === 'user' ? '👤' : '🤖'} ${txt.replace(/\[STAGE:\d+\]/g, '').replace('SEND_SUMMARY','').trim()}`;
    })
    .join('\n');

  toManager(
    `📋 Новый клиент — ${new Date().toLocaleString('ru-RU')}\n` +
    `Диалог: ${duration} мин · ${session.messages.filter(m => m.role==='user').length} сообщений\n\n` +
    `Контакт: ${contact}\n\n${history}`
  );
}

// ─── Обработка событий ядра ────────────────────────────────────────────────

async function handleEvents(chatId, events) {
  for (const ev of events) {
    const { type, payload } = ev;
    const N = core.NOTIFY;

    if (type === N.ALERT) {
      alertManager(chatId, payload.session, payload.rawReply);
    }
    else if (type === N.SUMMARY) {
      sendSummaryToManager(chatId, payload.session);
    }
    else if (type === N.CALC_RESULT) {
      if (!MANAGER_CHAT_ID) continue;
      const p = payload;
      const contacts = [
        p.session.clientUsername ? `Ник: ${p.session.clientUsername}` : null,
        p.session.clientPhone    ? `Тел: ${p.session.clientPhone}`    : null,
        `ID: ${chatId}`
      ].filter(Boolean).join(' · ');
      const stoneNote = p.priceFrom ? `\nКамень: ${p.usedStone} (цена ОТ, клиент не выбрал)` : '';
      toManager(
        `💰 Расчёт — ${p.session.clientName || chatId}\n` +
        `${contacts}${stoneNote}\n` +
        `Раскрой: ${p.cutDesc} (увер. ${p.confidence}%)\n` +
        `Цена клиенту: ${p.priceClient} ₽\n` +
        `Грязная прибыль: ${p.profit.toLocaleString('ru-RU')} ₽ (${p.profitPct}%)`
      );
    }
    else if (type === N.CALC_ERROR) {
      toManager(`⚠️ Не удалось посчитать для ${payload.session.clientName || chatId}: ${payload.error}`);
    }
    else if (type === N.SEND_PRODUCTION) {
      await sendProductionPhotos(chatId);
    }
    else if (type === N.SEND_CARE) {
      await sendCareGuide(chatId);
    }
    else if (type === N.SEND_EDGES) {
      await sendEdges(chatId, payload.material);
    }
  }
}

// ─── Режим ответа менеджера ────────────────────────────────────────────────

let managerReplyTarget = null;

bot.on('callback_query', async (q) => {
  if (String(q.message.chat.id) !== String(MANAGER_CHAT_ID)) return;
  const data = q.data || '';

  if (data.startsWith('reply_')) {
    const clientId = data.slice(6);
    managerReplyTarget = clientId;
    const session = core.getSession(clientId);
    const name    = session.clientName || `клиент ${clientId}`;
    await bot.answerCallbackQuery(q.id);
    await toManager(`✍️ Напишите ответ для: ${name}\n(следующее ваше сообщение уйдёт ему от имени бота)`);
  }
  else if (data.startsWith('resume_')) {
    const clientId = data.slice(7);
    core.resumeSession(clientId);
    if (managerReplyTarget === clientId) managerReplyTarget = null;
    await bot.answerCallbackQuery(q.id, { text: 'Бот снова ведёт клиента' });
    await toManager(`▶️ Бот снова ведёт клиента ${clientId}`);
  }
});

// ─── Приём сообщений ───────────────────────────────────────────────────────

bot.on('message', async (msg) => {
  const chatId = String(msg.chat.id);
  const text   = msg.text;

  // /myid
  if (text === '/myid') {
    await bot.sendMessage(chatId, `Ваш chat_id: ${chatId}\nТип чата: ${msg.chat.type}`);
    return;
  }

  // ─── Команды менеджера ────────────────────────────────────────────────
  if (MANAGER_CHAT_ID && chatId === String(MANAGER_CHAT_ID) && text) {

    // Режим ответа: следующее сообщение менеджера уходит клиенту
    if (managerReplyTarget && !text.startsWith('/')) {
      const clientId = managerReplyTarget;
      managerReplyTarget = null;
      try {
        await bot.sendMessage(clientId, text);
        core.injectManagerMessage(clientId, text);
        const session = core.getSession(clientId);
        const name    = session.clientName || `клиент ${clientId}`;
        await toManager(`✓ отправлено: ${name}`, { reply_markup: { inline_keyboard: [[
          { text: `✍️ Ещё ответить (${name})`, callback_data: `reply_${clientId}`  },
          { text: '▶️ Вернуть боту',            callback_data: `resume_${clientId}` }
        ]]}});
      } catch (e) {
        await toManager(`✗ не удалось отправить: ${e.message}`);
      }
      return;
    }

    // /reply <id> <текст>
    const mReply = text.match(/^\/reply\s+(\d+)\s+([\s\S]+)/);
    if (mReply) {
      const [, clientId, replyText] = mReply;
      try {
        await bot.sendMessage(clientId, replyText);
        core.injectManagerMessage(clientId, replyText);
        await toManager(`✓ отправлено клиенту ${clientId}`);
      } catch (e) {
        await toManager(`✗ не удалось отправить: ${e.message}`);
      }
      return;
    }

    // /resume <id>
    const mResume = text.match(/^\/resume\s+(\d+)/);
    if (mResume) {
      core.resumeSession(mResume[1]);
      await toManager(`▶ бот снова ведёт клиента ${mResume[1]}`);
      return;
    }

    // /take <id>
    const mTake = text.match(/^\/take\s+(\d+)/);
    if (mTake) {
      core.pauseSession(mTake[1]);
      await toManager(`⏸ вы ведёте клиента ${mTake[1]}, бот молчит`);
      return;
    }
  }

  // ─── /start ───────────────────────────────────────────────────────────
  if (text === '/start') {
    console.log(`/start от chat_id: ${chatId}`);
    const clientName = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ')
      || (msg.from?.username ? '@' + msg.from.username : null)
      || `клиент ${chatId}`;
    const clientUsername = msg.from?.username ? '@' + msg.from.username : null;

    const result = core.handleStart(chatId, { clientName, clientUsername });
    if (result) await sendParts(chatId, result.parts);
    return;
  }

  // ─── Фото / чертёж ────────────────────────────────────────────────────
  if (msg.photo) {
    bot.sendChatAction(chatId, 'typing');
    try {
      const fileId   = msg.photo[msg.photo.length - 1].file_id;
      const fileLink = await bot.getFileLink(fileId);
      const { base64, mediaType } = await downloadAsBase64(fileLink);

      const clientName     = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ') || `клиент ${chatId}`;
      const clientUsername = msg.from?.username ? '@' + msg.from.username : null;

      const { parts, events } = await core.handleMessage(chatId, null, {
        imageBase64:    base64,
        imageMediaType: mediaType,
        imageCaption:   msg.caption || 'Вот план/фото моего проекта.',
        clientName,
        clientUsername
      });

      await handleEvents(chatId, events);
      if (parts.length) await sendParts(chatId, parts);
    } catch (e) {
      console.error('Ошибка обработки фото:', e);
      await bot.sendMessage(chatId, 'Фото получил, но не смог разобрать детали. Подскажите размеры по стене?');
    }
    return;
  }

  if (!text) return;

  // ─── Текстовое сообщение ──────────────────────────────────────────────
  const clientName     = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ')
    || (msg.from?.username ? '@' + msg.from.username : null)
    || `клиент ${chatId}`;
  const clientUsername = msg.from?.username ? '@' + msg.from.username : null;

  bot.sendChatAction(chatId, 'typing');
  try {
    const { parts, events } = await core.handleMessage(chatId, text, { clientName, clientUsername });
    await handleEvents(chatId, events);
    if (parts.length) await sendParts(chatId, parts);
  } catch (e) {
    console.error('Ошибка:', e);
    try { await bot.sendMessage(chatId, 'Секунду, уточняю детали — вернусь к вам с ответом.'); } catch (_) {}
  }
});

console.log('Hilson Stone бот запущен (Telegram)...');
