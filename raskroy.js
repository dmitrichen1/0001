// ─── Модуль раскроя (Путь 3: точно для простых, оценка+вилка для сложных) ───
// Цель: для набора деталей найти минимальную стоимость материала.
// Деталь: { len, depth } в мм. Глубина обычно 600, бывает 800-1000 (остров).

const FORMATS = [
  { name: '3,0×1,4',  L: 3000, W: 1400, Whalf: 700,  price: 100000 },
  { name: '3,1×1,52', L: 3100, W: 1520, Whalf: 760,  price: 110000 },
  { name: '3,2×1,6',  L: 3200, W: 1600, Whalf: 800,  price: 115000 },
  { name: '3,3×1,65', L: 3300, W: 1650, Whalf: 825,  price: 125000 },
];
const CUT = 2000;      // распил половинки (1000 поставщику + 1000 нам)
const SAW = 10;        // зазор на рез между деталями (беглый раскрой)

// ── Помощь: разложить детали (длины) в полосы заданной длины ──
// items: массив длин. stripLen: длина полосы. Возвращает число полос.
function packStrips(items, stripLen) {
  const sorted = [...items].sort((a, b) => b - a);
  const strips = [];
  for (const it of sorted) {
    if (it > stripLen) return null; // деталь длиннее полосы — нужен стык (обработка выше)
    let placed = false;
    for (let idx = 0; idx < strips.length; idx++) {
      if (strips[idx] + it <= stripLen) {
        strips[idx] = strips[idx] + it;
        placed = true; break;
      }
    }
    if (!placed) strips.push(it);
  }
  return strips.length;
}

// ── Влезает ли набор деталей (одной глубины 600) в ОДИН лист формата? ──
// Ёмкость листа: 2 полосы по длине + 1 деталь боком (в торце).
// Боковая деталь укорачивает полосы на свою глубину (600).
// Возвращает true/false.
function fitsOneSheet(lengths, depth, fmt) {
  const stripsPerSheet = Math.floor(fmt.W / depth); // обычно 2 при depth=600
  if (stripsPerSheet < 1) return { fits: false };

  // Вариант А: без боковой — все детали в полосы длиной fmt.L (горизонтально)
  const linear = packStrips(lengths, fmt.L);
  if (linear !== null && linear <= stripsPerSheet) return { fits: true, rotated: false };

  // Вариант Б: одну деталь ставим боком (поворот) — последнее средство
  for (let i = 0; i < lengths.length; i++) {
    const side = lengths[i];
    if (side > fmt.W) continue; // боком не влезает по ширине
    const rest = lengths.filter((_, j) => j !== i);
    const stripLenReduced = fmt.L - depth; // полосы короче на глубину боковой
    const linearB = packStrips(rest, stripLenReduced);
    if (linearB !== null && linearB <= stripsPerSheet) return { fits: true, rotated: true };
  }
  return { fits: false };
}

// ── Минимум листов формата для набора деталей (с дроблением длинных) ──
function sheetsForFormat(details, fmt) {
  // приведение ориентации + дробление длинных
  const norm = [];
  for (const d of details) {
    let depth = d.depth, len = d.len;
    if (depth > fmt.W) {
      if (len <= fmt.W) { [depth, len] = [len, depth]; }
      else return null;
    }
    norm.push({ len, depth });
  }
  // если все детали глубиной 600 — используем точную ёмкость
  const allDepth = norm.every(p => p.depth === norm[0].depth);
  const depth = norm[0].depth;

  if (allDepth) {
    const lens = norm.map(p => p.len);
    // дробим длинные (> L) под лист
    let needSplit = false;
    const broken = [];
    for (const l of lens) {
      if (l > fmt.L) {
        needSplit = true;
        const n = Math.ceil(l / (fmt.L - SAW));
        const piece = Math.ceil(l / n);
        for (let k = 0; k < n; k++) broken.push(piece);
      } else broken.push(l);
    }

    // 1) Пробуем ПОЛОВИНКУ (дешевле всего): 1 полоса, глубина <= Whalf
    if (depth <= fmt.Whalf) {
      const oneStrip = packStrips(broken, fmt.L);
      if (oneStrip !== null && oneStrip <= 1) return { sheets: 0.5, needSplit, needRotation: false };
    }
    // 2) Пробуем 1 ЦЕЛЫЙ лист (с ёмкостью: полосы + боковая)
    const one = fitsOneSheet(broken, depth, fmt);
    if (one.fits) return { sheets: 1, needSplit, needRotation: one.rotated };
    // 3) 1.5 листа и далее — по полосам
    const stripsTotal = packStrips(broken, fmt.L);
    if (stripsTotal !== null) {
      const stripsPerSheet = Math.floor(fmt.W / depth);
      const sheets = Math.ceil((stripsTotal / stripsPerSheet) * 2) / 2;
      return { sheets, needSplit, needRotation: false };
    }
    return { sheets: 2, needSplit, needRotation: false };
  }

  // разные глубины (остров+столешница) — приблизительно по сумме ширин
  let usedWidth = 0;
  const byDepth = {};
  for (const p of norm) { (byDepth[p.depth] ||= []).push(p.len); }
  for (const dStr in byDepth) {
    const d = +dStr;
    const strips = packStrips(byDepth[dStr], fmt.L);
    if (strips === null) return null;
    usedWidth += strips * d;
  }
  // разные глубины — сложный случай, помечаем неуверенность
  return { sheets: Math.ceil((usedWidth / fmt.W) * 2) / 2, needSplit: false, needRotation: false, complex: true };
}

// ── Главная: выбрать самый дешёвый раскрой ──
// details: [{len, depth}].
// customFormats: массив форматов с РЕАЛЬНЫМИ ценами камня [{name,L,W,Whalf,price,priceHalf}]
//   если null — используются условные FORMATS.
function bestCut(details, complexity = 'simple', customFormats = null) {
  let best = null;
  const formats = customFormats || FORMATS;

  for (const fmt of formats) {
    const r = sheetsForFormat(details, fmt);
    if (!r) continue;
    let price, desc;
    if (r.sheets === 0.5 && details.every(d => d.depth <= fmt.Whalf)) {
      const half = (fmt.priceHalf != null) ? fmt.priceHalf : (fmt.price / 2 + CUT);
      const full = fmt.price * 0.5;
      if (half < full) { price = half; desc = `1 половинка ${fmt.name}`; }
      else { price = full; desc = `0,5 листа ${fmt.name}`; }
    } else {
      price = r.sheets * fmt.price;
      desc = `${r.sheets} шт. ${fmt.name}`;
    }
    if (!best || price < best.price) {
      best = { price: Math.round(price), format: fmt.name, sheets: r.sheets, desc,
               needRotation: !!r.needRotation, needSplit: !!r.needSplit, complex: !!r.complex };
    }
  }
  if (!best) return null;

  const uncertain = best.needRotation || best.needSplit || best.complex;
  if (uncertain) {
    const conf = complexity === 'hard' ? 0.60 : 0.75;
    const spread = complexity === 'hard' ? 0.25 : 0.15;
    best.confidence = conf;
    best.range = [best.price, Math.round(best.price * (1 + spread))];
  } else {
    best.confidence = 0.95;
    best.range = [best.price, best.price];
  }
  return best;
}

// ── Разбивка Г-образной на детали (два варианта деления) ──
// stenA, stenB — длины стен (мм), depth — глубина. Возвращает массив вариантов [[детали], ...]
function gShapeVariants(stenA, stenB, depth = 600) {
  return [
    [{ len: stenA, depth }, { len: stenB - depth, depth }],   // угол в A
    [{ len: stenA - depth, depth }, { len: stenB, depth }],   // угол в B
  ];
}

// Лучший раскрой для Г (перебор обоих делений)
function bestCutG(stenA, stenB, depth = 600, complexity = 'medium', customFormats = null) {
  const variants = gShapeVariants(stenA, stenB, depth);
  let best = null;
  for (const det of variants) {
    const r = bestCut(det, complexity, customFormats);
    if (r && (!best || r.price < best.price)) best = r;
  }
  return best;
}

module.exports = { FORMATS, CUT, packStrips, sheetsForFormat, fitsOneSheet, bestCut, bestCutG, gShapeVariants };
