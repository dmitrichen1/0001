const https = require('https');
const fs = require('fs');
const path = require('path');

// ─── Прайсы ──────────────────────────────────────────────────────
const PRICE = JSON.parse(fs.readFileSync(path.join(__dirname, 'price.json'), 'utf-8'));
const WORKS = JSON.parse(fs.readFileSync(path.join(__dirname, 'works.json'), 'utf-8'));

// Поиск работы по части названия
function work(part) {
  const p = part.toLowerCase();
  return WORKS.find(w => w.name.toLowerCase().includes(p));
}
// Себестоимость операции (цех+монтаж+расходники)
function workCost(w) { return (w.tseh||0)+(w.montazh||0)+(w.rashod||0); }

// ─── Константы формулы ───────────────────────────────────────────
const MIN_USD = 85;        // минимальный курс доллара
const MIN_EUR = 95;        // минимальный курс евро
const RATE_BUFFER = 1.08;  // запас на курс (5% + буфер на наценку поставщика)
const MARKUP = 1 / (1 - 0.25); // навар 25% изнутри = 1.3333
const CUT_HALF = 1000 + 1000;  // распил половинки: 1000 поставщику + 1000 наша (за половинку)
const DELIVERY = 6000;     // доставка за бренд

// ─── Курс ЦБ (кэш на сутки) ──────────────────────────────────────
let rateCache = { usd: null, eur: null, ts: 0 };

function fetchCbrRates() {
  return new Promise((resolve) => {
    if (Date.now() - rateCache.ts < 12 * 3600 * 1000 && rateCache.usd) {
      return resolve(rateCache);
    }
    https.get('https://www.cbr-xml-daily.ru/daily_json.js', (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          rateCache = {
            usd: j.Valute.USD.Value,
            eur: j.Valute.EUR.Value,
            ts: Date.now()
          };
        } catch (e) {
          // если не достали — используем планку
          rateCache = { usd: MIN_USD, eur: MIN_EUR, ts: Date.now() };
        }
        resolve(rateCache);
      });
    }).on('error', () => {
      rateCache = { usd: MIN_USD, eur: MIN_EUR, ts: Date.now() };
      resolve(rateCache);
    });
  });
}

// Рабочий курс: max(ЦБ, планка) × буфер
async function workingRate(currency) {
  const r = await fetchCbrRates();
  if (currency === '€' || currency === 'EUR' || currency === 'eur') {
    return Math.max(r.eur, MIN_EUR) * RATE_BUFFER;
  }
  return Math.max(r.usd, MIN_USD) * RATE_BUFFER;
}

// ─── Поиск камня по названию/артикулу ────────────────────────────
function normalize(s) { return (s || '').toLowerCase().replace(/ё/g, 'е').trim(); }
// слова-шум, которые клиент/бот добавляют, но они мешают поиску
const NOISE_WORDS = ['аварус','авант','авангард','нобл','ноble','noble','quartz','кварц','цезарь','caesarstone','цезарстоун',
  'глянец','глянцевый','матовый','мат','полированный','камень','столешница','коллекция','авант кварц','avarus','avant'];
function findStone(query) {
  let q = normalize(query);
  if (!q) return []; // пустой запрос — ничего
  // прямое совпадение
  let result = PRICE.filter(p =>
    normalize(p.name).includes(q) || normalize(p.article).includes(q) || normalize(p.brand).includes(q)
  );
  if (result.length) return result;
  // убираем шумовые слова и пробуем по оставшимся ключевым словам
  let words = q.split(/\s+/).filter(w => w && !NOISE_WORDS.includes(w));
  if (words.length) {
    const cleaned = words.join(' ');
    result = PRICE.filter(p => normalize(p.name).includes(cleaned));
    if (result.length) return result;
    // совпадение по всем оставшимся словам в названии (в любом порядке)
    result = PRICE.filter(p => {
      const name = normalize(p.name);
      return words.every(w => name.includes(w));
    });
    if (result.length) return result;
  }
  return [];
}

// ─── Расчёт стоимости материала ──────────────────────────────────
// items: [{ stone: <объект из PRICE>, sheets: целые листы, halves: половинки }]
// Возвращает { total, breakdown }
async function calcMaterial(items) {
  const brands = new Set();
  let subtotal = 0;
  const lines = [];

  for (const it of items) {
    const s = it.stone;
    const rate = await workingRate(s.currency);
    const pricePerSheet = s.price_sheet || (s.price_m2 ? s.price_m2 * (s.w * s.h / 1e6) : 0);

    const sheets = it.sheets || 0;
    const halves = it.halves || 0;

    // камень: целые + половинки×0,5
    const stoneCostUsd = (sheets + halves * 0.5) * pricePerSheet;
    const stoneCostRub = stoneCostUsd * rate;
    const cut = halves * CUT_HALF;

    const withMarkup = (stoneCostRub + cut) * MARKUP;
    subtotal += withMarkup;
    brands.add(s.brand);

    lines.push({
      name: `${s.brand} ${s.name}`,
      sheets, halves,
      stoneRub: Math.round(stoneCostRub),
      cut,
      lineTotal: Math.round(withMarkup)
    });
  }

  const delivery = DELIVERY * brands.size;
  let total = subtotal + delivery;
  total = Math.ceil(total / 100) * 100; // округление вверх до 100

  return { total, delivery, brandsCount: brands.size, lines };
}

// ─── Ручной подъём ───────────────────────────────────────────────
// Ставка за габарит детали (длина в мм)
function liftRate(sizeMm) {
  if (sizeMm <= 2300) return 2000;
  if (sizeMm <= 2800) return 2500;
  return 3000; // свыше 3000 (между 2800-3000 берём 2500 — уточняется)
}
// Лимит детали по лифту
function liftLimit(lift) {
  if (lift === 'грузовой') return 2650;
  if (lift === 'пассажирский') return 2000;
  return 0; // нет лифта — всё вручную
}
// details: массив длин деталей (мм), floor: этаж, lift: тип
// Возвращает { cost, lines }
function calcLift(details, floor, lift) {
  const limit = liftLimit(lift);
  let cost = 0; const lines = [];
  for (const d of details) {
    if (d <= limit) {
      lines.push(`деталь ${d} мм — лифтом, 0 ₽`);
    } else {
      const rate = liftRate(d);
      const c = floor * 1 * rate;
      cost += c;
      lines.push(`деталь ${d} мм — вручную: ${floor} эт × ${rate} = ${c} ₽`);
    }
  }
  return { cost, lines };
}

// ─── Связка с раскроем: реальные форматы камня с ценами ──────────
const raskroy = require('./raskroy.js');

// Размеры форматов (рабочие): имя → {L, W, Whalf}
const FORMAT_DIMS = {
  '3000x1400': { name: 'Нормал',  L: 3000, W: 1400, Whalf: 700 },
  '3200x1600': { name: 'Джамбо',  L: 3200, W: 1600, Whalf: 800 },
  '3100x1520': { name: '3100',    L: 3100, W: 1520, Whalf: 760 },
  '3300x1650': { name: '3300',    L: 3300, W: 1650, Whalf: 825 },
};

// Собрать форматы конкретного камня с РЕАЛЬНЫМИ ценами (для раскроя)
// stoneName/brand → массив форматов {name,L,W,Whalf,price,priceHalf}
// Идентификация камня для подтверждения у клиента.
function identifyStone(query) {
  const matches = findStone(query);
  if (!matches.length) return { found: false, options: [] };
  const uniq = [];
  const seen = new Set();
  for (const m of matches) {
    const key = `${m.brand}|${m.article}|${m.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(m);
  }
  const byStone = {};
  for (const m of uniq) {
    const k = `${m.brand}|${m.name}`;
    (byStone[k] ||= []).push(m);
  }
  const stones = Object.values(byStone);
  if (stones.length === 1) {
    const s = stones[0][0];
    const surfaces = [...new Set(stones[0].map(x => x.surface).filter(Boolean))];
    return { found: true, single: s, surfaces, needConfirm: true };
  }
  return {
    found: true, single: null, needConfirm: true,
    options: stones.map(g => ({ brand: g[0].brand, article: g[0].article, name: g[0].name }))
  };
}

// Самый дешёвый камень из наличия (для расчёта "от", когда клиент не выбрал)
function cheapestStone(surface = 'глянцевый') {
  const cands = PRICE.filter(p => p.surface === surface && p.price_sheet && (p.stock !== 'под заказ'));
  if (!cands.length) return null;
  // приводим к рублям грубо для сравнения (USD дешевле EUR)
  cands.sort((a, b) => {
    const ka = a.currency === '€' ? 1.15 : 1;
    const kb = b.currency === '€' ? 1.15 : 1;
    return a.price_sheet * ka - b.price_sheet * kb;
  });
  return cands[0];
}

async function stoneFormats(query, surface = 'глянцевый') {
  let matches = findStone(query);
  if (!matches.length) return null;
  // фильтр по поверхности (по умолчанию глянец)
  const bySurf = matches.filter(m => !m.surface || m.surface === surface);
  if (bySurf.length) matches = bySurf;
  // группируем по формату (w×h), берём цену
  const out = [];
  const seen = new Set();
  for (const m of matches) {
    const dimKey = `${m.w}x${m.h}`;
    if (seen.has(dimKey)) continue;
    const dims = FORMAT_DIMS[dimKey];
    if (!dims) continue;
    seen.add(dimKey);
    const rate = await workingRate(m.currency);
    const priceFull = Math.ceil(m.price_sheet * rate * MARKUP / 100) * 100;
    const priceHalf = Math.ceil((m.price_sheet * 0.5 * rate * MARKUP + CUT_HALF * MARKUP) / 100) * 100;
    const areaM2 = (m.w * m.h) / 1e6;
    const costPerM2 = areaM2 ? (m.price_sheet * rate) / areaM2 : 0; // себестоимость камня за м² в ₽ (без навара)
    out.push({ ...dims, price: priceFull, priceHalf, usd: m.price_sheet, currency: m.currency,
               stoneName: m.name, brand: m.brand, sheetAreaM2: areaM2, costPerM2 });
  }
  return out.length ? out : null;
}

// ─── ПОЛНАЯ СМЕТА ПРОЕКТА (модель «площадь × коэффициент») ────────
// project = {
//   details: [{ len, depth }],   // ВСЕ детали плоским списком (столешница + панели)
//   stone: 'Чёрное Море',        // камень (или пусто → дешёвый, цена "от")
//   surface: 'глянцевый',
//   cutouts: { varka:1, moyka:1, smesitel:2 },
//   edge_mp: 4.0,                 // кромка м.п. (внешний контур)
//   mont_mp: 4.0,                 // монтаж м.п. (длина по стенам)
//   panels_mp: 2.7,              // ПОГ.МЕТРЫ стеновых панелей (длина+высота), для работ по панелям
// }
// Совместимость: если переданы straight[]/g{} — приводим к details[].
const CUT_COEF = 1.35;   // коэффициент раскроя: площадь деталей × 1.35 = м² камня к закупке

function projectToDetails(project) {
  const depth = project.depth || 600;
  if (Array.isArray(project.details) && project.details.length) {
    return project.details.map(d => ({ len: d.len, depth: d.depth || depth }));
  }
  // обратная совместимость со старым форматом
  if (project.shape === 'г' && project.g) {
    return [{ len: project.g.A, depth }, { len: project.g.B, depth }];
  }
  if (Array.isArray(project.straight)) {
    return project.straight.map(len => ({ len, depth }));
  }
  return [];
}

async function estimateProject(project) {
  let formats = null;
  let priceFrom = false;
  let usedStone = project.stone;
  if (project.stone && String(project.stone).trim()) {
    formats = await stoneFormats(project.stone, project.surface || 'глянцевый');
  }
  if (!formats) {
    const cheap = cheapestStone(project.surface || 'глянцевый');
    if (cheap) {
      formats = await stoneFormats(cheap.name, cheap.surface);
      priceFrom = true;
      usedStone = `${cheap.brand} ${cheap.name}`;
    }
  }
  if (!formats || !formats.length) return { error: 'Не удалось подобрать камень для расчёта' };

  // Берём самый дешёвый доступный формат камня как основной для расчёта
  const fmt = formats.slice().sort((a, b) => a.price - b.price)[0];

  // 1. ДЕТАЛИ И ПЛОЩАДЬ
  const details = projectToDetails(project);
  if (!details.length) return { error: 'Нет деталей для расчёта' };

  const detailAreaM2 = details.reduce((s, d) => s + (d.len * d.depth) / 1e6, 0);
  const stoneAreaM2  = detailAreaM2 * CUT_COEF;           // площадь камня к закупке
  const longest      = Math.max(...details.map(d => d.len));
  const sheetArea    = fmt.sheetAreaM2 || (fmt.L * fmt.W / 1e6);
  const halfArea     = sheetArea / 2;

  // 2. ЛИСТЫ + ВИЛКА (детерминированное правило, без «вероятностей»)
  // Проверки габарита: влезает ли длинная деталь в половину листа / целый лист
  const fitsHalf  = longest <= fmt.L && (fmt.Whalf ? d_fits(details, fmt.L, fmt.Whalf) : false);
  const fitsFull  = longest <= fmt.L;

  let matMin, matMax, sheetsDesc, confidence;

  const multiDetail = details.length >= 2;
  const nearLimit = stoneAreaM2 > sheetArea * 0.8; // близко к ёмкости листа

  if (stoneAreaM2 <= halfArea && fitsHalf) {
    // уверенно половинка
    matMin = matMax = fmt.priceHalf;
    sheetsDesc = '½ листа';
    confidence = 0.9;
  } else if (stoneAreaM2 <= sheetArea && fitsFull) {
    // помещается в один лист по площади
    if (stoneAreaM2 <= halfArea * 1.1 && fitsHalf) {
      // граница ½…1
      matMin = fmt.priceHalf; matMax = fmt.price;
      sheetsDesc = '½–1 лист'; confidence = 0.7;
    } else if (multiDetail && nearLimit) {
      // 2+ деталей на грани листа — раскладка ненадёжна, страхуем вилкой 1…2 листа
      matMin = fmt.price; matMax = fmt.price + fmt.priceHalf;
      sheetsDesc = '1–1.5 листа'; confidence = 0.55;
    } else {
      matMin = matMax = fmt.price;
      sheetsDesc = '1 лист'; confidence = 0.85;
    }
  } else {
    // нужно больше листа: целое число вверх + вилка от (N-0.5) листа
    const fullSheets = Math.ceil(stoneAreaM2 / sheetArea);
    const withHalf   = Math.max(0, fullSheets - 1) * fmt.price + fmt.priceHalf;
    matMin = Math.min(withHalf, fullSheets * fmt.price);
    matMax = fullSheets * fmt.price;
    sheetsDesc = matMin === matMax ? `${fullSheets} листа` : `${fullSheets - 0.5}–${fullSheets} листа`;
    confidence = 0.6;
  }

  // 3. РАБОТЫ
  const wt = (name) => { const x = work(name); return x ? x.total : 0; };
  const wc = (name) => { const x = work(name); return x ? workCost(x) : 0; };
  let worksSum = 0, worksCost = 0;
  const lines = [];
  const addW = (label, total, cost) => { worksSum += total; worksCost += cost; lines.push({ label, total }); };

  addW('Замер', wt('Замер'), wc('Замер'));
  addW('Доставка на производство', wt('Доставка материала на производство'), wc('Доставка материала на производство'));
  addW('Подготовка чертежей', wt('Подготовка чертежей'), wc('Подготовка чертежей'));

  const c = project.cutouts || {};
  for (let i = 0; i < (c.varka || 0); i++) addW('Вырез варка', wt('Вырез под варку'), wc('Вырез под варку'));
  for (let i = 0; i < (c.moyka || 0); i++) {
    addW('Мойка: вырез', wt('Вырез под варку'), wc('Вырез под варку'));
    addW('Мойка: полировка', wt('Полировка выреза'), wc('Полировка выреза'));
    addW('Мойка: крепление', wt('Установка мойки под столешницу'), wc('Установка мойки под столешницу'));
  }
  for (let i = 0; i < (c.smesitel || 0); i++) addW('Смеситель', wt('Вырез под смеситель'), wc('Вырез под смеситель'));

  const edgeMp = project.edge_mp || 0;
  const montMp = project.mont_mp || 0;
  if (edgeMp) addW(`Кромка ${edgeMp} м.п.`, Math.round(wt('Профиль 1, Z, R') * edgeMp), Math.round(wc('Профиль 1, Z, R') * edgeMp));
  if (montMp) addW(`Монтаж ${montMp} м.п.`, Math.round(wt('Установка подоконников') * montMp), Math.round(wc('Установка подоконников') * montMp));

  // Стеновые панели: работы по метражу (длина+высота). Материал уже учтён в площади details.
  const panelsMp = project.panels_mp || 0;
  if (panelsMp) {
    addW(`Панели: изготовление ${panelsMp} м.п.`,
      Math.round(wt('Изготовление стеновой панели') * panelsMp),
      Math.round(wc('Изготовление стеновой панели') * panelsMp));
    addW(`Панели: установка ${panelsMp} м.п.`,
      Math.round(wt('Установка стеновой панели') * panelsMp),
      Math.round(wc('Установка стеновой панели') * panelsMp));
  }

  addW('Доставка на объект', wt('Доставка / повторная доставка'), wc('Доставка / повторная доставка'));

  // 4. ИТОГ + грязная прибыль
  // Себестоимость материала: площадь камня × себестоимость за м² (без навара)
  const matCost = Math.round(stoneAreaM2 * (fmt.costPerM2 || 0));
  const totalMin = matMin + worksSum;
  const totalMax = matMax + worksSum;
  const profit = totalMin - (matCost + worksCost);
  const profitPct = totalMin ? (profit / totalMin * 100) : 0;

  return {
    material: [matMin, matMax],
    works: worksSum,
    total: [totalMin, totalMax],
    confidence,
    cut: { desc: `${sheetsDesc} (${detailAreaM2.toFixed(2)}м²×${CUT_COEF}=${stoneAreaM2.toFixed(2)}м²)`, confidence },
    profit: Math.round(profit),
    profitPct: +profitPct.toFixed(1),
    lines, priceFrom, usedStone,
  };
}

// Помощь: влезают ли все детали в полосы шириной maxW и длиной maxL (грубая проверка по габариту)
function d_fits(details, maxL, maxW) {
  // каждая деталь должна влезать хотя бы по одной ориентации
  return details.every(d =>
    (d.len <= maxL && d.depth <= maxW) || (d.depth <= maxL && d.len <= maxW)
  );
}

module.exports = {
  PRICE, WORKS, findStone, calcMaterial, workingRate, fetchCbrRates,
  work, workCost, calcLift, liftRate, liftLimit,
  stoneFormats, estimateProject, identifyStone,
  MARKUP, CUT_HALF, DELIVERY
};
