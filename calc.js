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
    out.push({ ...dims, price: priceFull, priceHalf, usd: m.price_sheet, currency: m.currency, stoneName: m.name, brand: m.brand });
  }
  return out.length ? out : null;
}

// ─── ПОЛНАЯ СМЕТА ПРОЕКТА ────────────────────────────────────────
// project = {
//   shape: 'прямая'|'г',
//   straight: [длины деталей],   // для прямой
//   g: {A, B},                    // для Г (стены)
//   depth: 600,
//   stone: 'Чёрное Море',
//   cutouts: { varka:1, moyka:1, smesitel:2 },  // вырезы
//   edge_mp: 4.0,                 // кромка м.п.
//   mont_mp: 4.0,                 // монтаж м.п.
//   moscow: true,
// }
async function estimateProject(project) {
  let formats = null;
  let priceFrom = false;
  let usedStone = project.stone;
  // если камень указан — пробуем найти
  if (project.stone && String(project.stone).trim()) {
    formats = await stoneFormats(project.stone);
  }
  if (!formats) {
    // камень не назван или не из прайса — берём самый дешёвый, считаем "от"
    const cheap = cheapestStone(project.surface || 'глянцевый');
    if (cheap) {
      formats = await stoneFormats(cheap.name, cheap.surface);
      priceFrom = true;
      usedStone = `${cheap.brand} ${cheap.name}`;
    }
  }
  if (!formats) return { error: `Не удалось подобrать камень для расчёта` };

  // 1. РАСКРОЙ
  const depth = project.depth || 600;
  let cut;
  if (project.shape === 'г' && project.g) {
    cut = raskroy.bestCutG(project.g.A, project.g.B, depth, 'medium', formats);
  } else {
    const details = (project.straight || []).map(len => ({ len, depth }));
    cut = raskroy.bestCut(details, 'simple', formats);
  }
  if (!cut) return { error: 'Раскрой не удался — проверьте размеры' };

  // 2. МАТЕРИАЛ — цена из раскроя (уже с курсом и наваром)
  const materialMin = cut.range[0];
  const materialMax = cut.range[1];

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
  addW('Доставка на объект', wt('Доставка / повторная доставка'), wc('Доставка / повторная доставка'));

  // 4. ИТОГ + грязная прибыль (материал: себестоимость без навара)
  const matCostMin = Math.round(materialMin / MARKUP); // обратно к себестоимости камня
  const totalMin = materialMin + worksSum;
  const totalMax = materialMax + worksSum;
  const profit = (totalMin) - (matCostMin + worksCost);
  const profitPct = totalMin ? (profit / totalMin * 100) : 0;

  return {
    cut, material: [materialMin, materialMax], works: worksSum,
    total: [totalMin, totalMax],
    confidence: cut.confidence,
    profit: Math.round(profit), profitPct: +profitPct.toFixed(1),
    lines, priceFrom, usedStone,
  };
}

module.exports = {
  PRICE, WORKS, findStone, calcMaterial, workingRate, fetchCbrRates,
  work, workCost, calcLift, liftRate, liftLimit,
  stoneFormats, estimateProject, identifyStone,
  MARKUP, CUT_HALF, DELIVERY
};
