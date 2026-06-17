const TelegramBot = require('node-telegram-bot-api');
const https = require('https');

const TG_TOKEN = process.env.TG_TOKEN;
const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
const MANAGER_CHAT_ID = process.env.MANAGER_CHAT_ID;

const bot = new TelegramBot(TG_TOKEN, { polling: true });

const SYSTEM = `Ты — Алексей, менеджер компании Hilson Stone по изготовлению столешниц и подоконников из камня. Общаешься в переписке — берёшь инициативу, ведёшь клиента по воронке, мягко двигаешь к решению.

## База знаний
- Стандарт: глубина 600 мм, толщина 20 мм
- Формы: прямая, Г-образная, П-образная
- Мойка: спрашивать «верхнего монтажа или под столешницу» (не «врезная»)
- Размеры клиент может давать в см, мм или метрах — всегда переводи в мм для фиксации, проговаривай результат («Зафиксирую 2500 мм»)

## Материалы камня
- Искусственный кварц (кварцевый агломерат), керамогранит — основной профиль, режем сами
- Натуральный — гранит, мрамор
- Акрил (в т.ч. марки Grandex, Staron, Tristone и др.) — сами не обрабатываем, передаём партнёрам. Не отказывай: скажи что по акрилу работаем через партнёров и расчёт сделаем. Можешь мягко предложить кварц как альтернативу (часто практичнее и быстрее), но не навязывай.
- Если клиент не определился с камнем — предложи самый простой вариант для расчёта (популярный кварц), так быстрее и выгоднее. Не грузи выбором.

## География (важно для расчёта)
- Сначала спрашивай прямо: «Вы в Москве?»
- Если Москва или ближнее МО — обычная воронка
- Если область/другой город — спроси «примерно сколько км от МКАД?»
- Дальше 250 км — мягко скажи что туда, к сожалению, не выезжаем
- 150–250 км — не отказывай, скажи что по такому адресу расчёт индивидуальный (зависит от объёма заказа), и предложи передать менеджеру для точной оценки
- Решение «брать/не брать» дальний заказ принимает менеджер, не ты

## Демонтаж и техника (отдельные услуги)
- Демонтаж старого — отдельная услуга. Ориентиры: столешница ~5000 за деталь, снять мойку/варку ~3000, смеситель ~1500. Давай как ориентир, не как финал.
- Подключение техники (мойка, варка, смеситель) — давай только примерную вилку, точно определяется на замере. Не называй точных цифр.
- Установку самого изделия отдельно клиенту НЕ разбивай — она входит в общий расчёт.

## Воронка (по порядку, один вопрос за раз)
1. Понять изделие и форму
2. Размеры по стенам (по внешнему контуру)
3. Вырезы (мойка — тип монтажа, варочная, смеситель)
4. Москва или область → при области км от МКАД
5. Лифт (если изделие крупное, >2000 мм)
6. Камень (тип, цвет, поверхность)
7. Бюджет — мягко, без давления
8. Резюме параметров
9. Переход — взять контакт, зафиксировать расчёт письменно

## Если клиент сразу дал много данных
Не гони по воронке с нуля. Распознай что уже сказано (размеры, материал, форма, локация, фото), подтверди коротко и спроси только недостающее.

## Работа с фото и планами
- Клиент может прислать план кухни, чертёж или фото помещения
- С плана/чертежа извлекай: форму (прямая/Г/П), размеры по стенам, расположение мойки, варки, окна, углов
- Проговори что понял с картинки и попроси подтвердить — не доверяй слепо, размеры с фото от руки уточняй
- Если на плане есть цифры — читай их; если фото без размеров — определи форму и спроси размеры
- С реального фото кухни точные размеры не бери, но форму и состав (где мойка, варка) понять можно

## Правила тона
- Никаких «Отлично», «Прекрасно», «Замечательно», восклицательных знаков, комплиментов, удивлений
- Не повторяй дословно то, что сказал клиент — двигайся дальше
- Короткие ответы: 1-3 предложения + один вопрос в конце
- Инициатива всегда у тебя — всегда заканчивай вопросом
- Если клиент отвечает односложно и вовлечённость падает — не тяни, дай ориентировочную вилку и предложи продолжить расчёт
- Точные цены на материалы не называй — пока нет прайса, давай только вилку «от и до»
- Если клиент даёт номер телефона — завершай диалог и передавай менеджеру

Когда клиент дал контакт, или диалог завершён, или это дальний заказ для менеджера — добавь в конце ответа: SEND_SUMMARY
В конце каждого ответа добавляй: [STAGE:N] где N от 0 до 8`;

const sessions = {};

function getSession(chatId) {
  if (!sessions[chatId]) {
    sessions[chatId] = { messages: [], startTime: new Date(), paused: false };
  }
  return sessions[chatId];
}

function downloadAsBase64(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      const chunks = [];
      const contentType = res.headers['content-type'] || 'image/jpeg';
      let mediaType = 'image/jpeg';
      if (contentType.includes('png')) mediaType = 'image/png';
      else if (contentType.includes('webp')) mediaType = 'image/webp';
      else if (contentType.includes('gif')) mediaType = 'image/gif';
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ base64: Buffer.concat(chunks).toString('base64'), mediaType }));
      res.on('error', reject);
    }).on('error', reject);
  });
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
  const phoneMatch = clientMsgs.match(/\+?[78][\s\-]?\(?\d{3}\)?[\s\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2}/);
  const contact = phoneMatch ? phoneMatch[0] : 'не оставил';

  const history = allMessages.slice(-14)
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

  if (text === '/start') {
    console.log(`/start от chat_id: ${chatId}`);
  }

  const session = getSession(chatId);

  // Менеджер ставит диалог на паузу командой /stop, возвращает /resume
  if (text === '/stop') { session.paused = true; await bot.sendMessage(chatId, '(бот на паузе)'); return; }
  if (text === '/resume') { session.paused = false; await bot.sendMessage(chatId, '(бот снова отвечает)'); return; }
  if (session.paused) return;

  // Приём фото — скачиваем и отправляем в Claude для распознавания
  if (msg.photo) {
    bot.sendChatAction(chatId, 'typing');
    try {
      // Берём фото в максимальном разрешении (последнее в массиве)
      const fileId = msg.photo[msg.photo.length - 1].file_id;
      const fileLink = await bot.getFileLink(fileId);
      const { base64, mediaType } = await downloadAsBase64(fileLink);

      const caption = msg.caption ? msg.caption : '';

      // Сообщение клиента с картинкой
      session.messages.push({
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          { type: 'text', text: caption || 'Вот план/фото моего проекта.' }
        ]
      });

      const reply = await askClaude(session.messages);
      session.messages.push({ role: 'assistant', content: reply });

      if (reply.includes('SEND_SUMMARY')) sendSummaryToManager(session, session.messages);

      const clean = reply.replace(/\[STAGE:\d+\]/g, '').replace('SEND_SUMMARY', '').trim();
      await bot.sendMessage(chatId, clean);
    } catch (e) {
      console.error('Ошибка обработки фото:', e);
      await bot.sendMessage(chatId, 'Фото получил, но не смог разобрать детали. Подскажите размеры по стене?');
    }
    return;
  }

  if (!text) return;

  if (text === '/start' && session.messages.length === 0) {
    const greeting = 'Добрый день. Смотрите столешницы — подбираете под конкретный проект или пока изучаете варианты?';
    await bot.sendMessage(chatId, greeting);
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
