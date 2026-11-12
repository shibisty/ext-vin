// Офлайн-декодер NHTSA vPIC: те же правила сопоставления, что в хранимой процедуре spVinDecode.
// Данные (база vPIC, выпуск 2026-10, общественное достояние) лежат в папке nhtsa/ и читаются локально, без сети.
import type { Dict } from './data/types';
import { NH_EXTRA_LABELS, NH_GROUPS } from './data/nhtsa-elements';

/** Схема декодирования: [год с, год по (0 = без конца), номер шарда, индекс схемы в шарде, 0 = только дополнительные элементы] */
export type SchemaRef = [yearFrom: number, yearTo: number, shard: number, sidx: number, coreFlag?: 0];
/** Запись WMI в index.json */
export type WmiEntry = [mfrId: number, makeId: number, vehicleTypeId: number, truckTypeId: number, countryId: number, schemas: SchemaRef[]];

/** lookup.json: справочники идентификаторов. Ключи-числа (элементы NHTSA) читаются через elementLookup() */
export interface Lookups {
  make: Dict;
  mfr: Dict;
  /** id модели -> [название, id марки] */
  model: Dict<[string, number]>;
  wmiMake: Dict<number[]>;
  country: Dict;
  vtype: Dict;
  /** свойства двигателя по имени модели двигателя: [элемент, значение] */
  engmodel: Dict<[number, string][]>;
  /** дескриптор известного номера -> модельный год */
  desc: Dict<number>;
  /** элементы vPIC: id -> [название, группа, тип данных] */
  el: Dict<[string, string, string]>;
  /** значения по умолчанию по типу ТС: [элемент, значение] (vPIC добавляет их, если элемент не расшифрован) */
  defaults: Dict<[number, string][]>;
}
/** specs/index.json: id модели -> схемы Vehicle Specs [марка, тип ТС, годы (пусто = любые), шард, индекс схемы] */
type SpecIndex = Dict<[makeId: number, vtypeId: number, years: number[], shard: number, sidx: number][]>;
/** Шард Vehicle Specs: s — строки, g[индекс схемы] = шаблоны [[ключи: элемент, строка…], [значения: элемент, строка, ts…]] */
interface SpecShard { s: string[]; g: [number[], number[]][][] }
/** Шард шаблонов: s — таблица строк, g — [id схемы, строки [ключ, ts, элемент, индекс строки, элемент, индекс строки, …]] */
interface Shard { s: string[]; g: [number, (string | number)[][]][] }

interface Pattern {
  key: string;
  ts: number;
  pairs: [el: number, attr: string][];
  re: RegExp | null;
  spec: number;
  plain: string;
  /** формульный шаблон: «#» — любая цифра, значение берётся из самих символов VIN */
  formula: boolean;
  /** в шаблоне есть основные элементы (те, что были в данных до расширения) */
  core: boolean;
}
/** Откуда взято значение: шаблон VIN, формульный шаблон, модель двигателя, Vehicle Specs */
export type NhSource = 'pattern' | 'formula' | 'engine' | 'spec' | 'default';
interface Match {
  el: number;
  attr: string;
  prio: number;
  src: NhSource;
  ts?: number;
  spec?: number;
  plain?: string;
  key?: string;
  order?: number;
}

/** Основные элементы: у них свои поля в NhtsaResult (марка, модель, кузов, двигатель…) */
const CORE = new Set([28, 34, 38, 5, 14, 15, 9, 13, 11, 12, 71, 125, 21, 18, 24, 66, 64, 37, 63, 25, 75, 77, 31, 76, 10, 135, 126, 67, 62, 17, 146]);
/** Элементы, у которых vPIC оставляет все совпавшие значения (примечания), а не одно лучшее */
const MULTI = new Set([121, 129, 150, 154, 155, 114, 169, 186]);
/** Эти элементы Vehicle Specs дополняет, даже если значение уже есть из шаблонов */
const SPEC_APPEND = new Set([1, 114, 121, 129, 150, 154, 155, 169, 186]);
/** Основные элементы без своего поля в NhtsaResult: показываются среди дополнительных */
const CORE_NO_FIELD = new Set([17, 21]);

export type JsonLoader = (path: string) => Promise<unknown>;

const fetchJson: JsonLoader = async path => (await fetch(path)).json();
let loadJson: JsonLoader = fetchJson;
/** Подменить загрузчик данных (тесты читают JSON с диска). Сбрасывает кэш. */
export function setJsonLoader(fn: JsonLoader | null): void {
  loadJson = fn || fetchJson;
  IDX = null; LK = null; EXC = null; POOLS = null; SPEC = null;
  shardCache.clear(); specCache.clear();
}

let IDX: Dict<WmiEntry> | null = null, LK: Lookups | null = null;
const shardCache = new Map<number, Promise<Map<number, Pattern[]>>>();

export async function initNhtsa(): Promise<void> {
  if (!IDX) [IDX, LK] = await Promise.all([loadJson('./nhtsa/index.json'), loadJson('./nhtsa/lookup.json')]) as [Dict<WmiEntry>, Lookups];
}
function loaded(): { IDX: Dict<WmiEntry>; LK: Lookups } {
  if (!IDX || !LK) throw new Error('База NHTSA не загружена: сначала вызовите initNhtsa()');
  return { IDX, LK };
}
// [manufacturerId, makeId, vehicleTypeId, truckTypeId, countryId, schemas]
export function wmiInfo(wmi: string): WmiEntry | null { return IDX ? IDX[wmi] || null : null; }
export function nhtsaLookups(): Lookups | null { return LK; }
/** Справочник значений элемента NHTSA (кузов, привод, топливо…): id -> название */
function elementLookup(lk: Lookups, el: number): Dict | undefined {
  return (lk as unknown as Record<string, Dict | undefined>)[String(el)];
}

const isCarMpvLt = (w: WmiEntry | null): boolean => !!w && (w[2] === 2 || w[2] === 7 || (w[2] === 3 && w[3] === 1));
export function wmiKey(vin: string): string { let w = vin.slice(0, 3); if (w[2] === '9' && vin.length >= 14) w += vin.slice(11, 14); return w; }

export interface NhtsaYears { rmy: number; omy: number | null; conclusive: boolean }
// Модельный год по правилам fVinModelYear2
export function nhtsaYears(vin: string): NhtsaYears | null {
  vin = vin.toUpperCase();
  const c = vin[9], A = 'A'.charCodeAt(0);
  let my: number | null = null;
  if (c >= 'A' && c <= 'H') my = 2010 + c.charCodeAt(0) - A;
  else if (c >= 'J' && c <= 'N') my = 2010 + c.charCodeAt(0) - A - 1;
  else if (c === 'P') my = 2023;
  else if (c >= 'R' && c <= 'T') my = 2010 + c.charCodeAt(0) - A - 3;
  else if (c >= 'V' && c <= 'Y') my = 2010 + c.charCodeAt(0) - A - 4;
  else if (c >= '1' && c <= '9') my = 2031 + +c - 1;
  if (my === null) return null;
  const w = wmiInfo(wmiKey(vin));
  let conclusive = false;
  const limit = new Date().getFullYear() + 2;
  if (w && isCarMpvLt(w)) {
    if (/^[0-9]$/.test(vin[6])) { my -= 30; conclusive = true; }
    else if (/^[A-Z]$/.test(vin[6])) conclusive = true;
  }
  if (my > limit) { my -= 30; conclusive = true; }
  return { rmy: my, omy: conclusive ? null : my - 30, conclusive };
}

function loadShard(i: number): Promise<Map<number, Pattern[]>> {
  let p = shardCache.get(i);
  if (!p) {
    p = (loadJson(`./nhtsa/shards/${String(i).padStart(3, '0')}.json`) as Promise<Shard>).then(sh => {
      const bySchema = new Map<number, Pattern[]>();
      for (const [sid, items] of sh.g) {
        bySchema.set(sid, items.map(row => {
          const key = row[0] as string, pairs: [number, string][] = [];
          for (let k = 2; k < row.length; k += 2) pairs.push([row[k] as number, sh.s[row[k + 1] as number]]);
          return { key, ts: row[1] as number, pairs, re: key.includes('[') ? keyRegex(key) : null, spec: key.replace(/\*/g, '').length, plain: key.replace(/[\[\]]/g, ''),
            formula: key.includes('#'), core: pairs.some(([el]) => CORE.has(el)) };
        }));
      }
      return bySchema;
    });
    shardCache.set(i, p);
  }
  return p;
}
function keyRegex(key: string): RegExp | null {   // sqlwild_to_regex из vPIC
  let out = '';
  for (const ch of key) {
    if (ch === '*') out += '.';
    else if (ch === '[' || ch === ']') out += ch;
    else if (ch === '|') out += '\\|';
    else if (/[\\.^$+?{}()]/.test(ch)) out += '\\' + ch;
    else out += ch;
  }
  out = out.replace('1-A', '1A');
  try { return new RegExp('^' + out + '.*'); } catch { return null; }
}
function keyMatches(p: Pattern, varKeys: string): boolean {
  if (p.re) return p.re.test(varKeys);
  const k = p.key;
  if (k.length > varKeys.length) return false;
  for (let i = 0; i < k.length; i++) if (k[i] !== '*' && k[i] !== varKeys[i]) return false;
  return true;
}

// приоритет совпадений: поздняя схема, свежий шаблон, менее конкретный ключ, затем по алфавиту и порядку
function better(it: Match, b: Match): boolean {
  if (it.prio !== b.prio) return it.prio > b.prio;
  const its = it.ts!, bts = b.ts!;
  if (its !== bts) return its > bts;
  if (it.spec !== b.spec) return it.spec! < b.spec!;
  if (it.plain !== b.plain) return it.plain! < b.plain!;
  return it.order! < b.order!;
}

// Формульный ключ: как LIKE в vPIC — «*» любой символ, «#» совпадает с цифрой (цифры VIN заменены на «#»)
function formulaMatches(key: string, fKeys: string): boolean {
  if (key.length > fKeys.length) return false;
  for (let i = 0; i < key.length; i++) if (key[i] !== '*' && key[i] !== fKeys[i]) return false;
  return true;
}
// Значение формульного шаблона: символы VIN от первого до последнего «#» ключа
function formulaValue(key: string, varKeys: string): string {
  return varKeys.slice(key.indexOf('#'), key.lastIndexOf('#') + 1);
}

interface Pass {
  best: Map<number, Match>;
  /** все значения элементов-примечаний (MULTI) */
  multi: Map<number, Match[]>;
  /** число совпавших пар основных элементов: по нему выбирается год (как и до расширения данных) */
  count: number;
  schemasUsed: [number, number][];
}
// Один проход декодирования для заданного модельного года
async function pass(vin: string, year: number | null, w: WmiEntry): Promise<Pass> {
  const { LK } = loaded();
  const varKeys = vin.slice(3, 8) + (vin.length > 9 ? '|' + vin.slice(9, 17) : '');
  const fKeys = varKeys.replace(/[0-9]/g, '#');
  const items: Match[] = [], schemasUsed: [number, number][] = [];
  let order = 0, count = 0;
  for (const [yf, yt, shard, sidx] of w[5]) {
    if (year != null && !(year >= yf && year <= (yt || 2999))) continue;
    schemasUsed.push([yf, yt]);
    const sh = await loadShard(shard);
    for (const p of sh.get(sidx) || []) {
      if (p.formula) {
        // приоритет формульных шаблонов в vPIC — 100: ниже любого обычного шаблона (у тех приоритет — год начала схемы)
        if (!formulaMatches(p.key, fKeys)) continue;
        const v = formulaValue(p.key, varKeys);
        for (const [el] of p.pairs) items.push({ el, attr: v, prio: 100, src: 'formula', ts: p.ts, spec: p.spec, plain: p.plain, key: p.key, order: order++ });
        continue;
      }
      if (!keyMatches(p, varKeys)) continue;
      for (const [el, attr] of p.pairs) {
        if (CORE.has(el)) count++;
        items.push({ el, attr, prio: yf, src: 'pattern', ts: p.ts, spec: p.spec, plain: p.plain, key: p.key, order: order++ });
      }
    }
  }
  const best = new Map<number, Match>(), multi = new Map<number, Match[]>();
  for (const it of items) {
    if (MULTI.has(it.el)) { const l = multi.get(it.el); if (l) l.push(it); else multi.set(it.el, [it]); continue; }
    const b = best.get(it.el);
    if (!b || better(it, b)) best.set(it.el, it);
  }
  // запасной вариант: свойства двигателя по имени модели двигателя (приоритет ниже, чем у шаблонов)
  const em = best.get(18);
  const engProps = em && LK.engmodel[em.attr.trim().toLowerCase()];
  if (engProps) {
    for (const [el, attr] of engProps) {
      if (MULTI.has(el)) { const it: Match = { el, attr, prio: 50, src: 'engine' }; const l = multi.get(el); if (l) l.push(it); else multi.set(el, [it]); }
      else if (!best.has(el)) best.set(el, { el, attr, prio: 50, src: 'engine' });
    }
  }
  return { best, multi, count, schemasUsed };
}

// ---------- Vehicle Specs: оснащение по марке, модели, году и типу ТС ----------
let SPEC: Promise<SpecIndex> | null = null;
const specCache = new Map<number, Promise<SpecShard>>();
function loadSpecShard(i: number): Promise<SpecShard> {
  let p = specCache.get(i);
  if (!p) { p = loadJson(`./nhtsa/specs/${String(i).padStart(3, '0')}.json`) as Promise<SpecShard>; specCache.set(i, p); }
  return p;
}
/**
 * Значения из Vehicle Specs (как в spvindecode_core): схемы марок этого WMI для модели, типа ТС и года;
 * шаблон применяется, если все его ключевые пары совпали с уже расшифрованными значениями.
 * Добавляются только элементы, которых ещё нет; на элемент — одно значение, самое свежее.
 */
async function vehicleSpecs(wmi: string, w: WmiEntry, year: number | null, p: Pass): Promise<Map<number, Match>> {
  const out = new Map<number, Match>();
  const modelId = p.best.get(28)?.attr;
  if (!modelId) return out;
  if (!SPEC) SPEC = loadJson('./nhtsa/specs/index.json') as Promise<SpecIndex>;
  const refs = (await SPEC)[modelId];
  if (!refs) return out;
  const { LK } = loaded();
  const makes = LK.wmiMake[wmi] || [];
  // расшифрованные пары «элемент — значение» (значения сравниваются без учёта регистра)
  const have = (el: number, a: string): boolean => {
    const lo = a.toLowerCase(), b = p.best.get(el);
    if (b && b.attr.toLowerCase() === lo) return true;
    return (p.multi.get(el) || []).some(m => m.attr.toLowerCase() === lo);
  };
  for (const [makeId, vtype, years, shard, sidx] of refs) {
    if (!makes.includes(makeId) || vtype !== w[2]) continue;
    if (years.length && (year == null || !years.includes(year))) continue;
    const sh = await loadSpecShard(shard);
    for (const [keys, vals] of sh.g[sidx] || []) {
      let ok = true;
      for (let k = 0; k < keys.length && ok; k += 2) ok = have(keys[k], sh.s[keys[k + 1]]);
      if (!ok) continue;
      for (let k = 0; k < vals.length; k += 3) {
        const el = vals[k], attr = sh.s[vals[k + 1]], ts = vals[k + 2];
        if ((p.best.has(el) || p.multi.has(el)) && !SPEC_APPEND.has(el)) continue;
        const prev = out.get(el);
        if (!prev || ts > prev.ts!) out.set(el, { el, attr, prio: -100, src: 'spec', ts });
      }
    }
  }
  return out;
}


// Русские подписи элементов NHTSA (для вкладки «Правила»)
export const NH_LABELS: Record<number, string> = { 28: 'Модель', 34: 'Серия', 38: 'Комплектация', 5: 'Тип кузова', 14: 'Двери', 15: 'Привод', 9: 'Цилиндры', 13: 'Объём, л', 11: 'Объём, см³',
  12: 'Объём, куб. дюймы', 71: 'Мощность от, л.с.', 125: 'Мощность до, л.с.', 21: 'Мощность, кВт', 18: 'Модель двигателя', 24: 'Топливо', 66: 'Топливо (доп.)',
  64: 'Схема двигателя', 37: 'КПП', 63: 'Число передач', 25: 'Класс полной массы', 75: 'Страна завода', 77: 'Штат/регион завода', 31: 'Город завода', 76: 'Компания-завод',
  10: 'Рынок назначения', 135: 'Турбонаддув', 126: 'Электрификация', 67: 'Система питания', 62: 'Газораспределение', 17: 'Число тактов', 146: 'Производитель двигателя' };
// Позиции VIN, которые задействует ключ шаблона (символы 4–8 до «|», затем 10–17)
export function keyPositions(key: string): number[] {
  const out: number[] = []; let part = 'v', i = 0;
  for (const t of key.match(/\[[^\]]*\]|./g) || []) {
    if (t === '|') { part = 's'; i = 0; continue; }
    const pos = part === 'v' ? 4 + i : 10 + i; i++;
    if (t !== '*') out.push(pos);
  }
  return out;
}

export interface TraceItem {
  el: number;
  label: string;
  value: string | null | undefined;
  key: string | null;
  /** год начала схемы, из которой взят шаблон */
  from: number;
  positions: number[];
}
/** Дополнительный элемент vPIC (оснащение, прицеп, автобус, мотоцикл, батарея…) */
export interface ExtraItem {
  el: number;
  /** подпись по-русски (или название из vPIC, если подписи нет) */
  label: string;
  /** группа vPIC, например «Active Safety System» */
  group: string;
  value: string;
  src: NhSource;
  /** ключ шаблона и задействованные позиции VIN (у Vehicle Specs ключа нет) */
  key: string | null;
  positions: number[];
}
export interface NhtsaYearInfo extends Partial<NhtsaYears> {
  descriptor: boolean;
  candidates: (number | null)[];
  used: number | null;
}
export interface NhtsaResult {
  wmi: string;
  year: number | null;
  /** число совпавших пар «элемент — значение» */
  matched: number;
  make: string | null;
  mfr: string | null;
  vtype: string | null;
  trace: TraceItem[];
  schemas: [number, number][];
  yearInfo: NhtsaYearInfo;
  /** страна по WMI, когда шаблонов не нашлось */
  country?: string | null;
  model?: string | null;
  series?: string | null;
  trim?: string | null;
  body?: string | null;
  doors?: string | null;
  drive?: string | null;
  cyl?: string | null;
  dispL?: number | null;
  hp?: string | null;
  fuel?: string | null;
  fuel2?: string | null;
  engCfg?: string | null;
  engModel?: string | null;
  turbo?: string | null;
  elec?: string | null;
  fuelInj?: string | null;
  valve?: string | null;
  trans?: string | null;
  speeds?: string | null;
  gvwr?: string | null;
  plantCountry?: string | null;
  plantState?: string | null;
  plantCity?: string | null;
  plantCompany?: string | null;
  dest?: string | null;
  engMfr?: string | null;
  wmiCountry?: string | null;
  ambiguous?: boolean;
  /** дополнительные элементы vPIC в порядке групп */
  extra?: ExtraItem[];
  /** основные поля, заполненные не шаблоном VIN: формулой по символам или из Vehicle Specs */
  filled?: { el: number; src: NhSource }[];
}

/** Подпись элемента: русская из таблицы, иначе основная (NH_LABELS), иначе название vPIC */
export function elementLabel(el: number): string {
  return (NH_EXTRA_LABELS[el] || [])[0] || NH_LABELS[el] || ((LK && LK.el[el]) || [])[0] || `Элемент ${el}`;
}
const GROUP_ORDER = new Map(NH_GROUPS.map(([g], i) => [g, i]));

const num = (s: string | null): number | null => { if (s == null) return null; const x = parseFloat(s); return Number.isFinite(x) ? x : null; };
export async function nhtsaDecode(rawVin: string): Promise<NhtsaResult | null> {
  await initNhtsa();
  const { LK } = loaded();
  const vin = String(rawVin).toUpperCase();
  const w = wmiInfo(wmiKey(vin));
  if (!w) return null;
  // варианты года: по дескриптору (известные номера), иначе по правилам года
  const desc = (vin.slice(0, 8) + '*' + vin.slice(9)).slice(0, vin[2] === '9' ? 14 : 11);
  let cands: (number | null)[] = [];
  if (LK.desc[desc]) cands = [LK.desc[desc]];
  else { const y = nhtsaYears(vin); if (y) { cands = [y.rmy]; if (y.omy) cands.push(y.omy); } else cands = [null]; }
  let bestPass: Pass | null = null, yearUsed: number | null = null;
  for (const y of cands) {
    const r = await pass(vin, y, w);
    if (!bestPass || r.count > bestPass.count) { bestPass = r; yearUsed = y; }
  }
  const yearInfo: NhtsaYearInfo = { descriptor: !!LK.desc[desc], candidates: cands, ...(nhtsaYears(vin) || {}), used: yearUsed };
  if (!bestPass || !bestPass.best.size) return { trace: [], schemas: [], yearInfo, wmi: wmiKey(vin), year: yearUsed, matched: 0, mfr: LK.mfr[w[0]] || null, vtype: LK.vtype[w[2]] || null, country: LK.country[w[4]] || null, make: LK.make[w[1]] || null };
  const b = bestPass.best;
  const specs = await vehicleSpecs(wmiKey(vin), w, yearUsed, bestPass);
  // основные поля: шаблон VIN, затем Vehicle Specs (vPIC добавляет их с наименьшим приоритетом)
  // значения по умолчанию для типа ТС (у мотоциклов — класс полной массы 1A)
  const defaults = new Map<number, Match>();
  for (const [el, attr] of LK.defaults[w[2]] || []) if (!b.has(el) && !specs.has(el) && !bestPass.multi.has(el)) defaults.set(el, { el, attr, prio: 10, src: 'default' });
  const got = (el: number): Match | undefined => b.get(el) || specs.get(el) || defaults.get(el);
  const val = (el: number): string | null => { const m = got(el); return m ? m.attr : null; };
  const look = (el: number): string | null => { const v = val(el); return v == null ? null : (elementLookup(LK, el) || {})[v] || null; };
  const shownAttr = (el: number, attr: string): string => { const t = elementLookup(LK, el); return t ? t[attr] || attr : attr; };
  // дополнительные элементы: всё, что не попало в основные поля
  const extra: ExtraItem[] = [];
  const addExtra = (m: Match) => {
    // как в выдаче vPIC: табуляции и переводы строк заменяются пробелами
    const value = shownAttr(m.el, m.attr).replace(/[\t\r\n]/g, ' ').trim();
    if (!value || extra.some(x => x.el === m.el && x.value === value)) return;
    extra.push({ el: m.el, label: elementLabel(m.el), group: (LK.el[m.el] || [])[1] || '', value, src: m.src, key: m.key || null, positions: m.key ? keyPositions(m.key) : [] });
  };
  const isExtra = (el: number) => !CORE.has(el) || CORE_NO_FIELD.has(el);
  for (const [el, m] of b) if (isExtra(el)) addExtra(m);
  for (const ms of bestPass.multi.values()) ms.forEach(addExtra);
  for (const [el, m] of specs) if (isExtra(el)) addExtra(m);
  for (const [el, m] of defaults) if (isExtra(el)) addExtra(m);
  extra.sort((x, y) => (GROUP_ORDER.get(x.group) ?? 99) - (GROUP_ORDER.get(y.group) ?? 99) || x.el - y.el);
  const filled: { el: number; src: NhSource }[] = [];
  for (const el of CORE) { const m = got(el); if (m && (m.src === 'formula' || m.src === 'spec' || m.src === 'default')) filled.push({ el, src: m.src }); }
  const shown = (el: number): string | null | undefined => {
    if (el === 28) { const v = val(28); return v == null ? undefined : (LK.model[v] || [])[0]; }
    return elementLookup(LK, el) ? look(el) : val(el);
  };
  const trace: TraceItem[] = [...b.entries()].filter(([el]) => NH_LABELS[el]).map(([el, it]) => ({ el, label: NH_LABELS[el], value: shown(el), key: it.key || null, from: it.prio, positions: it.key ? keyPositions(it.key) : [] }));
  const mv = val(28);
  const model = mv ? LK.model[mv] : null;
  let make: string | null = model && model[1] ? LK.make[model[1]] : null;
  if (!make) { const wm = (LK.wmiMake[wmiKey(vin)] || []); make = wm.length === 1 ? LK.make[wm[0]] : LK.make[w[1]] || null; }
  let dispL = num(val(13));
  const cc = num(val(11)), ci = num(val(12));
  if (dispL == null && cc != null) dispL = Math.round(cc / 100) / 10;
  if (dispL == null && ci != null) dispL = Math.round(ci * 0.016387064 * 10) / 10;
  const hpFrom = num(val(71)), hpTo = num(val(125));
  return {
    wmi: wmiKey(vin), year: yearUsed, matched: bestPass.count, make, model: model ? model[0] : null, series: val(34), trim: val(38),
    body: look(5), doors: val(14), drive: look(15), cyl: val(9), dispL, hp: hpFrom != null ? (hpTo != null && hpTo !== hpFrom ? `${hpFrom}–${hpTo}` : String(hpFrom)) : null,
    fuel: look(24), fuel2: look(66), engCfg: look(64), engModel: val(18), turbo: look(135), elec: look(126), fuelInj: look(67), valve: look(62), trans: look(37), speeds: val(63),
    gvwr: look(25), plantCountry: look(75), plantState: val(77), plantCity: val(31), plantCompany: val(76), dest: look(10), engMfr: val(146),
    mfr: LK.mfr[w[0]] || null, vtype: LK.vtype[w[2]] || null, wmiCountry: LK.country[w[4]] || null, ambiguous: cands.length > 1,
    trace, schemas: bestPass.schemasUsed, yearInfo, extra, filled,
  };
}

// Известные исключения: номера, у которых производитель ошибся в контрольной цифре (список NHTSA)
let EXC: Set<string> | null = null;
export async function isCheckException(vin: string): Promise<boolean> {
  if (!EXC) EXC = new Set(await loadJson('./nhtsa/exceptions.json') as string[]);
  return EXC.has(String(vin).toUpperCase());
}

// ---------- Генератор правдоподобных номеров ----------
const VIN_CHARS = '0123456789ABCDEFGHJKLMNPRSTUVWXYZ';
const YEAR_CHARS = 'ABCDEFGHJKLMNPRSTVWXY123456789';
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
const TRANSL: Record<string, number> = { A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9, S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9 };
function checkDigit(vin: string): string {
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += (/\d/.test(vin[i]) ? +vin[i] : TRANSL[vin[i]]) * WEIGHTS[i];
  const r = sum % 11; return r === 10 ? 'X' : String(r);
}
const rndInt = (a: number, b: number): number => a + Math.floor(Math.random() * (b - a + 1));
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];
function classChars(tok: string): string[] {   // «[A-CE]» -> массив допустимых символов
  const body = tok.slice(1, -1), out: string[] = [];
  for (let i = 0; i < body.length; i++) {
    if (body[i + 1] === '-' && body[i + 2] && body[i].charCodeAt(0) <= body[i + 2].charCodeAt(0)) {
      for (let c = body[i].charCodeAt(0); c <= body[i + 2].charCodeAt(0); c++) out.push(String.fromCharCode(c));
      i += 2;
    } else out.push(body[i]);
  }
  return out.filter(c => VIN_CHARS.includes(c));
}
interface KeySample { vds: (string | null)[]; vis: Record<number, string> }
function sampleKey(key: string): KeySample {
  const vds: (string | null)[] = [null, null, null, null, null], vis: Record<number, string> = {};
  let part = 'v', i = 0;
  for (const t of key.match(/\[[^\]]*\]|./g) || []) {
    if (t === '|') { part = 's'; i = 0; continue; }
    const c = t === '*' ? null : t[0] === '[' ? (classChars(t).length ? pick(classChars(t)) : null) : t;
    if (part === 'v') { if (i < 5) vds[i] = c; } else if (c) vis[10 + i] = c;
    i++;
  }
  return { vds, vis };
}

/** Схемы, где есть шаблоны основных элементов (без схем только с прицепами, осями и т. п.) */
const coreRefs = (w: WmiEntry): SchemaRef[] => w[5].filter(r => r.length < 5);

export type Region = 'na' | 'eu' | 'as' | 'any';
const REGIONS: Record<Region, (c: string) => boolean> = { na: c => '12345'.includes(c), eu: c => 'STUVWXYZ'.includes(c), as: c => 'JKLMNPR'.includes(c), any: () => true };
const isRegion = (r: unknown): r is Region => typeof r === 'string' && r in REGIONS;
interface Pool { list: string[]; cum: number[]; total: number }
let POOLS: Record<Region, Pool> | null = null;

export interface GeneratedVin { vin: string; nh: NhtsaResult; wmi: string; year: number }
export async function generateVin(opts: { region?: string } = {}): Promise<GeneratedVin | null> {
  await initNhtsa();
  const { IDX } = loaded();
  const region: Region = isRegion(opts.region) ? opts.region : 'any';
  if (!POOLS) {
    const pools = {} as Record<Region, Pool>;
    for (const r of Object.keys(REGIONS) as Region[]) {
      const list = Object.keys(IDX).filter(k => k.length === 3 && REGIONS[r](k[0]) && isCarMpvLt(IDX[k]) && coreRefs(IDX[k]).length);
      let acc = 0;   // вес = число схем: у массовых производителей их много, у штучных один-два
      pools[r] = { list, cum: list.map(k => (acc += Math.min(coreRefs(IDX[k]).length, 40) ** 1.5)), total: acc };
    }
    POOLS = pools;
  }
  const P = POOLS[region], pool = P.list;
  const weighted = (): string => { const x = Math.random() * P.total; let lo = 0, hi = P.cum.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (P.cum[m] < x) lo = m + 1; else hi = m; } return pool[lo]; };
  const nowY = new Date().getFullYear();
  for (let attempt = 0; attempt < 80 && pool.length; attempt++) {
    const wmi = weighted(), w = IDX[wmi], sc = pick(coreRefs(w));
    const lo = Math.max(sc[0] || 1981, 1981), hi = Math.min(sc[1] || 2999, nowY + 1);
    if (hi < lo) continue;
    const year = rndInt(lo, hi);
    const sh = await loadShard(sc[2]);
    // только обычные шаблоны с основными элементами: генератор опирается на модель, кузов, двигатель и завод
    const items = (sh.get(sc[3]) || []).filter(p => p.core && !p.formula);
    const models = items.filter(p => p.pairs.some(([el]) => el === 28));
    if (!models.length) continue;
    const p = pick(models), { vds, vis } = sampleKey(p.key);
    if (vis[10]) continue;   // ключ фиксирует символ года: пропускаем
    // добавляем согласованные шаблоны кузова, комплектации, двигателя и КПП, чтобы сочетание символов было правдоподобным
    for (const el of [5, 38, 18, 13, 9, 24, 37].sort(() => Math.random() - 0.5)) {
      const cands = items.filter(q => q.pairs.some(([e]) => e === el));
      for (let t = 0; t < 8 && cands.length; t++) {
        const s2 = sampleKey(pick(cands).key);
        if (s2.vis[10]) continue;
        const clash = s2.vds.some((c, k) => c && vds[k] && c !== vds[k]) || Object.keys(s2.vis).some(k => vis[+k] && vis[+k] !== s2.vis[+k]);
        if (clash) continue;
        s2.vds.forEach((c, k) => { if (c && !vds[k]) vds[k] = c; });
        for (const [k, c] of Object.entries(s2.vis)) if (!vis[+k]) vis[+k] = c;
        break;
      }
    }
    const late = year >= 2010;
    const chars = [...wmi];
    for (let k = 0; k < 5; k++) {
      let c = vds[k];
      if (!c) c = k === 3 ? pick(late ? [...'ABCDEFGHJKLMNPRSTUVWXYZ'] : [...'0123456789']) : pick([...VIN_CHARS]);
      chars.push(c);
    }
    chars.push('0');                                   // место контрольной цифры
    chars.push(YEAR_CHARS[(year - 1980) % 30]);
    const plantPool = [...new Set(items.map(q => (q.key.split('|')[1] || '')[1]).filter(c => c && c !== '*' && VIN_CHARS.includes(c)))];
    chars.push(vis[11] || (plantPool.length ? pick(plantPool) : pick([...'ABCDEFGHJKLMNPRSTUVWXYZ123456789'])));
    for (let k = 12; k <= 17; k++) chars.push(vis[k] || String(k === 12 ? rndInt(1, 9) : rndInt(0, 9)));
    let vin = chars.join('');
    vin = vin.slice(0, 8) + checkDigit(vin) + vin.slice(9);
    const nh = await nhtsaDecode(vin);
    // принимаем только номера, для которых база знает модель, кузов и двигатель: так получаются полноценные расшифровки
    if (nh && nh.make && nh.model && nh.year === year && nh.matched >= 6 && nh.body && (nh.dispL || nh.cyl || nh.elec)) return { vin, nh, wmi, year };
  }
  return null;
}
