const https = require('https');
const fs = require('fs');
const path = require('path');

// ─── Прайс ───────────────────────────────────────────────────────
const PRICE = JSON.parse(fs.readFileSync(path.join(__dirname, 'price.json'), 'utf-8'));

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
function findStone(query) {
  const q = query.toLowerCase().trim();
  return PRICE.filter(p =>
    (p.name && p.name.toLowerCase().includes(q)) ||
    (p.article && p.article.toLowerCase().includes(q)) ||
    (p.brand && p.brand.toLowerCase().includes(q))
  );
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

module.exports = { PRICE, findStone, calcMaterial, workingRate, fetchCbrRates };
