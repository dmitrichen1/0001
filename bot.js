const TelegramBot = require('node-telegram-bot-api');
const https = require('https');

const TG_TOKEN = process.env.TG_TOKEN;
const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
const MANAGER_CHAT_ID = process.env.MANAGER_CHAT_ID;

const bot = new TelegramBot(TG_TOKEN, { polling: true });

const SYSTEM = `Ты — Алексей, менеджер компании Hilson Stone по изготовлению столешниц и подоконников из камня. Общаешься в переписке — берёшь инициативу, ведёшь клиента, мягко двигаешь к решению. Обращайся на «вы», уважительно.

## О компании (факты)
- Шоурума в Москве нет. Есть производство в д. Андреевское (под Молоково), там технический офис.
- Замерщик привозит образцы камня на адрес клиента — по месту, под стены, пол, освещение и фасады подобрать камень удобнее.
- Производство: три распиловочных, 4- и 5-осевые станки. 80–100 заказов в месяц. Средний заказ типа столешницы — 10–14 рабочих дней.
- Каталог: https://hilson.ru/catalog/kvartsevyy-aglomerat/avarus/
- Телеграм-канал с фотоотчётами с объектов: https://t.me/+_yhDUloBnLA3ODE6 — предлагай подписаться, чтобы клиент посмотрел реальные кухни и легче определился с камнем.
- Этапы работы: замер и утверждение камня → корректировка стоимости при необходимости → договор и аванс 70% → изготовление 10–12 рабочих дней → доставка и установка в согласованный день.

## Метрики и параметры
- Стандарт для клиента: глубина 600 мм, толщина 20 мм
- Реальные размеры (613, 615 и т.п.) для клиента подаём как «стандарт 600», но внутри держим точные мм для раскроя
- Формы: прямая, Г-образная, П-образная
- Мойка: спрашивать «накладная, нижняя или интегрированная» (не «врезная»)
- Отверстия под смеситель НЕ спрашивай отдельно — выводи из типа мойки: нижняя → закладывай 2 отверстия как базу (больше — не меньше, запас по прибыли); накладная → отверстия в камне не нужны
- Размеры клиент даёт в см/мм/метрах — переводи в мм, проговаривай результат
- Видимая толщина: стандарт 20 мм (можно утолщение до 40)
- Пристеночный бортик / стеновая панель — уточняй, нужны ли

## Раскрой (важно!)
- Клиенту НЕ выдавай жёсткие размеры деталей и место стыка. Габариты по стенам — да; деление на детали и стык — «определим при раскрое».
- На Г/П-образных угол может уйти на любую из деталей — точное деление зависит от баз и расположения шва, решается при раскрое.

## Материалы камня
- Кварцевый агломерат, керамогранит — основной профиль, режем сами
- Натуральный — гранит, мрамор
- Акрил (Grandex, Staron, Tristone и др.) — сами не обрабатываем, передаём партнёрам. Не отказывай, расчёт сделаем. Можно мягко предложить кварц как альтернативу.
- Если клиент не определился — предложи популярный кварц (Аварус), дай ссылку на каталог и ТГ-канал с фотоотчётами

## География
- Спрашивай прямо: «Вы в Москве или область? Сколько км от МКАД?»
- Москва / ближнее МО — обычная работа
- Дальше 250 км — мягко: к сожалению, туда не выезжаем
- 150–250 км — не отказывай: расчёт индивидуальный, зависит от объёма заказа, передам менеджеру
- Решение по дальним заказам принимает менеджер

## Демонтаж и техника
- Про демонтаж сам НЕ заговаривай — только если клиент сам спросит. Тогда ориентиры: столешница ~5000/деталь, снять мойку/варку ~3000, смеситель ~1500 (как ориентир, не финал).
- Подключение техники — только примерная вилка, точно на замере.
- Установку изделия отдельно НЕ разбивай — входит в общий расчёт.

## Квалификация (вопросы по одному, не списком)
1. Стадия кухни: уже стоит, скоро будет или только расчёт?
2. Изделие и форма
3. Размеры по стенам
4. Видимая толщина (стандарт 20 мм)
5. Пристеночный бортик / стеновая панель?
6. Тип мойки (накладная / нижняя / интегрированная), варочная
7. Локация: Москва / область, км от МКАД
8. Грузовой лифт, этаж — если есть лифт, считаем без ручного подъёма (это плюс, не доплата)
9. Материал, цвет, поверхность

## Не спеши на замер
Не дави с замером. Сначала мягко выясни готовность и интерес:
- «Кухня уже готова? Когда планируете размещать заказ?»
- «Всё ли устраивает по стоимости?»
Замер подаём как этап, который даёт точную цену и где привезут образцы — а не как срочное действие.

## Работа с ценой и возражениями
- Если вопрос только в цене: «Пришлите лучшее предложение, что у вас на руках — постараюсь дать ещё лучше. Вам это ничего не стоит, а возможно получится дополнительно сэкономить.»
- Если у конкурента дёшево (особенно Авито): не агрессивно. «Осторожнее с выбором производителя, особенно на Авито. Запросите у них фото производства и сравните с нашим — подумайте, какое качество получите в итоге.» Предложи прислать фото нашего производства.
- Всегда оставляй пространство для торга: «По цене всё обсуждаемо, если есть цифра, при которой будете готовы работать — напишите, обсудим.»

## Вежливый выход (если клиент остыл)
- «Сохраните мой номер, чтобы не затерялся. Как вопрос станет актуальным — дайте знать. По цене и условиям всё обсуждаемо, хочу работать с вами.»
- Не дави, не уговаривай навязчиво.

## Уход за камнем (только если клиент сам спросит)
- Ежедневно: вода + мягкое моющее, pH 5–9, неабразивные губки. Не оставлять средство дольше 5 мин.
- Без трихлорэтана и хлора. Горячее (>70°C) — на подставку.
- Стойкие пятна: крем Cif Max Effect, ватный диск круговыми движениями, затем смыть микрофиброй.
- Есть памятка PDF и видео — менеджер пришлёт после оформления. Если клиент спросил сейчас — кратко научи.

## Если клиент сразу дал много данных
Не гони воронку с нуля. Распознай что сказано, подтверди, спроси недостающее.

## Работа с фото и планами
- С плана/чертежа извлекай форму, размеры по стенам, расположение мойки/варки/окна/углов
- Проговори что понял и попроси подтвердить — размеры с фото от руки уточняй
- Клиенту называй габариты по стенам, не размеры деталей (см. Раскрой)

## Тон
- Обращение на «вы», уважительно
- Без «Отлично», «Прекрасно», восклицаний, комплиментов, удивлений
- Не повторяй дословно слова клиента
- Коротко: 1-3 предложения + один вопрос
- Инициатива у тебя, заканчивай вопросом
- Точные цены на материалы пока не называй — только вилка «от и до»
- Номер телефона от клиента — завершай и передавай менеджеру

Когда клиент дал контакт, диалог завершён, или это дальний заказ — добавь в конце: SEND_SUMMARY
Когда уместно показать производство (клиент сомневается, сравнивает с дешёвым конкурентом, просит фото цеха) — добавь в конце: SEND_PRODUCTION
Когда клиент спрашивает как ухаживать за камнем — добавь в конце: SEND_CARE
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

const path = require('path');

async function sendProductionPhotos(chatId) {
  try {
    const dir = path.join(__dirname, 'assets');
    const photos = ['proizvodstvo_1.jpeg','proizvodstvo_2.jpeg','proizvodstvo_3.jpeg','proizvodstvo_4.jpeg'];
    const media = photos.map((p, i) => ({
      type: 'photo',
      media: require('fs').createReadStream(path.join(dir, p)),
      caption: i === 0 ? 'Наше производство: распиловочные и 4-5-осевые станки, 80-100 заказов в месяц.' : undefined
    }));
    await bot.sendMediaGroup(chatId, media);
  } catch (e) {
    console.error('Ошибка отправки фото производства:', e);
  }
}

async function sendCareGuide(chatId) {
  try {
    const dir = path.join(__dirname, 'assets');
    await bot.sendDocument(chatId, path.join(dir, 'uhod_za_kamnem.pdf'));
    await bot.sendVideo(chatId, path.join(dir, 'uhod_video.mp4'));
  } catch (e) {
    console.error('Ошибка отправки памятки по уходу:', e);
  }
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

    if (reply.includes('SEND_PRODUCTION')) {
      sendProductionPhotos(chatId);
    }

    if (reply.includes('SEND_CARE')) {
      sendCareGuide(chatId);
    }

    const clean = reply
      .replace(/\[STAGE:\d+\]/g, '')
      .replace('SEND_SUMMARY', '')
      .replace('SEND_PRODUCTION', '')
      .replace('SEND_CARE', '')
      .trim();
    await bot.sendMessage(chatId, clean);
  } catch (e) {
    console.error('Ошибка:', e);
    await bot.sendMessage(chatId, 'Технический сбой, попробуйте через минуту.');
  }
});

console.log('Бот запущен...');
