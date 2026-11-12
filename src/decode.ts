// Локальный декодер VIN (ISO 3779): без сети, только по символам.
import { COUNTRY_SPANS, WMI_DB, DETAILS } from './data/vindata';
import { WMI_WIKI } from './data/wmi-wiki';
import { WMI_WB } from './data/wmi-wb';
import { wmiInfo, wmiKey, nhtsaLookups } from './nhtsa';
import { PLANTS_WB } from './data/plants-wb';
import { VOLVO_WB } from './data/volvo-wb';
import { KIA_WB } from './data/kia-wb';
import { VWAUDI_WB } from './data/vwaudi-wb';
import { GM_PLANTS_WB, FORD_PLANTS_WB, CHRYSLER_PLANTS_WB } from './data/plants-us-wb';
import { JDM_WIKI } from './data/jdm-wiki';
import { MB_WB } from './data/mb-wb';
import { JLR_WB } from './data/jlr-wb';
import { BMW02_US } from './data/bmw02';
import { P356 } from './data/p356';
import { TP_AMC, TP_FORD, TP_GM, TP_MOPAR } from './data/legacy-tp';
import { USSR_WMI, USSR_BRAND, USSR_MODELS } from './data/ussr';
import type { Dict, BrandSpec, FieldSpec, YearSpanEntry } from './data/types';
import type { ErrorDecode, IsoDecode, JdmDecode, LegacyDecode, LocalDecode, MitchellPack, PartialDecode, PlantInfo, PlantWb, Row, Segment, YearInfo } from './types';
import { decodeJdmCert } from './jdm-cert';

// ---- Справочник Mitchell 1 — отдельный подключаемый пакет (src/mitchell.ts) ----
// Без пакета декодер работает только на открытых источниках; с пакетом добавляются таблицы Mitchell 1 «2009 VIN Decoding».
// Пакет подключает точка входа (флаг сборки VIN_MITCHELL) или пользователь библиотеки: useMitchell(MITCHELL).
let MP: MitchellPack | null = null;
/** Подключить (или отключить, передав null) данные справочника Mitchell 1 */
export function useMitchell(pack: MitchellPack | null): void { MP = pack; }
/** Подключён ли пакет Mitchell 1 */
export const hasMitchell = (): boolean => MP !== null;

const ORDER = 'ABCDEFGHJKLMNPRSTUVWXYZ1234567890';
const YEAR_CHARS = 'ABCDEFGHJKLMNPRSTVWXY123456789';

// Страны по первым двум символам WMI (ISO 3780). Диапазоны из vininfo, распакованы так же, как в оригинале.
const COUNTRY_EXTRA = [['B-CC', 'Эфиопия'], ['B-HH', 'Руанда'], ['B-TT', 'Эсватини (Свазиленд)'], ['B-UU', 'Уганда'], ['E-A0', 'Россия']];
const COUNTRY_MAP = (() => {
  const m: Dict = {};
  const extraOnly = new Set(COUNTRY_EXTRA.map(x => x[0]));
  for (const [code, title] of [...COUNTRY_SPANS, ...COUNTRY_EXTRA]) {
    const isExtra = extraOnly.has(code);
    const i = code.indexOf('-'), first = code.slice(0, i), span = code.slice(i + 1);
    const from = span ? span[0] : 'A', till = span ? span[1] : '0';
    for (const ch of ORDER.slice(ORDER.indexOf(from), ORDER.indexOf(till) + 1)) if (!isExtra || !m[first + ch]) m[first + ch] = title;
  }
  return m;
})();

// Частые WMI (3 символа) → производитель
const WMI: Dict = {
  WVW:'Volkswagen',WV1:'Volkswagen (коммерческие)',WV2:'Volkswagen (микроавтобусы)',WV3:'Volkswagen (грузовые)',WVG:'Volkswagen (SUV)',
  WAU:'Audi',WUA:'Audi Sport (quattro)',TRU:'Audi (Венгрия)',WBA:'BMW',WBS:'BMW M',WBY:'BMW i',WDB:'Mercedes-Benz',WDC:'Mercedes-Benz (SUV)',
  WDD:'Mercedes-Benz',WDF:'Mercedes-Benz (фургоны)',W1K:'Mercedes-Benz',W1N:'Mercedes-Benz (SUV)',W1V:'Mercedes-Benz (Vito/Sprinter)',
  WME:'Smart',WMW:'MINI',WP0:'Porsche',WP1:'Porsche (SUV)',WAP:'Alpina',W0L:'Opel',W0V:'Opel/Vauxhall',WF0:'Ford (Германия)',WMA:'MAN',
  VF1:'Renault',VF3:'Peugeot',VF7:'Citroën',VF6:'Renault Trucks',VR1:'DS Automobiles',VNK:'Toyota (Франция)',
  TMB:'Škoda',TMA:'Hyundai (Чехия)',U5Y:'Kia (Словакия)',VSS:'SEAT',VSK:'Nissan (Испания)',UU1:'Dacia',
  YV1:'Volvo',YV4:'Volvo (SUV)',YS3:'Saab',ZFA:'Fiat',ZFF:'Ferrari',ZAR:'Alfa Romeo',ZHW:'Lamborghini',ZAM:'Maserati',ZLA:'Lancia',
  SAL:'Land Rover',SAJ:'Jaguar',SCC:'Lotus',SCF:'Aston Martin',SJN:'Nissan (Великобритания)',SB1:'Toyota (Великобритания)',SAR:'Rover',
  KNA:'Kia',KND:'Kia (SUV)',KNM:'Renault Samsung',KMH:'Hyundai',KMC:'Hyundai (коммерческие)',KPT:'SsangYong',KL1:'Chevrolet/Daewoo (Корея)',KLA:'Daewoo',
  JHM:'Honda',JHL:'Honda (SUV)',JN1:'Nissan',JN8:'Nissan (SUV)',JTD:'Toyota',JTE:'Toyota (SUV)',JTH:'Lexus',JTM:'Toyota (RAV4)',JTN:'Toyota',
  JF1:'Subaru',JF2:'Subaru (SUV)',JM1:'Mazda',JM3:'Mazda (SUV)',JMZ:'Mazda',JS1:'Suzuki (мото)',JS2:'Suzuki',JS3:'Suzuki (SUV)',JMB:'Mitsubishi',JA3:'Mitsubishi',JA4:'Mitsubishi (SUV)',
  '1G1':'Chevrolet','1GC':'Chevrolet (грузовики)','1FA':'Ford','1FT':'Ford (грузовики)','1FM':'Ford (SUV)','1FD':'Ford (коммерческие)',
  '1C4':'Chrysler/Jeep/Dodge','1J4':'Jeep','1HG':'Honda','1N4':'Nissan','1LN':'Lincoln','1ZV':'Ford (Flat Rock)',
  '2HG':'Honda (Канада)','2T1':'Toyota (Канада)','3FA':'Ford (Мексика)','3VW':'Volkswagen (Мексика)','3N1':'Nissan (Мексика)',
  '4T1':'Toyota (США)','5YJ':'Tesla','7SA':'Tesla (Fremont/Austin)','5UX':'BMW (США)','5N1':'Nissan (США)','5NP':'Hyundai (США)','5XY':'Kia (США)',
  LFV:'FAW-Volkswagen',LSV:'SAIC-Volkswagen',LVS:'Ford (Китай)',LHG:'GAC Honda',LGB:'Dongfeng Nissan',LBV:'BMW Brilliance',LSG:'SAIC-GM',LRW:'Tesla (Шанхай)',LFP:'FAW',
  XTA:'ВАЗ (Lada)',XTT:'УАЗ',X9F:'Ford (Россия)',X7L:'Renault (Россия)',XW8:'Volkswagen (Россия)',Z94:'Hyundai (Россия)',XWE:'Kia (Россия)',
  Y6D:'ЗАЗ',NM4:'Tofaş (Fiat)',NLH:'Hyundai (Турция)',NM0:'Ford (Турция)',NMT:'Toyota (Турция)',
  MAL:'Hyundai (Индия)',MA3:'Maruti Suzuki',MHF:'Toyota (Индонезия)',MR0:'Toyota (Таиланд)',MNB:'Ford (Таиланд)',
};

// Коды завода (11-й символ). Единого стандарта нет: у каждой марки своя таблица.
// Здесь только то, в чём есть уверенность; список неполный.
const PLANTS: { wmi: string[]; maker: string; map: Dict }[] = [
  { wmi: ['1FA','1FT','1FM','1FD','1ZV'], maker: 'Ford (Сев. Америка)', map: {
    A:'Атланта, США', B:'Оквилл, Канада', F:'Дирборн, США', G:'Чикаго, США', H:'Лорейн, США', K:'Канзас-Сити, США',
    L:'Мичиган (Уэйн), США', M:'Куаутитлан, Мексика', N:'Норфолк, США', P:'Сент-Пол, США', R:'Сан-Хосе, США',
    S:'Аллен-Парк, США', T:'Эдисон, США', U:'Луисвилл, США', W:'Уэйн, США', X:'Сент-Томас, Канада', Z:'Сент-Луис, США', 5:'Флэт-Рок, США' } },
  { wmi: ['1HG'], maker: 'Honda (США)', map: { A:'Мэрисвилл, Огайо' } },
  { wmi: ['5YJ','7SA','LRW','XP7'], maker: 'Tesla', map: {
    F:'Фримонт, США', A:'Остин (Giga Texas), США', C:'Шанхай, Китай', B:'Грюнхайде (Giga Berlin), Германия' } },
  { wmi: ['WVW','WVG','WV1','WV2'], maker: 'Volkswagen', map: {
    D:'Братислава, Словакия', E:'Эмден, Германия', H:'Ганновер, Германия', K:'Оснабрюк, Германия', W:'Вольфсбург, Германия' } },
  { wmi: ['WAU'], maker: 'Audi', map: { A:'Ингольштадт, Германия', N:'Неккарсульм, Германия' } },
];

function plantOf(wmi: string, ch: string): PlantInfo {
  const p = PLANTS.find(x => x.wmi.includes(wmi));
  if (!p) return { name: null, known: false };
  return { name: p.map[ch] || null, known: true, maker: p.maker };
}

const TRANSLIT: Dict<number> = {A:1,B:2,C:3,D:4,E:5,F:6,G:7,H:8,J:1,K:2,L:3,M:4,N:5,P:7,R:9,S:2,T:3,U:4,V:5,W:6,X:7,Y:8,Z:9};
const WEIGHTS = [8,7,6,5,4,3,2,10,0,9,8,7,6,5,4,3,2];

export function normalize(raw: unknown): string {
  return String(raw).toUpperCase().replace(/[\s\-_]/g, '');
}

function regionOf(c: string): string | null {
  if ('ABC'.includes(c)) return 'Африка';
  if ('JKLMNPR'.includes(c)) return 'Азия';
  if ('STUVWXYZE'.includes(c)) return 'Европа';
  if ('123457'.includes(c)) return 'Северная Америка';
  if (c === '6') return 'Океания';
  if ('89'.includes(c)) return 'Южная Америка';
  return null;
}

function countryOf(wmi: string): string | null {
  return COUNTRY_MAP[wmi.slice(0, 2)] || null;
}

// Производитель по WMI: сначала словарь vininfo (3 символа, затем 2), потом наша небольшая таблица
// Дополнения из universal-vin-decoder (MIT): коды, которых нет в vininfo (или у vininfo есть только 2-символьный префикс)
const WMI_EXTRA: Dict = {
  '3H3': 'Hyundai', KRT: 'Hyundai (Корея)', KRV: 'Hyundai (Корея)', MB2: 'Hyundai (Индия)', MC3: 'Hyundai (Индия)',
  NA6: 'Rayen Vehicle Manufacturing, RVMCO (Иран)', X7M: 'ТагАЗ (Россия, сборка Hyundai)', X89: 'КузбассАвто (Россия)',
  XU7: 'Ростовский завод грузовиков, РЗГА (Россия)', Y6L: 'ЛуАЗ (Украина)', Z94: 'Hyundai (Россия)',
};

const WMI_OVERRIDE: Dict = {
  Y6D: 'ЗАЗ, Запорожье (часть моделей собрана по лицензии Opel)', // в vininfo это Opel, но под этим кодом выпускали и собственные ЗАЗ
  KMH: 'Hyundai / Genesis',
};

// Завод (11-й символ) по таблицам Wikibooks: марка определяется по названию производителя
function plantWbKey(maker: string | null | undefined, wmi: string): string | null {
  const m = maker || '';
  if (/Audi/i.test(m)) return 'audi';
  if (/Volkswagen|\bVW\b/i.test(m)) return 'vw';
  if (/Mercedes|Daimler|Maybach/i.test(m)) return 'mercedes';
  if (/Porsche/i.test(m)) return 'porsche';
  if (/Saab/i.test(m)) return 'saab';
  if (/Volvo/i.test(m)) return 'volvo';
  if (/Peugeot/i.test(m)) return 'peugeot';
  if (/Hyundai/i.test(m)) return 'hyundai';
  if (/\bKia\b/i.test(m)) return 'kia';
  if (/Isuzu/i.test(m)) return 'isuzu';
  if (/Daewoo/i.test(m)) return 'daewoo';
  if (/Daihatsu/i.test(m)) return 'daihatsu';
  if (/Land Rover/i.test(m)) return 'landrover';
  if (/Jaguar/i.test(m)) return 'jaguar';
  if (/Honda|Acura/i.test(m)) return 'honda';
  if (/Nissan|Infiniti/i.test(m)) return 'nissan';
  if (/Mazda/i.test(m)) return 'mazda';
  if (/Mitsubishi/i.test(m)) return 'mitsubishi';
  if (/Toyota|Lexus|Scion/i.test(m)) return 'toyota';
  if ('123'.includes(wmi[0])) {   // у североамериканских марок таблицы по заводам США; у европейских Ford и GM другая схема
    if (/\bFord\b|Lincoln|Mercury/i.test(m)) return 'ford';
    if (/General Motors|\bGM\b|Chevrolet|Pontiac|Buick|Cadillac|Oldsmobile|GMC|Saturn/i.test(m)) return 'gm';
    if (/Chrysler|Dodge|Jeep|\bRam\b|Plymouth|Eagle|FCA/i.test(m)) return 'chrysler';
  }
  return null;
}
function plantWb(maker: string | null, wmi: string, ch: string): PlantWb | null {
  const k = plantWbKey(maker, wmi);
  const v = k && PLANTS_WB[k] && PLANTS_WB[k][ch];
  return v ? { text: v, brand: k } : null;
}

interface Assembler { maker: string | null; key: string | null; src: string | null }
/** Производитель по WMI. code12 — символы 12–14: у мелкосерийных (третий символ 9) производитель задан шестью символами */
function assemblerOf(wmi: string, code12?: string): Assembler {
  if (WMI_OVERRIDE[wmi]) return { maker: WMI_OVERRIDE[wmi], key: null, src: 'ручная поправка' };
  if (wmi[2] === '9' && code12 && /^[0-9A-Z]{3}$/.test(code12) && WMI_WIKI[wmi + code12])
    return { maker: WMI_WIKI[wmi + code12], key: null, src: 'словарь WMI из Википедии (мелкосерийный производитель, символы 1–3 и 12–14)' };
  // код с 9 на третьем месте общий для многих мелкосерийных производителей: одно название из словаря назвало бы случайного из них
  // (vininfo: 1G9 — Google). Берём только общую строку Википедии (там перечислены все), иначе — база NHTSA по шести символам.
  if (wmi[2] === '9' && code12 && USSR_WMI[wmi + code12])
    return { maker: USSR_WMI[wmi + code12], key: null, src: 'русская Википедия: мелкие заводы бывшего СССР (символы 1–3 и 12–14)' };
  if (wmi[2] === '9') return WMI_WIKI[wmi] ? { maker: WMI_WIKI[wmi], key: null, src: 'словарь WMI из Википедии (общий код мелкосерийных производителей)' } : { maker: null, key: null, src: null };
  const vi = WMI_DB[wmi];
  const viKey = Array.isArray(vi) ? vi[1] : null;
  const viName = Array.isArray(vi) ? vi[0] : vi;
  // 1) vininfo с деталями по марке, чтобы название совпадало с разбором
  if (viKey) return { maker: viName, key: viKey, src: 'vininfo (словарь WMI с деталями по марке)' };
  // 2) словарь из Википедии (UVD2): точный код, названия подробнее и свежее
  if (WMI_WIKI[wmi]) return { maker: WMI_WIKI[wmi], key: null, src: 'словарь WMI из Википедии' };
  if (WMI_WB[wmi]) return { maker: WMI_WB[wmi], key: null, src: 'Wikibooks (список WMI)' };
  if (USSR_WMI[wmi]) return { maker: USSR_WMI[wmi], key: null, src: 'русская Википедия: заводы бывшего СССР' };
  // 3) vininfo, наши дополнения, затем префиксы из двух символов
  if (viName !== undefined) return { maker: viName, key: null, src: 'vininfo (словарь WMI)' };
  if (WMI_EXTRA[wmi] || WMI[wmi]) return { maker: WMI_EXTRA[wmi] || WMI[wmi], key: null, src: WMI_EXTRA[wmi] ? 'дополнения из UVD (Java)' : 'собственная таблица' };
  const p = wmi.slice(0, 2);
  const pv = WMI_WIKI[p] ?? WMI_WB[p] ?? WMI_DB[p];
  if (pv === undefined) return { maker: null, key: null, src: null };
  return Array.isArray(pv) ? { maker: pv[0], key: pv[1], src: 'по первым двум символам WMI' } : { maker: pv, key: null, src: 'по первым двум символам WMI' };
}

// Другие названия того же WMI в словарях, если они называют другую марку (vininfo — «Scion», Википедия — «Toyota car»).
// Сравниваются значимые слова: «Honda» и «Honda car made by …» не считаются расхождением.
const STOP = new Set(['the', 'of', 'co', 'ltd', 'inc', 'motor', 'motors', 'company', 'car', 'cars', 'corp', 'gmbh', 'by', 'made', 'and', 'sa', 'ag', 'suv', 'mpv', 'truck', 'van', 'bus']);
const words = (x: string): string[] => x.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').split(' ').filter(w => w.length > 1 && !STOP.has(w));
export function makerAlternatives(wmi: string, chosen: string | null): [name: string, src: string][] {
  if (!chosen || WMI_OVERRIDE[wmi]) return [];
  const vi = WMI_DB[wmi];
  const cands: [string, string][] = [];
  if (WMI_WIKI[wmi]) cands.push([WMI_WIKI[wmi], 'Википедия']);
  if (vi !== undefined) cands.push([Array.isArray(vi) ? vi[0] : vi, 'vininfo']);
  if (WMI_WB[wmi]) cands.push([WMI_WB[wmi], 'Wikibooks']);
  const mine = new Set(words(chosen));
  const out: [string, string][] = [];
  for (const [name, src] of cands) {
    const w = words(name);
    if (name === chosen || !w.length || !mine.size || w.some(x => mine.has(x))) continue;
    if (out.some(([n]) => words(n).some(x => w.includes(x)))) continue;   // то же самое из другого словаря
    out.push([name, src]);
  }
  return out;
}

// Hyundai: 4-й символ как линия модели, 11-й как завод. Таблицы из universal-vin-decoder (Java, MIT),
// которые, в свою очередь, взяты из руководства youcanic.com. Это схема 1990-х – 2010-х; для новых моделей возможны совпадения кодов.
const HY_LINE: Dict = { A: 'Atos / Santro / Visto / i10', B: 'Click / Getz', C: 'Accent / Verna / Solaris', D: 'Elantra (XD) / Lantra / i30 / Avante',
  E: 'Sonata (кроме Северной Америки; индийская Sonata)', F: 'Grandeur XG / Azera', G: 'Genesis', H: 'Coupe / Tuscani / Tiburon', J: 'Tucson (2005+); раньше Elantra (2000) и Tiburon (2000–01)',
  K: 'Galloper', M: 'Carstar / Santamo / Trajet', N: 'Terracan / Veracruz', P: 'Matrix', R: 'Grace', S: 'Santa Fe',
  W: 'Starex / H1 / H100 (и Sonata для Северной Америки)' };
const HY_PLANT: Dict = { A: 'Асан (Корея)', C: 'Чонджу (Корея)', U: 'Ульсан (Корея)', Z: 'Измит (Турция)' };
const HY_WMI = /^(KM.|NLH|NLJ|Z94|MAL|X7M)$/;

function hyundaiDetails(vin: string): Row[] | null {
  if (!HY_WMI.test(vin.slice(0, 3))) return null;
  const line = HY_LINE[vin[3]];
  const rows: Row[] = [['Линия модели (4-й символ)', line || `код ${vin[3]}`,
    line ? 'по таблице UVD, предположительно; у новых моделей коды могут повторяться, сверяйтесь с блоком NHTSA' : 'нет в справочнике']];
  const body = MP && MP.hyundaiBody[vin[5]];
  if (/^KMH/.test(vin) && vin[3] !== 'W' && body) rows.push(['Кузов (6-й символ)', body, 'по справочнику Mitchell 1 для 2000–2008 годов, кроме Sonata']);
  if (HY_PLANT[vin[10]]) rows.push(['Завод Hyundai (11-й символ)', `${HY_PLANT[vin[10]]} (${vin[10]})`, 'по таблице UVD']);
  return rows;
}

// ---- Помощники для игры: обратный поиск по названию производителя и таблицам заводов ----
let MAKER_INDEX: Map<string, string[]> | null = null;
export function wmiByMaker(maker: string): string[] {
  if (!MAKER_INDEX) {
    MAKER_INDEX = new Map();
    const keys = new Set([...Object.keys(WMI_DB), ...Object.keys(WMI_WIKI), ...Object.keys(WMI_WB), ...Object.keys(WMI), ...Object.keys(WMI_EXTRA), ...Object.keys(WMI_OVERRIDE)]);
    for (const k of keys) {
      if (k.length !== 3) continue;
      const m = assemblerOf(k).maker;
      if (!m) continue;
      const list = MAKER_INDEX.get(m);
      if (list) list.push(k); else MAKER_INDEX.set(m, [k]);
    }
  }
  return MAKER_INDEX.get(maker) || [];
}
export function plantTable(maker: string | null | undefined, wmi: string): { key: string; map: Dict } | null {
  const k = plantWbKey(maker, wmi);
  return k && PLANTS_WB[k] ? { key: k, map: PLANTS_WB[k] } : null;
}

// Детали по марке (Lada, Renault, Opel, Nissan, Ford Australia): коды позиций 5–17 по таблицам vininfo
const isField = (v: BrandSpec[string]): v is FieldSpec => !!v && typeof v === 'object' && !Array.isArray(v);
function brandDetails(vin: string, key: string): Row[] | null {
  const spec = DETAILS[key];
  if (!spec) return null;
  const val = (d: FieldSpec) => {
    const code = vin.slice(d.src[0], d.src[1]);
    let defs = d.defs || {};
    if (d.by === 'model') defs = (d.maps || {})[vin.slice(spec.model.src[0], spec.model.src[1])] || {};
    return { code, defs };
  };
  const m = val(spec.model);
  if (!m.defs[m.code]) return null; // марка найдена, но модель по коду не определилась
  const hide = spec._hide || [];
  const rows: Row[] = [];
  for (const k of Object.keys(spec)) {
    if (k[0] === '_' || hide.includes(k)) continue;
    const d = spec[k];
    if (!isField(d) || !d.src) continue;
    const { code, defs } = val(d);
    const name = defs[code];
    if (name) rows.push([d.label, Array.isArray(name) ? name.join(' / ') : name, null]);
    else if (Object.keys(defs).length) rows.push([d.label, `код ${code}`, 'нет в справочнике']);
    else rows.push([d.label, code, null]);
  }
  return rows;
}

export function checkDigit(vin: string): string {
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const c = vin[i];
    const v = /\d/.test(c) ? +c : TRANSLIT[c];
    sum += v * WEIGHTS[i];
  }
  const r = sum % 11;
  return r === 10 ? 'X' : String(r);
}

function modelYear(vin: string, pos = 9): YearInfo | null {
  const i = YEAR_CHARS.indexOf(vin[pos]);
  if (i < 0) return null;
  const now = new Date().getFullYear();
  const cands = [1980 + i, 2010 + i].filter(y => y <= now + 1);
  let value = cands[cands.length - 1], alt = cands.length > 1 ? cands[0] : null;
  // Правило Северной Америки: 7-й символ буква → 2010+, цифра → до 2009
  if (/[1-5]/.test(vin[0]) && cands.length > 1) {
    const late = /[A-Z]/.test(vin[6]);
    value = late ? cands[1] : cands[0];
    alt = null;
  }
  return { value, alt };
}


// ---- Старые VIN (до 1981): у каждой фирмы своя схема ----
// Каждый декодер возвращает: segments (для окраски символов) и rows (строки для вывода).
export const NOTE_STD = 'до 1981 года единого стандарта не было: у каждой фирмы своя схема';

export function legacyResult(vin: string, format: string, segments: Segment[], rows: Row[]): LegacyDecode {
  return { vin, legacy: true, errors: [], format, segments, rows };
}

// Chrysler Corporation 1968–1980, 13 символов: «BS23J0B275411». Источник таблиц: MoTales (D. Zatz).
const CH_LINE: Dict = { B: 'Barracuda (1968–74), Caravelle (Канада)', C: 'Newport, 300, New Yorker и другие Chrysler', D: 'Polara, Monaco, Dodge',
  E: 'St. Regis', F: 'LeBaron', G: 'Diplomat', H: 'Volare', J: 'Challenger', L: 'Dart', N: 'Aspen', P: 'Fury',
  R: 'Belvedere, Satellite, Fury (1976–78)', S: 'Cordoba', T: 'Newport, New Yorker', V: 'Valiant, Duster',
  W: 'Coronet; Charger с 1971', X: 'Magnum или Charger', Y: 'Imperial (на базе Volare)' };
const CH_PRICE: Dict = { E: 'Economy', L: 'Low', M: 'Medium', H: 'High', P: 'Premium', K: 'Police', N: 'такси Нью-Йорка',
  S: 'Special', T: 'Taxi', O: 'Super Stock', X: 'Fast Top' };
const CH_BODY: Dict = { 1: 'седан', 2: 'хардтоп с B-стойкой', 3: 'хардтоп (другой)', 4: 'хэтчбек', 5: 'универсал (2 ряда)',
  6: 'универсал (3 ряда)', 7: 'кабриолет', 9: 'купе / спецверсия' };
const CH_PLANT: Dict = { A: 'Lynch Road, Детройт', B: 'Hamtramck, Детройт', C: 'Jefferson Ave, Детройт', D: 'Belvidere, Иллинойс',
  E: 'Лос-Анджелес', F: 'Ньюарк, Делавэр', G: 'Сент-Луис, Миссури', H: 'New Stanton, Пенсильвания',
  P: 'Wyoming Road, Виндзор (экспорт)', R: 'Виндзор, Канада', X: 'St. Louis #2 (North), Фентон, Миссури (с 1973)' };
// Коды, которые подтверждает таблица заводов Wikibooks (тот же завод под той же буквой); остальные взяты без первоисточника
const CH_PLANT_OK = new Set(['A', 'C', 'D', 'F', 'G', 'R', 'X']);
export const FORD_PLANT_OK = new Set(['A', 'B', 'C', 'F', 'G', 'H', 'K', 'M', 'N', 'P', 'R', 'S', 'T', 'U', 'W', 'X', 'Y', 'Z']);
/** Строка «Завод» для старых номеров Ford и Chrysler: подтверждён ли код таблицей Wikibooks */
export function plantRow(label: string, own: Dict, ok: Set<string>, wbAll: Dict<string[]>, code: string): Row {
  const name = own[code];
  const later = wbAll[code] && (wbAll[code].length > 2 ? `${wbAll[code].slice(0, 2).join('; ')} и ещё ${wbAll[code].length - 2}` : wbAll[code].join('; '));
  const wb: Dict = later ? { [code]: later } : {};
  if (!name) return [label, code, wb[code] ? `нет в справочнике 1965–1980; в Wikibooks под этой буквой более поздние заводы: ${wb[code]}` : 'нет в справочнике'];
  if (ok.has(code)) return [label, `${name} (${code})`, 'под этой буквой тот же завод и в таблице Wikibooks'];
  return [label, `${name} (${code})`, `по справочнику без первоисточника, возможны неточности${wb[code] ? `; в Wikibooks под этой буквой более поздние заводы: ${wb[code]}` : ''}`];
}
// GM: заводы с годами работы по Wikibooks; для номера выбираются те, что работали в один из возможных годов
export function gmPlantRow(label: string, code: string, years: number[]): Row {
  const all = GM_PLANTS_WB[code] || [];
  const hit = all.filter(([, rs]) => rs.some(([a, b]) => years.some(y => y >= a && y <= b)));
  if (hit.length) return [label, `${hit.map(([n]) => n).join('; ')} (${code})`, 'по таблице заводов GM в Wikibooks, с учётом годов работы завода'];
  const own = GM_PLANT[code];
  return [label, own ? `${own} (${code})` : code, own ? 'по справочнику без первоисточника: в Wikibooks этот код для этих лет не указан' : 'нет в справочнике'];
}
// Код двигателя: [от года, до года, описание]. Коды использовались повторно, значение зависит от года.
const CH_ENGINE: Dict<[number, number, string][]> = {
  A: [[1966,1969,'170 slant six'],[1978,1982,'VW 1.7, 4 цил. (Omni/Horizon)']],
  B: [[1966,1969,'225 slant six'],[1970,1974,'198 slant six']],
  C: [[1968,1969,'slant six, спецзаказ'],[1970,1980,'225 slant six, 1 карб.']],
  D: [[1968,1969,'273 V8'],[1977,1979,'225 slant six, 2 карб.']],
  E: [[1966,1966,'318-2 (грузовики)'],[1967,1967,'273-4 (грузовики)'],[1970,1980,'slant six, спецзаказ']],
  F: [[1966,1966,'361'],[1967,1969,'318, 2 карб.']],
  G: [[1966,1969,'383 V8, 2 карб.'],[1970,1980,'318 стандартный'],[1977,1979,'AMC 2.0, 4 цил.']],
  H: [[1966,1966,'426 Hemi'],[1967,1969,'383, 4 карб.'],[1970,1973,'340, 4 карб.'],[1978,1980,'318, 4 карб.']],
  J: [[1966,1966,'440 V8'],[1967,1969,'426 Hemi'],[1970,1971,'340 V8 Six Pack (6V)'],[1974,1979,'360, 4 карб.']],
  K: [[1966,1966,'V8, спецзаказ'],[1967,1969,'440, 4 карб.'],[1971,1980,'360, 2 карб.']],
  L: [[1967,1969,'440 HP, 4 карб.'],[1970,1971,'383 V8 стандартный'],[1974,1980,'360 HP (с 1979–80 только полиция)']],
  M: [[1967,1967,'V8, спецзаказ'],[1969,1969,'440-6'],[1972,1976,'400 V8 стандартный']],
  N: [[1970,1971,'383 V8 HP'],[1974,1978,'400 V8, 4 карб.']],
  P: [[1968,1969,'340 V8, 4 карб. (HP)'],[1972,1973,'400, 4 карб.'],[1974,1978,'400 V8 HP']],
  R: [[1970,1971,'426 Hemi']],
  T: [[1970,1977,'440 V8 стандартный']],
  U: [[1970,1978,'440 V8 HP (включая полицейские)']],
  V: [[1970,1972,'440 V8 Six Pack (6V)']],
  Z: [[1970,1978,'V8 спецзаказ (Chrysler) или 401 V8 (AMC/Jeep)']],
};

function chEngine(code: string, years: number[]): [number, number, string][] {
  return (CH_ENGINE[code] || []).filter(([a, b]) => years.some(y => y >= a && y <= b));
}

// Значения tpocr.com по кандидатам года: марка определяется по букве модельного ряда (у Plymouth, Dodge, Chrysler буквы свои)
function mopTp(vin: string, years: number[]) {
  return years.map(y => {
    const make = Object.keys(TP_MOPAR).find(m => TP_MOPAR[m][y] && TP_MOPAR[m][y].l && TP_MOPAR[m][y].l![vin[0]]);
    return { y, make, t: make ? TP_MOPAR[make][y] : undefined };
  });
}
function chryslerRow(label: string, per: { y: number; v: string | null }[], fallback: string, fbNote: string | null): Row {
  const got = per.filter((e): e is { y: number; v: string } => !!e.v);
  if (!got.length) return [label, fallback, fbNote];
  const same = got.every(e => e.v === got[0].v) && got.length === per.length;
  const val = same ? got[0].v : per.map(e => `${e.y}: ${e.v || fallback}`).join('; ');
  return [label, val, got.length < per.length ? `${got.map(e => e.y).join(', ')} — по таблицам tpocr.com, остальное — MoTales` : 'по таблицам tpocr.com'];
}

function decodeChryslerLegacy(raw: string): LegacyDecode | null {
  const vin = raw.slice(0, 5) + raw[5].replace('O', '0') + raw.slice(6); // в 6-й позиции «О» = ноль
  if (!/^[A-Z]{2}\d{2}[A-Z]\d[A-Z]\d{6}$/.test(vin)) return null;
  const d = +vin[5];
  let years = (d === 0 ? [1970, 1980] : d <= 5 ? [1970 + d] : [1960 + d, 1970 + d]).filter(y => y >= 1966 && y <= 1980);
  // Если код двигателя существовал только в части кандидатов, год уточняется по нему
  const has = (y: number) => chEngine(vin[4], [y]).length > 0 || mopTp(vin, [y]).some(e => !!(e.t && e.t.e && e.t.e[vin[4]]));
  const fit = years.filter(has);
  const narrowed = fit.length > 0 && fit.length < years.length;
  if (narrowed) years = fit;
  const tp = mopTp(vin, years);
  const eng = chEngine(vin[4], years);
  const engPer = years.map((y, i) => {
    const e = tp[i].t && tp[i].t!.e && tp[i].t!.e![vin[4]];
    if (e) return { y, v: ruTpEngine(e) };
    const m = chEngine(vin[4], [y]);
    return { y, v: m.length ? m.map(x => x[2]).join(', ') : null };
  });
  const engTp = engPer.some((e, i) => e.v && tp[i].t && tp[i].t!.e && tp[i].t!.e![vin[4]]);
  const engRow: Row = engTp
    ? ['Двигатель', engPer.filter(e => e.v).map(e => (years.length > 1 ? e.y + ': ' : '') + e.v).join('; '),
        `cid — объём в кубических дюймах; по таблицам tpocr.com${engPer.some((e, i) => e.v && !(tp[i].t && tp[i].t!.e && tp[i].t!.e![vin[4]])) ? ' и MoTales' : ''}`]
    : ['Двигатель', eng.length ? eng.map(([a, b, t]) => `${a === b ? a : a + '–' + b}: ${t}`).join('; ') : `код ${vin[4]}`,
        eng.length ? 'коды двигателя повторно использовались, ориентируйтесь на год' : 'для этих лет такого кода в справочнике нет'];
  const line = tp.map(e => ({ y: e.y, v: e.t ? `${e.make}${e.t.l![vin[0]] === e.make ? '' : ' ' + e.t.l![vin[0]]}` : null }));
  return legacyResult(vin, 'Chrysler Corporation, 1966–1980 (13 символов)',
    [['wmi', 0, 1, 'модельный ряд'], ['wmi', 1, 2, 'класс'], ['vds', 2, 3, 'двери'], ['vds', 3, 4, 'кузов'], ['chk', 4, 5, 'двигатель'],
     ['year', 5, 6, 'год'], ['plant', 6, 7, 'завод'], ['serial', 7, 13, 'серийный номер']],
    [['Формат', 'Chrysler Corporation, 1966–1980 (13 символов)', NOTE_STD],
     chryslerRow('Модельный ряд', line, CH_LINE[vin[0]] || `код ${vin[0]}`, CH_LINE[vin[0]] ? 'буква условная, платформу она не определяет' : 'нет в справочнике'),
     chryslerRow('Класс', tp.map(e => ({ y: e.y, v: e.t && e.t.s && e.t.s[vin[1]] ? ruTp(e.t.s[vin[1]]) : null })), CH_PRICE[vin[1]] || vin[1], 'класс считается внутри своего семейства моделей'),
     ['Двери', vin[2] === '2' || vin[2] === '4' ? vin[2] : vin[2] + ' (нетипичный код)'],
     chryslerRow('Кузов', tp.map(e => ({ y: e.y, v: e.t && e.t.b && e.t.b[vin.slice(2, 4)] ? ruTp(e.t.b[vin.slice(2, 4)]) : null })), CH_BODY[+vin[3]] || vin[3], null),
     engRow,
     ['Модельный год', years.join(' или '), narrowed ? 'уточнено по коду двигателя'
       : years.length > 1 ? 'цифра года повторяется, десятилетие по номеру не определить' : null],
     plantRow('Завод', CH_PLANT, CH_PLANT_OK, CHRYSLER_PLANTS_WB, vin[6]),
     ['Серийный номер', vin.slice(7)]]);
}

// ---- Перевод сокращений из американских справочников ----
const RU_TOK: [RegExp, string][] = [[/\b(\d) Dr\b/g, '$1 дв.'], [/\bSed\b/g, 'седан'], [/\bHT\b/g, 'хардтоп'], [/\bS\/W\b/g, 'универсал'], [/\bCpe\b/g, 'купе'],
  [/\bConv\b/g, 'кабриолет'], [/\bHB\b/g, 'хэтчбек'], [/\bHatchback\b/g, 'хэтчбек'], [/\bexc\b/g, 'кроме'], [/\bDsl\b/g, 'дизель'], [/\bCanada\b/g, 'Канада']];
export function ruBody(s: string): string { return RU_TOK.reduce((x, [r, t]) => x.replace(r, t), s); }
// «8-350 (5.7) 4BC 145HP» -> «8 цил., 350 cid (5,7 л), карб. 4 камеры, 145 hp»
export function ruEngine(s: string): string {
  const m = /^(\d)-(\d+) \(([\d.]+)\) (\d)BC(?: (\d+)HP)?(.*)$/.exec(s) || null;
  const m2 = !m && /^(\d)-(\d+) \(([\d.]+)\) ([A-Z]+)(?: (\d+)HP)?(.*)$/.exec(s);
  const x = m || m2;
  if (!x) return ruBody(s);
  const fuel = m ? `карб. ${x[4]} ${x[4] === '1' ? 'камера' : x[4] === '2' ? 'камеры' : 'камеры'}` : `впрыск/система ${x[4]}`;
  return `${x[1]} цил., ${x[2]} cid (${x[3].replace('.', ',')} л), ${fuel}${x[5] ? ', ' + x[5] + ' hp' : ''}${ruBody(x[6] || '')}`;
}
export function ruTrans(s: string): string {
  return s.replace(/(\d) Spd Man/g, '$1-ст. механика').replace(/Auto/g, 'автомат').replace(/Col Shift/g, 'рычаг на колонке')
    .replace(/Flr Shift/g, 'рычаг на полу').replace(/w\/o ?OD/g, 'без овердрайва').replace(/w\/OD/g, 'с овердрайвом');
}

// Ford / Mercury / Lincoln 1965–1980, 11 символов: «0F02G100001». Таблицы кузова и двигателя: 1965–1975 по tpocr.com, 1974–1980 по Mitchell 1 (пакет).
export const FORD_PLANT: Dict = { A: 'Атланта', B: 'Оквилл, Канада', C: 'Ontario Truck, Канада', D: 'Даллас', E: 'Mahwah, Нью-Джерси', F: 'Дирборн',
  G: 'Чикаго', H: 'Лорейн, Огайо', J: 'Лос-Анджелес', K: 'Канзас-Сити', L: 'Лонг-Бич', M: 'Мексика (Куаутитлан)', N: 'Норфолк',
  P: 'Твин-Ситис (Сент-Пол)', R: 'Сан-Хосе', S: 'Pilot Plant', T: 'Метьюкен (Эдисон), Нью-Джерси', U: 'Луисвилл', W: 'Уэйн, Мичиган',
  X: 'Сент-Томас, Канада', Y: 'Уиксом, Мичиган', Z: 'Сент-Луис' };

// Таблицы tpocr.com: кузов «Mustang: 2 Dr HT Bench seat», двигатель «8-428 4BC, CJ Ram Air»
const TP_TOK: [RegExp, string][] = [[/\bFastback\b/g, 'фастбэк'], [/\bBench seat\b/g, 'передний диван'], [/\bBucket seat\b/g, 'раздельные передние сиденья'],
  [/\b(\d+(?:\+\d+| & \d+)?) Pass\./g, '$1 мест'], [/\bVinyl (?:roof|top)\b/g, 'виниловая крыша'], [/\bLow Comp\./g, 'низкая степень сжатия'],
  [/\bPolice\b/g, 'полицейский'], [/\bTaxi\b/g, 'такси'], [/\bExport\b/g, 'экспорт'], [/\bPremium fuel\b/g, 'бензин премиум'],
  [/\bDual Exh\./g, 'двойной выпуск'], [/\bSingle Exh\./g, 'одинарный выпуск'], [/\bCanada only\b/g, 'только для Канады'], [/\b([23])-Seat\b/g, '$1 ряда сидений'],
  [/\bRegular\b/g, 'обычный бензин'], [/\bHi-Perf\b/g, 'форсированный'], [/\bOH cam\b/g, 'верхний распредвал']];
const ruTp = (s: string) => TP_TOK.reduce((x, [r, t]) => x.replace(r, t), ruBody(s));
function ruTpEngine(s: string): string {
  return s.split(' | ').map(e0 => {
    const g = / \(([A-Z][a-z]+)\)$/.exec(e0), e = g ? e0.slice(0, g.index) : e0;
    const m = /^(\d)-(\d+)(?: (\d)(?:-(\d))?BC)?(?:, (.*))?$/.exec(e);
    if (!m) return ruTp(e);
    const extra = (m[5] || '').split(', ').filter(Boolean);
    const cc = extra.find(x => /^\d{4}cc$|^\d\.\dL$/.test(x));
    const litre = cc ? (cc.endsWith('cc') ? (+cc.slice(0, 4) / 1000).toFixed(1) : cc.slice(0, 3)) : (+m[2] * 0.016387).toFixed(1);
    const carb = m[3] ? (m[4] ? `, ${m[3]} карб. по ${m[4]} камеры` : `, карб. ${m[3]} ${m[3] === '1' ? 'камера' : 'камеры'}`) : '';
    const rest = extra.filter(x => x !== cc).map(ruTp);
    return `${m[1]} цил., ${m[2]} cid (${litre.replace('.', ',')} л)${carb}${rest.length ? ', ' + rest.join(', ') : ''}${g ? ` (серия ${g[1]})` : ''}`;
  }).join(' или ');
}

function decodeFordLegacy(vin: string): LegacyDecode | null {
  if (!/^[0-9A][A-Z]\d{2}[A-Z]\d{6}$/.test(vin)) return null;
  const c = vin[0];
  const cands = c === 'A' ? [1980] : c === '0' ? [1970, 1980] : +c <= 3 ? [1970 + +c] : +c === 4 ? [1974] : [1960 + +c, 1970 + +c];
  const UL = MP && MP.usLegacy;
  const code = vin.slice(2, 4), many = cands.length > 1;
  const ser: string[] = [], eng: string[] = [], srcS = new Set<string>(), srcE = new Set<string>(), open: number[] = [];
  let bothMakes = false, split = false, engSplit = false;
  for (const y of cands) {
    const pre = many ? y + ': ' : '';
    const mt = UL && UL.ford[y], tp = TP_FORD[y];
    if (mt) {
      const s = mt.s[code], e = mt.e[vin[4]];
      if (s) { ser.push(pre + ruBody(s)); srcS.add('Mitchell 1'); if (s.includes(' | ')) split = true; }
      if (e) { eng.push(pre + ruEngine(e)); srcE.add('Mitchell 1'); }
    } else if (tp) {
      const f = tp.f[code], m = tp.m[code], e = tp.e[vin[4]];
      if (f && m) bothMakes = true;
      const parts = [f && 'Ford — ' + ruTp(f), m && 'Mercury/Lincoln — ' + ruTp(m)].filter(Boolean);
      if (parts.length) { ser.push(pre + parts.join('; ')); srcS.add('tpocr.com'); }
      if (e) { eng.push(pre + ruTpEngine(e)); srcE.add('tpocr.com'); if (e.includes(' | ')) engSplit = true; }
    } else open.push(y);
  }
  const by = (src: Set<string>) => src.size ? `по таблицам ${[...src].join(' и ')}` : null;
  const gap = open.length ? `нет таблиц: ${open.join(', ')} (нужен справочник Mitchell 1)` : null;
  const join = (...xs: (string | null | false)[]) => xs.filter(Boolean).join('; ') || null;
  return legacyResult(vin, 'Ford Motor Company, 1965–1980 (11 символов)',
    [['year', 0, 1, 'год'], ['plant', 1, 2, 'завод'], ['vds', 2, 4, 'серия кузова'], ['chk', 4, 5, 'двигатель'], ['serial', 5, 11, 'серийный номер']],
    [['Формат', 'Ford / Mercury / Lincoln, 1965–1980 (11 символов)', NOTE_STD],
     ['Модельный год', cands.join(' или '), many ? 'год в номере один символ, десятилетие по номеру не определить: смотрите по модели' : null],
     plantRow('Завод', FORD_PLANT, FORD_PLANT_OK, FORD_PLANTS_WB, vin[1]),
     ['Серия кузова', ser.length ? ser.join('; ') : code,
       ser.length ? join(bothMakes && 'у Ford и у Mercury/Lincoln свои таблицы кодов: выбирайте по марке машины',
         split && 'один код серии встречается у разных моделей, по номеру однозначно не выбрать', by(srcS), gap)
         : join(open.length < cands.length && 'такого кода в таблицах нет', gap)],
     ['Двигатель', eng.length ? eng.join('; ') : `код ${vin[4]}`,
       eng.length ? join(srcE.has('tpocr.com') && 'cid — объём в кубических дюймах', srcE.has('Mitchell 1') && 'hp здесь по старой методике (SAE gross)', 'карб. = карбюратор', engSplit && 'таблицы Ford и Mercury для этого кода расходятся', by(srcE), gap)
         : join(open.length < cands.length && 'такого кода в таблицах нет', gap)],
     ['Серийный номер', vin.slice(5)]]);
}

// General Motors 1965–1980, 13 символов: «136370L100001» (до 1971) и «1Q87H2N100001» (1972–1980)
const GM_MAKE: Dict = { 1: 'Chevrolet', 2: 'Pontiac', 3: 'Oldsmobile', 4: 'Buick', 6: 'Cadillac' };
const GM_BODY: Dict = { 37: '2-дверное купе / хардтоп', 67: 'кабриолет', 87: '2-дверное купе (Camaro, Firebird)' };
const GM_PLANT: Dict = { A: 'Атланта', B: 'Балтимор', C: 'Саутгейт, Калифорния', D: 'Доравилл, Джорджия', E: 'Линден, Нью-Джерси', F: 'Флинт, Мичиган',
  G: 'Фремингем, Массачусетс', J: 'Джейнсвилл, Висконсин', K: 'Лидс (Канзас-Сити), Миссури', L: 'Ван-Найс (Лос-Анджелес)',
  N: 'Норвуд, Огайо', R: 'Арлингтон, Техас', S: 'Сент-Луис, Миссури', T: 'Тарритаун, Нью-Йорк', U: 'Лордстаун, Огайо',
  W: 'Уиллоу-Ран, Мичиган', X: 'Фэрфакс (Канзас-Сити), Канзас', Y: 'Уилмингтон, Делавэр', Z: 'Фремонт, Калифорния', 1: 'Ошава, Канада' };

function decodeGmLegacy(vin: string): LegacyDecode | null {
  const digital = /^[12346]\d{4}\d[A-Z0-9]\d{6}$/.test(vin);
  const lettered = /^[12346][A-Z]\d{2}[A-Z]\d[A-Z0-9]\d{6}$/.test(vin);
  if (!digital && !lettered) return null;
  const d = +vin[5];
  let year;
  if (digital) year = d >= 5 ? String(1960 + d) : d <= 1 ? String(1970 + d) : 'не определён (нетипичное сочетание)';
  else year = d >= 2 ? String(1970 + d) : d === 0 ? '1980' : 'не определён (нетипичное сочетание)';
  const body = digital ? vin.slice(3, 5) : vin.slice(2, 4);
  const make = GM_MAKE[vin[0]];
  const UL = MP && MP.usLegacy;
  const mt = lettered && UL && UL.gm[make] && UL.gm[make][year] || null;     // Mitchell 1, 1974–1980
  const tp = !mt && TP_GM[make] && TP_GM[make][year] || null;               // tpocr.com, 1965–1975
  const ru = (x: string) => mt ? ruBody(x) : ruTp(x);
  const src = mt ? 'по справочнику Mitchell 1' : 'по таблицам tpocr.com';
  let serKey = '', serName: string | undefined;
  if (mt) { serKey = vin[1]; serName = mt.s[serKey]; }
  else if (tp && tp.s) for (const k of digital ? [vin.slice(1, 5), vin.slice(1, 3), vin[1]] : [vin[1]]) if (tp.s[k]) { serKey = k; serName = tp.s[k]; break; }
  const joint = serKey.length === 4;                                        // серия и кузов одним кодом
  const bt = mt ? mt.b : tp && tp.b, bodyV = !joint && bt && bt[body];
  const bodyTxt = bodyV ? `${ru(bodyV)} (${body})` : GM_BODY[body] ? `${GM_BODY[body]} (${body})` : body;
  const rows: Row[] = [
    ['Формат', `General Motors, ${digital ? '1965–1971' : '1972–1980'} (13 символов)`, NOTE_STD],
    ['Марка', make],
    ['Серия', serName ? `${ru(serName)} (${serKey})` : digital ? vin.slice(1, 3) : vin[1],
      serName ? (joint ? `серия и кузов одним кодом (2–5-й символы), ${src}` : digital && serKey.length === 1 ? `по 2-му символу таблица даёт только модельный ряд, ${src}` : src) : 'код серии зависит от марки и года'],
    ['Кузов', joint ? `${body}: см. серию` : bodyTxt, joint ? null : bodyV ? src : GM_BODY[body] ? 'по общим кодам кузова GM, детали зависят от модели' : null],
  ];
  if (lettered) {
    const e = mt ? mt.e[vin[4]] : tp && tp.e && tp.e[vin[4]];
    rows.push(['Двигатель', e ? (mt ? ruEngine(e) : ruTpEngine(e)) : `код ${vin[4]}`,
      e ? (mt ? 'hp здесь по старой методике (SAE gross), карб. = карбюратор' : 'cid — объём в кубических дюймах; карб. = карбюратор; по таблицам tpocr.com')
        : (mt || (tp && tp.e) ? 'такого кода в таблицах нет' : !UL ? 'таблицы двигателей не подключены (справочник Mitchell 1)' : 'таблицы двигателей есть только для 1972–1980 годов')]);
  }
  rows.push(['Модельный год', year, digital ? 'у номеров этого вида годы 1965–1971' : 'у номеров этого вида годы 1972–1980']);
  rows.push(gmPlantRow('Завод', vin[6], /^\d{4}$/.test(year) ? [+year] : digital ? [1965, 1966, 1967, 1968, 1969, 1970, 1971] : [1972, 1973, 1974, 1975, 1976, 1977, 1978, 1979, 1980]));
  rows.push(['Серийный номер', vin.slice(7)]);
  const segments: Segment[] = digital
    ? (joint ? [['wmi', 0, 1, 'марка'], ['vds', 1, 5, 'серия и кузов'], ['year', 5, 6, 'год'], ['plant', 6, 7, 'завод'], ['serial', 7, 13, 'серийный номер']]
      : [['wmi', 0, 1, 'марка'], ['vds', 1, 3, 'серия'], ['chk', 3, 5, 'кузов'], ['year', 5, 6, 'год'], ['plant', 6, 7, 'завод'], ['serial', 7, 13, 'серийный номер']])
    : [['wmi', 0, 1, 'марка'], ['vds', 1, 2, 'серия'], ['chk', 2, 4, 'кузов'], ['vds', 4, 5, 'двигатель'], ['year', 5, 6, 'год'], ['plant', 6, 7, 'завод'], ['serial', 7, 13, 'серийный номер']];
  return legacyResult(vin, 'GM', segments, rows);
}

// American Motors 1966–1980, 13 символов. 1966–1967: «A7K S 5 7 A…» — завод, коробка, кузов, модель, двигатель;
// с 1968: «A9S055A…» — коробка, серия, кузов, модель/класс, двигатель. 1966–1975 по tpocr.com, 1974–1980 — пакет Mitchell 1.
const AMC_PLANT: Dict = { B: 'Брамптон, Онтарио, Канада', K: 'Кеноша, Висконсин' };
function decodeAmc(vin: string): LegacyDecode | null {
  const old = /^A[67][BK][A-Z]\d\d[A-Z]\d{6}$/.test(vin);
  if (!old && !/^A[0-9A][A-Z]\d\d[0-9PT][A-Z]\d{6}$/.test(vin)) return null;
  const c = vin[1];
  const cands = old ? [1960 + +c] : c === 'A' ? [1980] : c === '0' ? [1970, 1980] : +c <= 5 ? [1970 + +c] : +c <= 7 ? [1970 + +c] : [1960 + +c, 1970 + +c];
  const L = MP && MP.legacy;
  const late = L && !old ? L.amc(vin) : null;                     // Mitchell 1: один год 1974–1980
  const lateYear = late ? +late.rows.find(r => r[0] === 'Модельный год')![1] : 0;
  const tpYears = cands.filter(y => TP_AMC[y] && y !== lateYear);
  if (!tpYears.length) return late;
  const many = cands.length > 1, open = cands.filter(y => !tpYears.includes(y) && y !== lateYear);
  const gap = open.length ? `нет таблиц: ${open.join(', ')} (нужен справочник Mitchell 1)` : null;
  const fmt = `American Motors Corporation, ${old ? '1966–1967' : '1968–1980'} (13 символов)`;
  const fields: [label: string, pos: number, kind: 'p' | 't' | 's' | 'b' | 'm' | 'e', f: (x: string) => string][] = old
    ? [['Завод', 2, 'p', x => x], ['Коробка', 3, 't', x => x], ['Кузов', 4, 'b', ruTp], ['Модель', 5, 'm', ruTp], ['Двигатель', 6, 'e', ruTpEngine]]
    : [['Коробка', 2, 't', x => x], ['Серия', 3, 's', ruTp], ['Кузов', 4, 'b', ruTp], ['Модель', 5, 'm', ruTp], ['Двигатель', 6, 'e', ruTpEngine]];
  const rows: Row[] = [['Формат', fmt, NOTE_STD],
    ['Производитель', 'American Motors Corporation (A)'],
    ['Модельный год', cands.join(' или '), many ? 'год в номере один символ, десятилетие по номеру не определить: смотрите по модели' : null]];
  for (const [label, pos, kind, f] of fields) {
    const code = vin[pos], vals: string[] = [], srcs = new Set<string>();
    for (const y of tpYears) {
      const v = kind === 'p' ? AMC_PLANT[code] : TP_AMC[y][kind] && TP_AMC[y][kind]![code];
      if (v) { vals.push((many ? y + ': ' : '') + f(v)); srcs.add('tpocr.com'); }
    }
    const lr = late && late.rows.find(r => r[0] === label);
    if (lr && !/^код /.test(lr[1])) { vals.push((many ? lateYear + ': ' : '') + lr[1].replace(/ \([A-Z0-9]\)$/, '')); srcs.add('Mitchell 1'); }
    rows.push([label, vals.length ? `${vals.join('; ')} (${code})` : `код ${code}`,
      [vals.length ? kind === 'e' && (srcs.has('Mitchell 1') ? 'cid — объём в кубических дюймах; hp — по старой методике (SAE gross)' : 'cid — объём в кубических дюймах') : 'такого кода в таблицах нет', vals.length && `по таблицам ${[...srcs].join(' и ')}`, kind !== 'p' && gap].filter(Boolean).join('; ') || null]);
  }
  rows.push(['Серийный номер', vin.slice(7)]);
  const segments: Segment[] = old
    ? [['wmi', 0, 1, 'производитель'], ['year', 1, 2, 'год'], ['plant', 2, 3, 'завод'], ['vds', 3, 4, 'коробка'], ['chk', 4, 5, 'кузов'], ['vds', 5, 6, 'модель'], ['vds', 6, 7, 'двигатель'], ['serial', 7, 13, 'серийный номер']]
    : [['wmi', 0, 1, 'производитель'], ['year', 1, 2, 'год'], ['vds', 2, 3, 'коробка'], ['vds', 3, 4, 'серия'], ['chk', 4, 5, 'кузов'], ['vds', 5, 6, 'модель'], ['vds', 6, 7, 'двигатель'], ['serial', 7, 13, 'серийный номер']];
  return legacyResult(vin, fmt, segments, rows);
}

// BMW 02 (1600, 2002, 2002tii), номер шасси из 7 цифр. Диапазоны для рынка США 1967–1976 (таблица Dean Cain);
// начало выпуска 2002 не для США — 1650001 (Википедия, «BMW 02 Series»).
function decodeBmw02(vin: string): LegacyDecode | null {
  if (!/^\d{7}$/.test(vin)) return null;
  const n = +vin;
  const hit = BMW02_US.find(r => n >= r[0] && n <= r[1]);
  const euro = !hit && n >= 1650001 && n <= 1659999;
  if (!hit && !euro) return null;
  const mm = (s: string) => s.length > 4 ? `${s.slice(5)}.${s.slice(0, 4)}` : s;
  const rows: Row[] = [['Формат', 'BMW 02, номер шасси (7 цифр)', 'у BMW до 1981 года номер шасси — просто порядковый номер, блоки номеров выделялись под модели и рынки']];
  if (hit) {
    const [a, b, model, series, my, from, to] = hit;
    rows.push(['Модель', `BMW ${model.replace(' Auto', ' с автоматом')}`, 'по диапазону номеров'], ['Рынок', 'США'], ['Модельный год', String(my)],
      ['Выпуск', from === to ? mm(from) : `${mm(from)}–${mm(to)}`], ['Серия выпуска', series], ['Диапазон', `${a}–${b}`, 'таблица Dean Cain (2005); на отдельных машинах встречаются отклонения']);
  } else {
    rows.push(['Модель', 'BMW 2002', 'по диапазону номеров'], ['Рынок', 'кроме США'], ['Модельный год', '1968', 'выпуск 2002 не для США начался с номера 1650001 в январе 1968 года (Википедия)']);
  }
  rows.push(['Порядковый номер', vin]);
  return legacyResult(vin, 'BMW 02, номер шасси (7 цифр)', [['serial', 0, 7, 'номер шасси']], rows);
}

// Porsche 356 (1950–1965): номер шасси из 4–6 цифр. Диапазоны — каталоги запчастей Porsche Classic KAT071/KAT072.
const P356_BODY: [RegExp, string][] = [[/\bCoupe\b/g, 'купе'], [/\bCabrio\b/g, 'кабриолет'], [/\bHardtop\b/g, 'хардтоп']];
function decodePorsche356(vin: string): LegacyDecode | null {
  if (!/^\d{4,6}$/.test(vin)) return null;
  const n = +vin;
  const hits = P356.filter(r => n >= r[0] && n <= r[1]).sort((a, b) => (a[1] - a[0]) - (b[1] - b[0]));
  if (!hits.length) return null;
  const names: string[] = [];
  for (const h of hits) { const t = `Porsche ${h[2]} ${P356_BODY.reduce((x, [r, v]) => x.replace(r, v), h[3])}`; if (!names.includes(t)) names.push(t); }
  const years = [...new Set(hits.map(h => h[4]))].sort();
  const best = hits[0];
  return legacyResult(vin, 'Porsche 356, номер шасси (1950–1965)', [['serial', 0, vin.length, 'номер шасси']],
    [['Формат', 'Porsche 356, номер шасси (1950–1965)', 'номер шасси — порядковый, блоки номеров выделялись под кузова и годы'],
     ['Модель и кузов', names.join(' или '), names.length > 1 ? 'номер попадает в несколько диапазонов каталога' : 'по диапазону номеров'],
     ['Модельный год', years.join(' или '), years.length > 1 ? 'сводки номеров в каталоге Porsche расходятся в годах' : null],
     ['Диапазон', `${best[0]}–${best[1]}`, `каталог запчастей Porsche Classic ${best[5]}, страницы V-Pages`],
     ['Порядковый номер', vin]]);
}

// Cadillac 1965–1970, 8 символов: «J8123456» — буква модели, цифра года, серийный номер (таблицы tpocr.com)
function decodeCadillac6570(vin: string): LegacyDecode | null {
  const m = /^([A-Z])([5-90])(\d{6})$/.exec(vin);
  if (!m) return null;
  const year = m[2] === '0' ? 1970 : 1960 + +m[2];
  const model = TP_GM.Cadillac[year] && TP_GM.Cadillac[year].c && TP_GM.Cadillac[year].c![m[1]];
  if (!model) return null;
  return legacyResult(vin, 'Cadillac, 1965–1970 (8 символов)', [['vds', 0, 1, 'модель'], ['year', 1, 2, 'год'], ['serial', 2, 8, 'серийный номер']],
    [['Формат', 'Cadillac, 1965–1970 (8 символов)', NOTE_STD], ['Марка', 'Cadillac'], ['Модель и кузов', `${ruTp(model)} (${m[1]})`, 'по таблицам tpocr.com'],
     ['Модельный год', String(year)], ['Серийный номер', m[3]]]);
}



// ---- Audi и VW: модельная линия по 7–8-му символам. Сначала справочник Mitchell 1 (если подключён), затем Wikibooks ----
const AUDI_17 = /^(WAU|WA1|WUA|TRU)$/;
function audiDetails(vin: string): Row[] | null {
  if (!AUDI_17.test(vin.slice(0, 3))) return null;
  const m = MP && MP.details.audi(vin);
  if (m) return m;
  const wb = VWAUDI_WB.audi[vin.slice(6, 8)];
  return wb ? [['Код типа (7–8-й символы)', vin.slice(6, 8), null], ['Модельная линия по Wikibooks', wb, 'американский рынок, годы указаны в тексте']] : null;
}
const VW_17 = /^(WVW|WV1|WV2|WV3|WVG|1VW|3VW|9BW|AAV)$/;
function vwDetails(vin: string): Row[] | null {
  if (!VW_17.test(vin.slice(0, 3))) return null;
  const m = MP && MP.details.vwYear(vin);
  if (m) return m;
  const typ = vin.slice(6, 8), wb = VWAUDI_WB.vw[typ];
  if (wb) return [['Код типа (7–8-й символы)', typ, null], ['Модельная линия по Wikibooks', wb, 'американский рынок, годы указаны в тексте']];
  return MP && MP.details.vwType(vin);
}

// ---- Volvo: VIN 1981+ (YV1, YV2, YV4…), таблицы Wikibooks (американский рынок) ----
function volvoDetails(vin: string): Row[] | null {
  if (!/^YV[1-4]$/.test(vin.slice(0, 3))) return null;
  const my = modelYear(vin), y = my ? my.value : null;
  const pickModels = (map: Dict<YearSpanEntry[]>, ch: string, year: number | null) => {
    const e = (map[ch] || []).filter(([, a, b]) => !year || year >= a && year <= b);
    return e.length ? [...new Set(e.map(x => x[0]))].join(' / ') : null;
  };
  const late = y && y >= 2010;
  const model = late ? pickModels(VOLVO_WB.m2, vin[6], y) : pickModels(VOLVO_WB.m1, vin[3], y);
  const engine = late ? VOLVO_WB.e2[vin.slice(3, 5)] : VOLVO_WB.e1[vin.slice(5, 7)];
  if (!model && !engine) return null;
  const rows: Row[] = [];
  rows.push([late ? 'Модель (7-й символ, с 2010)' : 'Модель (4-й символ)', model || `код ${late ? vin[6] : vin[3]}`,
    model ? 'по таблицам Wikibooks, выбор по году выпуска' : 'такого кода для этого года в таблице нет']);
  rows.push([late ? 'Двигатель (4–5-й символы)' : 'Двигатель (6–7-й символы)', engine || `код ${late ? vin.slice(3, 5) : vin.slice(5, 7)}`,
    engine ? 'по таблицам Wikibooks для американского рынка; для европейских машин коды могут отличаться' : 'такого кода в таблице нет']);
  return rows;
}

// ---- Kia: линия модели и двигатель по таблицам Wikibooks (американский рынок) ----
const KIA_WMI = new Set(KIA_WB.wmi.filter(w => w !== 'TMA' && w !== 'Z94'));
function kiaDetails(vin: string): Row[] | null {
  if (!KIA_WMI.has(vin.slice(0, 3))) return null;
  const my = modelYear(vin), y = my ? my.value : null;
  const pick = (list: YearSpanEntry[] | undefined, year: number | null) => {
    const e = (list || []).filter(([, a, b]) => !year || year >= a && year <= b);
    return e.length ? [...new Set(e.map(x => x[0]))].join(' / ') : null;
  };
  const late = y && y >= 2010;
  const line = late ? pick(KIA_WB.l2[vin[3]], y) : pick(KIA_WB.l1[vin.slice(3, 5)], y);
  // двигатель: сначала записи, где упомянута найденная модель, иначе все записи этого кода за год
  const names = line ? line.split(' / ').map(n => n.replace(/\s*\(.*$/, '').replace(/\s*\[.*$/, '').trim().split(' ')[0]).filter(n => n.length >= 2) : [];
  const all = ((late ? KIA_WB.e2 : KIA_WB.e1)[vin[7]] || []).filter(([, a, b]) => !y || y >= a && y <= b);
  const byModel = names.length ? all.filter(([t]) => names.some(n => t.includes(n))) : [];
  const engList = byModel.length ? byModel : all;
  const eng = engList.length ? [...new Set(engList.map(x => x[0]))].join(' / ') : null;
  if (!line && !eng) return null;
  return [[late ? 'Линия модели (4-й символ)' : 'Линия модели (4–5-й символы)', line || `код ${late ? vin[3] : vin.slice(3, 5)}`, line ? 'по таблицам Wikibooks, выбор по году; американский рынок' : 'такого кода для этого года нет'],
    ['Двигатель (8-й символ)', eng || `код ${vin[7]}`, eng ? 'по таблицам Wikibooks; для европейских Kia коды могут отличаться' : 'такого кода для этого года нет']];
}

// ---- Mercedes-Benz, американский рынок 2002+: серия и кузов (4–5-й символы) + модель (6–7-й), таблицы Wikibooks ----
function mercedesWbDetails(vin: string): Row[] | null {
  if (!/^(WD[A-Z0-9]|W1[A-Z0-9]|4JG|55S|WMX)$/.test(vin.slice(0, 3))) return null;
  const hit = MB_WB[vin.slice(3, 5)] && MB_WB[vin.slice(3, 5)][vin.slice(5, 7)];
  if (!hit) return null;
  return [['Серия и кузов (4–5-й символы)', vin.slice(3, 5), null],
    ['Модель и двигатель (6–7-й символы)', hit, 'по таблицам Wikibooks для американского рынка; в скобках шасси (например, W212), годы и двигатель']];
}

// ---- Jaguar 2000–2015 и Land Rover 1987–2016 (американский рынок), таблицы Wikibooks ----
// годы из текста вида «('05-'09)», «('93-'95, '97)», «('10-)»
function wbYears(txt: string): [number, number][] {
  const out: [number, number][] = [];
  for (const m of txt.matchAll(/'(\d\d)(?:\s*-\s*(?:'(\d\d))?)?/g)) {
    const f = (n: string) => (+n >= 70 ? 1900 + +n : 2000 + +n);
    const a = f(m[1]);
    out.push([a, m[2] ? f(m[2]) : /-/.test(m[0]) ? 9999 : a]);
  }
  return out;
}
const inYears = (txt: string, y: number | null): boolean => { const r = wbYears(txt); return !y || !r.length || r.some(([a, b]) => y >= a && y <= b); };
function jlrEngine(list: string[] | undefined, y: number | null, names: string[]): string | null {
  const byYear = (list || []).filter(t => inYears(t, y));
  const byModel = names.length ? byYear.filter(t => names.some(n => t.includes(n))) : [];
  const e = byModel.length ? byModel : byYear;
  return e.length ? [...new Set(e)].join(' | ') : null;
}
function jaguarWbDetails(vin: string): Row[] | null {
  if (!/^SA[JD]$/.test(vin.slice(0, 3))) return null;
  const my = modelYear(vin), y = my ? my.value : null;
  if (!y || y < 2000 || y > 2015) return null;
  const models = (JLR_WB.jaguar.m[vin.slice(5, 7)] || []).filter(t => inYears(t, y));
  if (!models.length) return null;
  const names = models.map(t => t.replace(/^Jaguar /, '').split(' ')[0]);
  const eng = jlrEngine(JLR_WB.jaguar.e[vin[7]], y, names);
  return [['Модель (6–7-й символы)', models.join(' / '), 'по таблицам Wikibooks, выбор по году; американский рынок'],
    ['Двигатель (8-й символ)', eng || `код ${vin[7]}`, eng ? 'по таблицам Wikibooks, выбор по модели и году' : 'такого кода для этой модели и года нет']];
}
function landRoverDetails(vin: string): Row[] | null {
  if (vin.slice(0, 3) !== 'SAL') return null;
  const my = modelYear(vin), y = my ? my.value : null;
  const models = (JLR_WB.landrover.m[vin[3]] || []).filter(t => inYears(t, y));
  if (!models.length) return null;
  const names = models.map(t => t.replace(/^Land Rover /, '').split(' ')[0]);
  const eng = jlrEngine(JLR_WB.landrover.e[vin[7]], y, names);
  return [['Модель (4-й символ)', models.join(' / '), 'по таблицам Wikibooks, выбор по году; американский рынок'],
    ['Двигатель (8-й символ)', eng || `код ${vin[7]}`, eng ? 'по таблицам Wikibooks, выбор по модели и году' : 'такого кода для этой модели и года нет']];
}

// Mercedes-Benz 1959–1983 (14 цифр): «123 183 22 123456». Источник: MB Spares.
const MB_SERIES: Dict = { 105: 'W105 (219)', 107: 'SL (R107/C107, двухместный)', 110: 'W110', 111: 'W111 (седан, купе, кабриолет)', 114: 'W114',
  116: 'S-класс W116 (1972–1980)', 123: 'W123 (1976–1985)', 124: 'W124 (1985–1995)', 126: 'S-класс W126 (1979–1991)',
  180: 'W180 (220S)', 201: 'W201 (1982–1993)' };
const MB_W111: Dict = { '010': '220b / 230S (седан)', '012': '220Sb (седан)', '014': '220SEb (седан)', '021': '220SE / 250SE (купе)',
  '023': '220SE / 250SE (кабриолет)', '024': '280SE (купе)', '025': '280SE (кабриолет)', '026': '280SE 3.5 (купе)', '027': '280SE 3.5 (кабриолет)' };
const MB_WHERE: Dict = { 1: 'левый руль, сборка в Германии', 2: 'правый руль, сборка в Германии',
  5: 'левый руль, сборка вне Германии', 6: 'правый руль, сборка вне Германии' };
const MB_PLANT: Dict = { A: 'Зиндельфинген (легковые)', B: 'Зиндельфинген (легковые)', C: 'Зиндельфинген (легковые)', D: 'Зиндельфинген (легковые)',
  E: 'Зиндельфинген (легковые)', F: 'Бремен (легковые)', G: 'Бремен (легковые)', H: 'Бремен (легковые)', T: 'Бремен (легковые)',
  I: 'Вёрт (автобусы/грузовики)', K: 'Вёрт (автобусы/грузовики)', L: 'Вёрт (автобусы/грузовики)', M: 'Вёрт (автобусы/грузовики)',
  N: 'Вёрт (автобусы/грузовики)', P: 'Дюссельдорф (лёгкие коммерческие)', R: 'Дюссельдорф (лёгкие коммерческие)',
  S: 'Дюссельдорф (лёгкие коммерческие)', U: 'Мангейм (автобусы)', V: 'Гаггенау (Unimog)', W: 'Гаггенау (Unimog)' };

function decodeMercedesLegacy(vin: string): LegacyDecode | null {
  if (!/^\d{7}[0-9A-Z]\d{6}$/.test(vin) || (/[A-Z]/.test(vin.slice(0, 7)))) return null;
  const series = +vin.slice(0, 3), ver = vin.slice(3, 6), letter = /[A-Z]/.test(vin[7]);
  const rows: Row[] = [['Формат', 'Mercedes-Benz, 1959–1990-е (14 знаков)', 'структура: 3 цифры кузов, 3 версия, 2 рынок/КПП или завод, 6 серийный номер'],
    ['Модельный ряд', MB_SERIES[series] || `код ${series}`, MB_SERIES[series] ? 'по справочнику, список неполный' : 'нет в справочнике']];
  const verName = series === 111 ? MB_W111[ver] : null;
  rows.push(['Версия', verName || ver, verName ? 'у некоторых версий W111 номер одинаковый (например, 220b и 230S): уточняйте по номеру двигателя' : 'расшифровка версии зависит от модельного ряда']);
  const mt = MP && MP.mbType(vin.slice(0, 6));
  if (mt) rows.push(['По справочнику Mitchell 1', mt, 'справочник для американского рынка 1973–2004']);
  const eng = MP && MP.mbEngine(vin.slice(0, 6));
  if (eng) rows.push(['Если это номер двигателя', eng, `первые 6 цифр — тип двигателя ${vin.slice(0, 3)}.${vin.slice(3, 6)}; справочник Mitchell 1, американский рынок 2004–2009`]);
  if (series === 123 && MP) rows.push(['Тип топлива', vin[3] === '1' ? 'дизель' : vin[3] === '0' ? 'бензин' : `код ${vin[3]}`, 'по справочнику Mitchell 1: у всех шести типов W123 американского рынка 4-я цифра 1 — дизель, 0 — бензин']);
  if (letter) {
    rows.push(['Завод (8-я позиция)', MB_PLANT[vin[7]] ? `${MB_PLANT[vin[7]]} (${vin[7]})` : vin[7], 'буква вместо цифры появилась после августа 1983 года']);
  } else {
    const w = MB_WHERE[+vin[6]];
    rows.push(['Рынок и руль', w || `код ${vin[6]}`, 'таблица кодов верна для середины 1959 – середины 1983 года']);
    rows.push(['Коробка', vin[7] === '0' ? 'механика' : vin[7] === '2' ? 'автомат' : `код ${vin[7]}`]);
  }
  rows.push(['Серийный номер', vin.slice(8)]);
  return legacyResult(vin, 'Mercedes-Benz',
    [['wmi', 0, 3, 'модельный ряд'], ['vds', 3, 6, 'версия'], ['chk', 6, 8, letter ? 'рынок и завод' : 'рынок, руль, коробка'], ['serial', 8, 14, 'серийный номер']], rows);
}

// Porsche до 1981 года. Источник: 911UK (классические форматы).
const PO_MODEL: Dict = { 911: '911', 914: '914/6', 924: '924', 928: '928', 930: '911 Turbo', 931: '924 Turbo' };
const PO_V68: Dict = { 0: '911 S/L купе или 912 купе (Karmann)', 1: '911 L купе', 2: '911 T купе или 912 купе', 3: '911 S купе', 9: '911 R' };
const PO_V69: Dict = { 0: '912', 1: '911 T', 2: '911 E', 3: '911 S' };

function decodePorsche(vin: string): LegacyDecode | null {
  vin = vin.replace(/^(9\dA)O/, '$10'); // в справочнике ноль в 4-й позиции 1980 года напечатан буквой O
  const ref = MP && MP.porscheRef(vin.slice(0, 6));
  const REF: Row[] = ref ? [['По справочнику Mitchell 1', ref, 'ключ: первые 6 символов номера']] : [];
  const NOTE = 'до 1981 года номера Porsche менялись несколько раз; значения вариантов зависят от модели и года';
  let m;
  if ((m = /^(11|12)8(\d)(\d{4})$/.exec(vin))) {
    const v = +m[2];
    return legacyResult(vin, 'Porsche, 1968 (8 знаков)',
      [['wmi', 0, 2, 'модель'], ['year', 2, 3, 'год'], ['vds', 3, 4, 'вариант'], ['serial', 4, 8, 'серийный номер']],
      [['Формат', 'Porsche, 1968 (8 знаков)', NOTE], ['Модель', m[1] === '11' ? '911' : '912'], ['Модельный год', '1968'],
       ['Вариант', PO_V68[v] || (v >= 5 && v <= 8 ? 'Targa (вариант по таблице Porsche)' : `код ${v}`)], ['Серийный номер', m[3]]]);
  }
  if ((m = /^(11|12)9(\d)(\d)(\d{4})$/.exec(vin))) {
    return legacyResult(vin, 'Porsche, 1969 (9 знаков)',
      [['wmi', 0, 2, 'модель'], ['year', 2, 3, 'год'], ['vds', 3, 4, 'вариант'], ['chk', 4, 5, 'кузов'], ['serial', 5, 9, 'серийный номер']],
      [['Формат', 'Porsche, 1969 (9 знаков)', NOTE], ['Модель', m[1] === '11' ? '911' : '912'], ['Модельный год', '1969'],
       ['Вариант', PO_V69[+m[2]] || `код ${m[2]}`], ['Кузов', `код ${m[3]}`, 'купе или Targa, в зависимости от серийной последовательности'], ['Серийный номер', m[4]]]);
  }
  if ((m = /^(911|914|924|928|930|931)(\d)(\d)(\d)(\d{4})$/.exec(vin))) {
    return legacyResult(vin, 'Porsche, 1970–1979 (10 знаков)',
      [['wmi', 0, 3, 'модель'], ['year', 3, 4, 'год'], ['vds', 4, 5, 'вариант'], ['chk', 5, 6, 'кузов'], ['serial', 6, 10, 'серийный номер']],
      [['Формат', 'Porsche, 1970–1979 (10 знаков)', NOTE], ['Модель', PO_MODEL[m[1]]], ['Модельный год', String(1970 + +m[2])],
       ['Вариант', `код ${m[3]}`, 'значение зависит от модели и года (912 E, 911 T/E/S, Carrera, Turbo, 924, 928)'],
       ['Кузов', `код ${m[4]}`, 'например, 0 = купе, 1 = Targa'], ...REF, ['Серийный номер', m[5]]]);
  }
  if ((m = /^9(\d)A0(\d)(\d)(\d{4})$/.exec(vin))) {
    const code = '9' + m[1] + m[2];
    return legacyResult(vin, 'Porsche, 1980 (переходный, 10 знаков)',
      [['wmi', 0, 2, 'модель'], ['year', 2, 3, 'год'], ['vds', 3, 4, 'заполнитель'], ['wmi', 4, 5, 'модель'], ['chk', 5, 6, 'вариант'], ['serial', 6, 10, 'серийный номер']],
      [['Формат', 'Porsche, 1980 (переходный)', 'модель читается по 1-му, 2-му и 5-му символам вместе'], ['Модель', PO_MODEL[code] || `код ${code}`],
       ['Модельный год', '1980'], ['Вариант', `код ${m[3]}`, 'зависит от модели (911 SC, Turbo, 924, 928)'], ...REF, ['Серийный номер', m[4]]]);
  }
  if ((m = /^47(\d)(\d{2})(\d{5})$/.exec(vin))) {
    return legacyResult(vin, 'Porsche 914 (4-цилиндровый), 1970–1976 (10 знаков)',
      [['wmi', 0, 2, 'модель'], ['year', 2, 3, 'год'], ['vds', 3, 5, 'вариант'], ['serial', 5, 10, 'серийный номер']],
      [['Формат', 'Porsche 914/4, 10 знаков', NOTE], ['Модель', '914 (4 цил.)'], ['Модельный год', String(1970 + +m[1])],
       ['Вариант', `код ${m[2]}`, 'зависит от года и двигателя'], ...(REF.length ? REF : []), ['Серийный номер', m[3]]]);
  }
  return null;
}

type LegacyFn = (vin: string) => LegacyDecode | null;
const first = (vin: string, fns: (LegacyFn | false | null | undefined)[]): LegacyDecode | null => {
  for (const f of fns) { const r = f && f(vin); if (r) return r; }
  return null;
};
function decodeLegacy(vin: string): LegacyDecode | null {
  const n = vin.length, L = MP && MP.legacy;
  if (n === 8) return first(vin, [decodePorsche, L && L.porscheEngine, L && L.vwEngine, decodeCadillac6570]);
  if (n === 9 || n === 10) return first(vin, [decodePorsche, L && L.vw, n === 9 && L && L.porscheEngine, L && L.vwEngine]);
  if (n === 11) return first(vin, [decodeFordLegacy, L && L.fordTruck, L && L.mazda]);
  if (n === 13) return first(vin, [decodeGmLegacy, decodeAmc, L && L.colt, L && L.jeep, L && L.gmTruck, L && L.moparTruck, decodeChryslerLegacy]);
  if (n === 14) return decodeMercedesLegacy(vin);
  if (n >= 4 && n <= 6) {
    // голый номер неоднозначен: если подходит и таблица Volvo (пакет Mitchell 1), основной остаётся Volvo, Porsche 356 — вариантом
    const p = decodePorsche356(vin), v = n >= 5 && L ? L.volvo(vin) : null;
    if (p && v) {
      const m = p.rows.find(r => r[0] === 'Модель и кузов')!, y = p.rows.find(r => r[0] === 'Модельный год')!;
      v.rows.push(['Другой вариант', `${m[1]}, ${y[1]}`, 'номер шасси Porsche 356 по каталогу Porsche Classic']);
      return v;
    }
    if (p) return p;
  }
  if (n >= 5 && n <= 7) return first(vin, [L && L.volvo, n === 7 && L && L.jaguar, n === 7 && L && L.porscheEngine, n === 7 && L && L.vwEngine, n === 7 && decodeBmw02]);
  if (n === 16) return first(vin, [L && L.jaguar]);
  return null;
}

// ---- Номера кузова JDM (внутренний рынок Японии): «ZZT231-0012345», «DBA-ZVW30-1234567» ----
// Справочник составлен по памяти, возможны неточности. Ключ: код модели. Используется, только если кода нет в таблице
// из японской Википедии (src/data/jdm-wiki.ts). Сверка 12.11.2026: KZN185 исправлен (Hilux Surf, а не Land Cruiser Prado);
// после этого 81 из 97 кодов совпадают с Википедией, 9 — та же машина под другим названием (March/Micra, Roadster/MX-5), 7 в Википедии нет.
const JDM: Dict<[brand: string, model: string, years: string]> = {
  AE86:['Toyota','Corolla Levin / Sprinter Trueno','1983–1987'], AE101:['Toyota','Corolla Levin / Sprinter Trueno','1991–1995'],
  AE111:['Toyota','Corolla Levin / Sprinter Trueno','1995–2000'], JZA80:['Toyota','Supra','1993–2002'],
  JZX90:['Toyota','Chaser / Mark II / Cresta','1992–1996'], JZX100:['Toyota','Chaser / Mark II / Cresta','1996–2001'],
  ST205:['Toyota','Celica GT-Four','1994–1999'], SW20:['Toyota','MR2','1989–1999'], ZZT231:['Toyota','Celica','1999–2006'],
  SXE10:['Toyota','Altezza','1998–2005'], GRS180:['Toyota','Crown','2003–2008'], GRS200:['Toyota','Crown','2008–2012'],
  GRX120:['Toyota','Mark X','2004–2009'], GRX130:['Toyota','Mark X','2009–2019'],
  NHW10:['Toyota','Prius','1997–2003'], NHW20:['Toyota','Prius','2003–2009'], ZVW30:['Toyota','Prius','2009–2015'], ZVW50:['Toyota','Prius','2015–2023'],
  ACV30:['Toyota','Camry','2001–2006'], ANH10:['Toyota','Alphard','2002–2008'], GGH20:['Toyota','Alphard','2008–2015'],
  AZR60:['Toyota','Noah / Voxy','2001–2007'], ZRR70:['Toyota','Noah / Voxy','2007–2014'],
  NCP10:['Toyota','Vitz','1999–2005'], NCP91:['Toyota','Vitz','2005–2010'], KSP90:['Toyota','Vitz','2005–2010'],
  KZN185:['Toyota','Hilux Surf','1995–2002'], GRJ150:['Toyota','Land Cruiser Prado (150)','2009–'],
  UZJ100:['Toyota','Land Cruiser (100)','1998–2007'], HDJ80:['Toyota','Land Cruiser (80)','1990–1997'],
  ZN6:['Toyota','86','2012–2021'], ZN8:['Toyota','GR86','2021–'],
  S15:['Nissan','Silvia','1999–2002'], BNR32:['Nissan','Skyline GT-R','1989–1994'], BCNR33:['Nissan','Skyline GT-R','1995–1998'],
  BNR34:['Nissan','Skyline GT-R','1999–2002'], R35:['Nissan','GT-R','2007–'], ER34:['Nissan','Skyline','1998–2001'],
  CPV35:['Nissan','Skyline Coupe','2001–2007'], Z33:['Nissan','Fairlady Z (350Z)','2002–2008'], Z34:['Nissan','Fairlady Z (370Z)','2008–2020'],
  E50:['Nissan','Elgrand','1997–2002'], E51:['Nissan','Elgrand','2002–2010'], K11:['Nissan','March','1992–2002'],
  K12:['Nissan','March','2002–2010'], K13:['Nissan','March','2010–'], T30:['Nissan','X-Trail','2000–2007'], T31:['Nissan','X-Trail','2007–2013'],
  Y33:['Nissan','Cedric / Gloria','1995–1999'], WGC34:['Nissan','Stagea','1996–2001'],
  Z10:['Nissan','Cube','1998–2002'], Z11:['Nissan','Cube','2002–2008'], Z12:['Nissan','Cube','2008–2019'],
  ZE0:['Nissan','Leaf','2010–2017'], ZE1:['Nissan','Leaf','2017–'],
  EK9:['Honda','Civic Type R','1997–2000'], EG6:['Honda','Civic SiR','1991–1995'], DC2:['Honda','Integra Type R','1995–2001'],
  DC5:['Honda','Integra Type R','2001–2006'], FD2:['Honda','Civic Type R','2007–2010'], FN2:['Honda','Civic Type R (Euro)','2009–2012'],
  EP3:['Honda','Civic Type R','2001–2005'], AP1:['Honda','S2000','1999–2005'], AP2:['Honda','S2000','2004–2009'], NA1:['Honda','NSX','1990–2005'],
  GD1:['Honda','Fit','2001–2007'], GE6:['Honda','Fit','2007–2013'], GK5:['Honda','Fit','2013–2020'], RB1:['Honda','Odyssey','2003–2008'],
  FD3S:['Mazda','RX-7','1991–2002'], FC3S:['Mazda','RX-7','1985–1991'], NA6CE:['Mazda','Roadster (MX-5)','1989–1997'],
  NB8C:['Mazda','Roadster (MX-5)','1998–2005'], NCEC:['Mazda','Roadster (MX-5)','2005–2015'], SE3P:['Mazda','RX-8','2003–2012'], DY3W:['Mazda','Demio','2002–2007'],
  CP9A:['Mitsubishi','Lancer Evolution IV–VI','1996–2001'], CT9A:['Mitsubishi','Lancer Evolution VII–IX','2001–2007'], CZ4A:['Mitsubishi','Lancer Evolution X','2007–2016'],
  GC8:['Subaru','Impreza','1992–2000'], GDA:['Subaru','Impreza WRX','2000–2007'], GDB:['Subaru','Impreza WRX STI','2000–2007'],
  BH5:['Subaru','Legacy Wagon','1998–2003'], BP5:['Subaru','Legacy Wagon','2003–2009'], BL5:['Subaru','Legacy B4','2003–2009'],
  VAB:['Subaru','WRX STI','2014–'], VAG:['Subaru','WRX S4','2014–'], ZC6:['Subaru','BRZ','2012–2020'], ZD8:['Subaru','BRZ','2021–'],
  HA36S:['Suzuki','Alto','2014–2021'], MH55S:['Suzuki','Wagon R','2017–'], ZC31S:['Suzuki','Swift Sport','2005–2011'],
  ZC32S:['Suzuki','Swift Sport','2011–2016'], ZC33S:['Suzuki','Swift Sport','2017–'],
  JB23W:['Suzuki','Jimny','1998–2018'], JB64W:['Suzuki','Jimny','2018–'], JB74W:['Suzuki','Jimny Sierra','2018–'],
};


// Структура кодов модели Toyota/Lexus: буквы кода собираются из кода двигателя и кода платформы (формула из Wikipedia).
// Средняя буква трёхбуквенного кода: [тип силовой установки, 2-я буква двигателя, 1-я буква платформы]
const TY_MID: Dict<[fuel: string, engine2: string, platform1: string]> = { U: ['дизель', 'D', 'A'], L: ['дизель', 'D', 'X'], G: ['бензин', 'R', 'A'], S: ['бензин', 'R', 'X'],
  N: ['бензин', 'Z', 'A'], C: ['бензин', 'Z', 'X'], W: ['гибрид', 'R', ''], Y: ['гибрид', 'R', 'A'], V: ['гибрид', 'R', 'X'],
  K: ['гибрид', 'Z', ''], T: ['гибрид', 'Z', 'A'], H: ['гибрид', 'Z', 'X'] };
const TY_VAR: Dict = { A: 'бензин/дизель', B: 'бензин', H: 'гибрид', J: 'гибрид', K: 'гибрид', M: 'электро' };

function toyotaStructure(code: string): string | null {
  let m = /^([A-Z])([A-Z])([A-Z])\d{1,3}$/.exec(code);
  if (m && TY_MID[m[2]]) {
    const [fuel, e2, p1] = TY_MID[m[2]];
    return `${fuel}; двигатель семейства ${m[1]}${e2}; платформа ${p1}${m[3]}`;
  }
  m = /^([A-Z])([A-Z]{2})([A-Z])\d{1,3}$/.exec(code);
  if (m && TY_VAR[m[3]]) return `новая схема: двигатель на «${m[1]}»; платформа ${m[2]}; ${TY_VAR[m[3]]}`;
  return null;
}

// Поиск кода в таблице из японской Википедии. «#» в коде — любая цифра («NCP6#» = NCP60, NCP61, NCP65);
// буквенный хвост кода в Википедии часто указывает кузов («UZJ100W», «ANH1#W»), а в номере кузова его нет — сравниваем и без него.
type JdmWikiEntry = (typeof JDM_WIKI)[string][number];
let JDM_KEYS: [re: RegExp, stripped: RegExp | null, entries: JdmWikiEntry[], series: boolean][] | null = null;
const stripTail = (k: string) => { const t = k.replace(/[A-Z]+$/, ''); return /[\d#]/.test(t) && t !== k ? t : null; };
// «*» в начале — серия Toyota: «*X10#» (из «X100系») = JZX100, GX100… — перед буквой серии 1–3 буквы
const keyRe = (k: string) => new RegExp('^' + k.replace(/^\*/, '[A-Z]{1,3}').replace(/#/g, '\\d') + '$');
function jdmWikiLookup(code: string): JdmWikiEntry[] | null {
  if (!code) return null;
  if (!JDM_KEYS) JDM_KEYS = Object.entries(JDM_WIKI).map(([k, v]) => { const t = stripTail(k); return [keyRe(k), t ? keyRe(t) : null, v, k.startsWith('*')]; });
  const exact = JDM_WIKI[code] || [];
  // точные коды раньше серий
  const tail = stripTail(code);
  const hit = ([re, st]: [RegExp, RegExp | null]) => re.test(code) || (st && st.test(code)) || (tail && (re.test(tail) || (st && st.test(tail))));
  const more = JDM_KEYS.filter(([re, st, , series]) => !series && hit([re, st])).flatMap(([, , v]) => v);
  // серии Toyota («*X10#» из «X100系») — только если прямых совпадений нет: под шаблон серии подходят и чужие коды (BNR34 ~ «*R3#»).
  // И только для кодов «буквы + цифры» без буквенного хвоста: у Suzuki, Mazda, Mitsubishi код кончается буквой (HA36S, NA6CE, CT9A)
  if (!exact.length && !more.length && /^[A-Z]{2,4}\d{2,3}$/.test(code))
    more.push(...JDM_KEYS.filter(([re, st, , series]) => series && hit([re, st])).flatMap(([, , v]) => v));
  const all = [...exact, ...more.filter(e => !exact.includes(e))];
  return all.length ? all : null;
}
/** Код известен по таблицам (для буквенных кодов Subaru вроде GDB, у которых нет цифр) */
const jdmKnown = (code: string) => !!(JDM_WIKI[code] || JDM[code]);

export function decodeJdm(raw: unknown): JdmDecode | null {
  const str = String(raw).toUpperCase().replace(/\s/g, '').replace(/[–—_]/g, '-');
  if (!str.includes('-')) return null;
  const parts = str.split('-');
  if (parts.length < 2 || parts.length > 3) return null;
  const serial = parts[parts.length - 1], code = parts[parts.length - 2];
  const cert = parts.length === 3 ? parts[0] : null;
  if (!/^\d{5,8}$/.test(serial) || !(/^[A-Z]{1,5}\d{1,3}[A-Z]{0,2}$/.test(code) || (/^[A-Z]{3,4}$/.test(code) && jdmKnown(code)))) return null;
  if (cert && !/^[A-Z0-9]{1,4}$/.test(cert)) return null;
  // японская Википедия важнее таблицы по памяти; код без буквенного хвоста — запасной вариант («NA6CE» -> «NA6»)
  const wk = jdmWikiLookup(code);
  const wiki = wk && wk.map(([brand, model, gen, years, article]) => ({ brand, model, gen, years, article }))
    .filter((w, i, all) => all.findIndex(x => x.model === w.model && x.gen === w.gen) === i);
  const m = wiki ? null : JDM[code] || JDM[code.replace(/[A-Z]+$/, '')] || null;
  const n = +serial;
  const isToyota = wiki ? wiki.some(w => w.brand === 'Toyota' || w.brand === 'Lexus') : !m || m[0] === 'Toyota';
  const tRef = isToyota && MP ? MP.toyotaRef(code) : null;
  const sRef = MP ? MP.subaruRef(code, n) : null;
  return { vin: str, jdm: true, errors: [], cert, code, serial, toyota: isToyota ? toyotaStructure(code) : null,
    toyotaRef: tRef, subaruRef: sRef, match: m && { brand: m[0], model: m[1], years: m[2] }, wiki, certInfo: cert ? decodeJdmCert(cert) : null };
}

// Частичный VIN (8–16 символов, «*» = неизвестный символ): только то, что видно по известным позициям
function partialInfo(vin: string): PartialDecode {
  const res: PartialDecode = { vin, errors: [`В VIN должно быть 17 символов, сейчас ${vin.length}.`], partial: true };
  if (!vin.slice(0, 3).includes('*')) {
    res.wmi = vin.slice(0, 3);
    res.region = regionOf(vin[0]);
    res.country = countryOf(res.wmi);
    res.maker = assemblerOf(res.wmi, vin.length >= 14 && !vin.slice(11, 14).includes('*') ? vin.slice(11, 14) : undefined).maker;
  }
  if (vin.length >= 10 && vin[9] !== '*') res.year = modelYear(vin.padEnd(17, '*'));
  return res;
}

// ---- Peugeot (Европа): модельная линия по 4-му символу. Источник: Wikibooks, CC BY-SA ----
// Американские Peugeot 1981–1992 (все собраны в Сошо, 11-й символ S) расшифровывает база NHTSA, здесь только европейский формат.
const PEUGEOT_LINE: Dict = { 2: '206', 3: '307', 4: '308', 6: '407', 7: '306 или Partner', 8: '406 или 508', 9: '308', B: 'Expert', C: '208', D: '301', M: '3008', U: '2008' };
function peugeotDetails(vin: string): Row[] | null {
  if (!/^(VF3|VR3|VS8)$/.test(vin.slice(0, 3))) return null;
  if (vin[10] === 'S' && /[A-E]/.test(vin[3]) && vin.startsWith('VF3')) return null;   // американский формат 1981–1992
  const line = PEUGEOT_LINE[vin[3]];
  return [
    ['Модельная линия (4-й символ)', line ? `Peugeot ${line}` : `код ${vin[3]}`, line ? 'по таблице Wikibooks; один код бывает у нескольких поколений' : 'нет в справочнике'],
    ['Формат номера', 'европейский формат PSA', 'до 2009 года 10-й символ у PSA мог означать завод, а не модельный год: год по VIN тогда не определяется'],
  ];
}

// ---- Мотоциклы Bajaj и Dafra (Индия, Бразилия), по таблицам vininfo 1.11.0 (BSD-3-Clause) ----
const BAJAJ_COMMON: Dict = { A92: 'Dominar 160', A36: 'Dominar 200', A67: 'Dominar 400', B65: 'Dominar 250' };
const BAJAJ_BR_2026: Dict = { A92: 'Dominar NS160', A36: 'Dominar NS200' };   // Бразилия, с 2026 модельного года
const BAJAJ_BR_ANY: Dict = { C41: 'Pulsar N150' };
const BAJAJ_IN: Dict = { B54: 'Pulsar N160', B97: 'Pulsar N250' };
const BAJAJ_BY_DAFRA: Dict = { '2A1': 'Dominar 160', '2B1': 'Dominar 200', '3B1': 'Dominar 400' };
const DAFRA_MODELS: Dict = { CA: 'Speed 150', CB: 'Kansas 150' };
const BAJAJ_IN_PLANT: Dict = { C: 'Чакан, Индия', W: 'Валудж, Индия (предположительно)', P: 'Пантнагар, Индия (предположительно)' };
function motoDetails(vin: string): Row[] | null {
  const wmi = vin.slice(0, 3);
  if (wmi !== 'MD2' && wmi !== '92T' && wmi !== '95V') return null;
  const code3 = vin.slice(3, 6), code2 = vin.slice(3, 5);
  let model: string | undefined, label = 'Модель (4–6-й символы)', brand = 'Bajaj';
  if (wmi === 'MD2') model = { ...BAJAJ_COMMON, ...BAJAJ_IN }[code3];
  else if (wmi === '92T') {
    const y = modelYear(vin), years = y ? [y.value, y.alt].filter((v): v is number => v != null) : [];
    const to = Math.max(new Date().getFullYear(), 2026) + 1;
    const late = years.some(v => v >= 2026 && v <= to);
    model = { ...BAJAJ_COMMON, ...BAJAJ_BR_ANY, ...(late ? BAJAJ_BR_2026 : {}) }[code3];
  } else {
    model = BAJAJ_BY_DAFRA[code3];   // 95V: Dafra собирает и свои модели, и Bajaj
    if (!model && DAFRA_MODELS[code2]) { model = DAFRA_MODELS[code2]; label = 'Модель (4–5-й символы)'; brand = 'Dafra'; }
  }
  const plant = wmi === 'MD2' ? BAJAJ_IN_PLANT[vin[10]] : vin[10] === 'M' ? 'Манаус, Бразилия' : undefined;
  return [
    ['Марка', brand, wmi === '95V' ? 'Dafra Motos (Манаус) собирает и собственные модели, и Bajaj' : null],
    [label, model || `код ${label.includes('6') ? code3 : code2}`, model ? 'по таблицам vininfo' : 'нет в справочнике'],
    ['Тип', 'мотоцикл', 'vininfo считает мотоциклом любой номер этих марок'],
    ['Завод (11-й символ)', plant ? `${plant} (${vin[10]})` : `код ${vin[10]}`, plant ? null : 'нет в справочнике'],
  ];
}

// ---- Caterham (SDK, Великобритания) и марки Мьянмы (MS0, MS1). Источник: Wikibooks, CC BY-SA 4.0 ----
// Страницы «Caterham/VIN Codes» (ревизия 4602150), «KIA MYANMAR/VIN Codes» (4634594), «SUPER SEVEN STARS … /VIN Codes» (4497010, 4497025)
const CAT_STEER: Dict = { L: 'левый руль', R: 'правый руль' };
const CAT_REAR: Dict = { C: 'неразрезной мост (Classic)', D: 'De Dion', L: 'удлинённое шасси (Long cockpit)', W: 'на поперечных рычагах' };
const CAT_STATE: Dict = { C: 'CKD (полная разборка, не кит-кар)', F: 'собран на заводе, одобрение типа малой серии', K: 'кит-кар (собран владельцем)', S: 'собран на заводе', U: 'полностью собран' };
const CAT_CHASSIS: Dict = { 3: 'Series 3', 5: 'SV', 6: 'CSR', A: 'Alternative (обычно экспортные машины)', C: 'Clubman', H: 'HPC', L: 'Superlight', O: 'другое', R: 'гоночное шасси (иногда Road)', S: 'Starter kit', T: 'Track' };
const CAT_ENGINE: Dict = { '17': 'Ford 1700 Super Sprint (Crossflow)', FB: 'Honda Fireblade', S4: 'Ford Sigma (150hp)', BB: 'Honda Blackbird', GS: 'Ford 1600 Crossflow (100hp)', S5: 'Ford Sigma (средняя мощность)',
  C0: 'Ford Duratec', GT: 'Ford 1600 CrossFlow (84hp)', S6: 'Ford Sigma (высокая мощность)', C1: 'Cosworth 2.3 (200hp, Euro 4)', MK: 'Ford 1600 CrossFlow (110hp, Sprint)', SE: 'Ford Sigma, Euro 4',
  C2: 'Cosworth 2.3 (260hp)', NS: 'без двигателя (не поставлялся)', SF: 'Ford Sigma, Euro 5', C3: 'Ford Duratec 2.3 (200hp)', R3: 'R300 Rover K-Series', SL: 'Ford Sigma/Duratec, рынок США',
  C4: 'Cosworth Duratec 2.0, гоночный', R4: 'R400 Rover K-Series', TC: 'Ford/Lotus Twin Cam', C5: 'Ford Duratec 2.0 (210hp)', R5: 'R500 Rover K-Series 1.8 VHPD (230hp)', VI: 'Vauxhall, впрыск',
  C6: 'Cosworth BDR 1600', R6: 'Rover K-Series 1.6', VJ: 'Vauxhall, впрыск', C7: 'Cosworth BDR 1700', R8: 'Rover K-Series 1.8', VT: 'Vauxhall Turbo', C8: 'Cosworth BDR 1800', RC: 'Rover VVC',
  VX: 'Vauxhall 2.0, карбюратор или впрыск', DS: 'Ford Duratec с компрессором', RD: 'Rover VHPD', XC: 'Vauxhall 1.6 8V (Family II)', D1: 'Ford Duratec 2.0 (200hp, Euro 4)', RI: 'Rover K-Series 1.4 (после 1992)',
  XS: 'Vauxhall 1.8 8V (Family II)', D2: 'Ford Duratec 2.0 (170hp)', RJ: 'Rover K-Series 1.4 (с 2002)', Z2: 'Suzuki K6A turbo (Euro 6)', D3: 'Ford Duratec 2.0 (170hp, Euro 4)', S0: 'Ford Sigma',
  Z3: 'Suzuki K6A turbo', D4: 'Ford Duratec 2.0 (200hp, Euro 5)', S1: 'Ford Sigma (125hp)', ZA: 'Suzuki R06A turbo', D5: 'Ford Duratec 2.0 (260hp)', S2: 'Ford Sigma (стандартная мощность)',
  D6: 'Ford Duratec 2.0 (170hp, Euro 5)', S3: 'Ford Sigma (140hp)', D7: 'Ford Duratec 2.0 (180hp, CARB)' };
const CAT_YEAR_OLD: Dict = { M: '1991', N: '1992', P: '1993', R: '1994', S: '1995', T: '1996', V: '1997', W: '1998', X: '1999', Y: '2000' };
const CAT_GEAR: Dict = { 5: '5-ступенчатая', 6: '6-ступенчатая', 0: 'без коробки (машина без одобрения типа)' };
const CAT_PACK: Dict = { 1: 'Starter Kit (Seven)', 2: 'Series 3 Kit', 3: 'Series 3', 4: 'Caterham21', 5: 'Series 5 (V)', 6: 'CSR', 7: 'Special' };
const code = (m: Dict, c: string): string => m[c] ? `${m[c]} (${c})` : `код ${c}`;
function caterhamDetails(vin: string): Row[] | null {
  if (!vin.startsWith('SDK')) return null;
  const y10 = vin[9], y11 = vin[10];
  let year: string, yHint: string | null = null;
  const late = /[12]/.test(y10) && /\d/.test(y11) ? `20${y10}${y11}` : null;
  if (CAT_YEAR_OLD[y10]) year = CAT_YEAR_OLD[y10];
  else if (late && y11 !== '0') year = late;
  else if (late) { year = `200${y10} или ${late}`; yHint = 'до 2010 года 10-й символ — год, 11-й обычно 0; с 2010 года 10-й и 11-й вместе дают год'; }
  else if (/[3-9]/.test(y10)) year = `200${y10}`;
  else year = `код ${y10}`;
  const after2010 = !!late && y11 !== '0';
  const rows: Row[] = [
    ['Руль (4-й символ)', code(CAT_STEER, vin[3])],
    ['Задняя подвеска (5-й символ)', code(CAT_REAR, vin[4])],
    ['Способ сборки (6-й символ)', code(CAT_STATE, vin[5])],
    ['Шасси / модель (7-й символ)', code(CAT_CHASSIS, vin[6])],
    ['Двигатель (8–9-й символы)', code(CAT_ENGINE, vin.slice(7, 9)), CAT_ENGINE[vin.slice(7, 9)] ? null : 'нет в таблице Wikibooks'],
    ['Год выпуска', year, yHint || (after2010 ? '10-й и 11-й символы вместе: так Caterham пишет год с 2010' : 'год изготовления по таблице Caterham, не модельный год ISO')],
  ];
  if (after2010) rows.push(['Коробка (12-й символ)', code(CAT_GEAR, vin[11])], ['Комплектация (13-й символ)', code(CAT_PACK, vin[12])]);
  rows.push(['Формат номера', 'Caterham (с 1992–1993 годов)', 'контрольной цифры у Caterham нет: 9-й символ — часть кода двигателя']);
  return rows;
}

const MM_LINE: Dict = { G: 'Optima', JF: 'Optima', K5: 'Optima', DL: 'Optima', B: 'Picanto', JA: 'Picanto', D: 'Rio', YB: 'Rio', H: 'Carens', RP: 'Carens', N: 'Sportage', QL: 'Sportage',
  P: 'Sorento', UM: 'Sorento', MQ: 'Sorento', M: 'Carnival', YP: 'Carnival', KA: 'Carnival', BD: 'Cerato', AB: 'Soluto', SP: 'Seltos', QY: 'Sonet' };
const MM_GRADE: Dict = { S: 'низшая (L)', T: 'ниже средней (GL)', U: 'средняя (GLS)', V: 'выше средней (HGS)', W: 'высшая (TOP)', X: 'Premium GL (PGL)' };
const MM_BODY: Dict = { 1: 'лимузин', 2: 'седан, 2 двери', 3: '3 двери', 4: 'седан, 4 двери', 5: '5 дверей (хэтчбек/универсал)', 6: 'купе', 7: 'кабриолет', 8: 'универсал' };
const MM_ENGINE: Dict = { 0: 'бензин 3.3 л', 1: 'бензин 1.6 л', 2: 'бензин 1.2 л', 3: 'бензин 1.4 л', 4: 'бензин 1.5 л', 5: 'бензин 2.0 л', 6: 'бензин 2.4 л', 7: 'дизель 1.7 л', 8: 'дизель 2.0 л', 9: 'дизель 2.2 л' };
const MM_DRIVE: Dict = { A: 'левый руль, автомат', B: 'левый руль, механика', C: 'левый руль, механика и раздатка', D: 'левый руль, автомат и раздатка', E: 'левый руль, вариатор',
  F: 'левый руль, редуктор (электромобиль)', G: 'левый руль, робот DCT', H: 'левый руль, DCT и раздатка' };
const MS1_LINE: Dict = { E3: 'L7', WL: 'LS7', WR: 'LS6', WT: 'L6' };
const MS1_BODY: Dict = { 2: 'хэтчбек, 3 двери', 3: 'хэтчбек, 4 двери', 4: 'хэтчбек/кроссовер, 5 дверей', 5: 'седан, 2 двери', 6: 'седан, 4 двери', 7: 'хэтчбек, 2 двери' };
const MS1_MOTOR: Dict = { 0: 'электромотор мощнее 60 кВт', 8: 'электромотор 30–60 кВт' };
function myanmarDetails(vin: string): Row[] | null {
  const wmi = vin.slice(0, 3);
  if (wmi === 'MS1') {
    const l = vin.slice(3, 5);
    return [
      ['Производитель', 'Super Seven Stars Automotive (Янгон, Мьянма)'],
      ['Модель (4–5-й символы)', MS1_LINE[l] ? `${MS1_LINE[l]} (${l})` : `код ${l}`, MS1_LINE[l] ? 'по таблице производителя в Wikibooks (с 2025 года)' : 'нет в таблице'],
      ['Кузов (6-й символ)', code(MS1_BODY, vin[5])],
      ['Мотор (7-й символ)', code(MS1_MOTOR, vin[6])],
      ['Завод (11-й символ)', vin[10] === 'Y' ? 'Янгон (Y)' : `код ${vin[10]}`],
    ];
  }
  if (wmi !== 'MS0') return null;
  if (vin[3] === 'D' && /[A-G]/.test(vin[4]) && /[12]/.test(vin[5])) {
    // формат Super Seven Stars Motors Industry: 4-й символ — марка (D = Kia)
    const SSS_BODY: Dict = { A: 'седан, 5 дверей, 4×2', B: 'хэтчбек/универсал, 5 дверей, 4×2', C: 'седан, 4 двери, 4×2', D: 'хэтчбек/универсал, 5 дверей, 4×4', E: 'хэтчбек, 4 двери, 4×2', F: 'седан, 2 двери, 4×2', G: 'хэтчбек, 3 двери, 4×2' };
    const SSS_ENG: Dict = { 1: 'бензин 1.5–2.0 л (без 2.0)', 2: 'бензин до 1.5 л', 4: 'бензин 2.0–2.5 л (без 2.5)' };
    return [
      ['Марка (4-й символ)', 'Kia (D)', 'сборка Super Seven Stars Motors Industry, Мьянма'],
      ['Кузов и привод (5-й символ)', code(SSS_BODY, vin[4])],
      ['Коробка (6-й символ)', vin[5] === '1' ? 'механика (1)' : 'автомат (2)'],
      ['Двигатель (7-й символ)', code(SSS_ENG, vin[6])],
      ['Ремни и подушки (8-й символ)', vin[7] === 'A' ? 'ремни (A)' : vin[7] === 'B' ? 'ремни и подушки безопасности (B)' : `код ${vin[7]}`],
      ['Завод (11-й символ)', vin[10] === 'Y' ? 'Янгон (Y)' : `код ${vin[10]}`],
    ];
  }
  const two = MM_LINE[vin.slice(3, 5)] && vin.slice(3, 5).length === 2 && !MM_GRADE[vin[4]] ? vin.slice(3, 5) : null;
  const one = !two && MM_LINE[vin[3]] && MM_GRADE[vin[4]] ? vin[3] : null;
  const lineCode = two || one;
  const rows: Row[] = [
    ['Сборщик', 'Super Seven Stars Motors Industry (Kia Myanmar), Янгон'],
    [two ? 'Модель (4–5-й символы)' : 'Модель (4-й символ)', lineCode ? `Kia ${MM_LINE[lineCode]} (${lineCode})` : `код ${vin.slice(3, 5)}`, lineCode ? (two ? 'формат с 2019 года' : 'формат 2017 года') : 'нет в таблице Wikibooks'],
  ];
  if (one) rows.push(['Комплектация (5-й символ)', code(MM_GRADE, vin[4])]);
  rows.push(['Кузов (6-й символ)', code(MM_BODY, vin[5])]);
  if (two) rows.push(['Двигатель (7-й символ)', code(MM_ENGINE, vin[6])], ['Руль и коробка (8-й символ)', code(MM_DRIVE, vin[7])], ['Число передач (9-й символ)', /[4-8]/.test(vin[8]) ? vin[8] : `код ${vin[8]}`]);
  else rows.push(['Ремни, двигатель, коробка (7–9-й символы)', vin.slice(6, 9), 'таблиц для формата 2017 года в Wikibooks нет, есть только пример номера']);
  rows.push(['Завод (11-й символ)', vin[10] === 'Y' ? 'Янгон (Y)' : `код ${vin[10]}`]);
  return rows;
}

// ---- Заводы бывшего СССР: индекс модели в 4–9-м символах (ВАЗ-21099 → XTA210990…) ----
// Индексы по отраслевой нормали ОН 025270-66: 1-я цифра — класс, 2-я — тип машины, 3–4-я — номер модели, 5-я — модификация,
// 6-я — исполнение. Тип по 2-й цифре — по статье «Системы индексации автотранспорта в СССР и России» (русская Википедия);
// классы по 1-й цифре в этой статье расходятся с её же примерами (ВАЗ-2101 с мотором 1,2 л попал бы не в свой класс), поэтому не выводятся.
// модели — по названиям статей о моделях. То, что 4–9-й символы VIN у ВАЗ — это модель с модификацией, сказано в заводском
// руководстве (пример XTA211440…); у других заводов так же устроены известные номера, но документа под рукой нет.
const IDX_TYPE: Dict = { 1: 'легковой автомобиль', 2: 'автобус', 3: 'грузовой автомобиль', 4: 'тягач', 5: 'самосвал', 6: 'автоцистерна', 7: 'фургон', 8: 'специальный автомобиль' };
function ussrDetails(vin: string): Row[] | null {
  const brands = USSR_BRAND[vin.slice(0, 3)];
  const vds = vin.slice(3, 9);
  if (!brands || !/^\d{4}/.test(vds)) return null;
  let hit: [brand: string, idx: string, page: string] | null = null;
  for (let k = Math.min(6, (vds.match(/^\d+/) as RegExpMatchArray)[0].length); k >= 4 && !hit; k--)
    for (const b of brands) { const p = USSR_MODELS[b] && USSR_MODELS[b][vds.slice(0, k)]; if (p) { hit = [b, vds.slice(0, k), p]; break; } }
  const base = vds.slice(0, 4);
  const type = IDX_TYPE[base[1]];
  const rows: Row[] = [];
  if (hit) {
    const [b, idx, page] = hit;
    const pageName = page.replace(/#.*/, '');
    rows.push(['Модель по индексу (4–9-й символы)', `${b}-${idx}`, `индекс модели из VIN совпал со статьёй русской Википедии «${pageName}»; сверяйте с ПТС`]);
    if (idx.length < 6) rows.push(['Остальные цифры индекса', vds.slice(idx.length), idx.length === 4 ? '5-я цифра — модификация, 6-я — исполнение или комплектация' : '6-я цифра — исполнение или комплектация']);
  } else {
    rows.push(['Индекс модели (4–9-й символы)', vds, `модели с таким индексом среди статей русской Википедии о ${brands.join(', ')} не нашлось`]);
  }
  if (type) rows.push(['Тип по индексу (2-я цифра)', type, 'по отраслевой нормали ОН 025270-66; не все заводы её соблюдают']);
  if (brands.includes('ВАЗ')) rows.push(['11–17-й символы', vin.slice(10), 'у ВАЗ это номер кузова; на новых номерах 11-й символ — завод (0 — Тольятти, Y — Ижевск)']);
  return rows;
}

type DetailsFn = (vin: string) => Row[] | null;
/** Цепочка дешифраторов по марке; порядок важен: срабатывает первый, вернувший строки */
function detailsChain(): [DetailsFn, string][] {
  const d = MP && MP.details;
  const opt = (fn: DetailsFn | undefined, label: string): [DetailsFn, string][] => (fn ? [[fn, label]] : []);
  return [...opt(d?.mercedes, 'Mitchell 1'), [mercedesWbDetails, 'Wikibooks'], [audiDetails, d ? 'Mitchell 1 и Wikibooks' : 'Wikibooks'], ...opt(d?.porsche, 'Mitchell 1'),
    [vwDetails, d ? 'Mitchell 1 и Wikibooks' : 'Wikibooks'], ...opt(d?.jaguar, 'Mitchell 1'), ...opt(d?.saab, 'Mitchell 1'), ...opt(d?.colt, 'Mitchell 1'),
    [volvoDetails, 'Wikibooks'], [kiaDetails, 'Wikibooks'], [jaguarWbDetails, 'Wikibooks'], [landRoverDetails, 'Wikibooks'], [peugeotDetails, 'Wikibooks'],
    [motoDetails, 'vininfo (мотоциклы)'], [caterhamDetails, 'Wikibooks'], [myanmarDetails, 'Wikibooks'], [ussrDetails, 'русская Википедия']];
}

/** Полная ISO-расшифровка (а не ошибка, частичный, старый или JDM-номер) */
export const isIso = (d: LocalDecode): d is IsoDecode => !d.partial && !d.jdm && !d.legacy && !!d.check;

export function decodeLocal(raw: unknown): LocalDecode {
  const jdm = raw ? decodeJdm(raw) : null;
  if (jdm) return jdm;
  const leg = raw ? decodeLegacy(normalize(raw)) : null;
  if (leg) return leg;
  const vin = normalize(raw);
  const errors: string[] = [];
  if (vin.length !== 17) errors.push(`В VIN должно быть 17 символов, сейчас ${vin.length}.`);
  if (vin.length >= 8 && vin.length < 17 && /^[A-HJ-NPR-Z0-9*]+$/.test(vin)) return partialInfo(vin);
  const bad = [...new Set(vin.match(/[^A-HJ-NPR-Z0-9]/g) || [])];
  if (bad.length) errors.push(`Недопустимые символы: ${bad.join(' ')}. В VIN не бывает I, O, Q и спецзнаков.`);
  if (errors.length) return { vin, errors } satisfies ErrorDecode;

  const wmi = vin.slice(0, 3);
  const small = vin[2] === '9';
  const expected = checkDigit(vin);
  const asm = assemblerOf(wmi, vin.slice(11, 14));
  const spec = asm.key ? DETAILS[asm.key] : undefined;
  let maker = asm.maker, makerSrc = asm.src;
  if (!maker) {   // нет в локальных таблицах: производитель из базы NHTSA, если она загружена
    const wi = wmiInfo(wmiKey(vin)), LKP = nhtsaLookups();
    if (wi && LKP && LKP.mfr[wi[0]]) { maker = LKP.mfr[wi[0]]; makerSrc = 'база NHTSA (таблица WMI)'; }
  }
  let details = asm.key ? brandDetails(vin, asm.key) : null;
  let source: string | null = details ? 'vininfo' : null;
  if (!details) {
    details = hyundaiDetails(vin);
    if (details) source = 'universal-vin-decoder (Java)';
  }
  if (!details) {
    for (const [fn, label] of detailsChain()) {
      const r = fn(vin);
      if (r) { details = r; source = label; break; }
    }
  }
  const makerAlt = small ? [] : makerAlternatives(wmi, maker);
  const res: IsoDecode = {
    vin, errors,
    wmi,
    region: regionOf(vin[0]),
    country: countryOf(wmi),
    maker,
    makerSrc,
    ...(makerAlt.length ? { makerAlt } : {}),
    brandKey: asm.key,
    brandDetails: details,
    brandSource: source,
    noCheck: !!(spec && spec._noSaeCheck),
    smallMaker: small,
    plantWb: plantWb(asm.maker, wmi, vin[10]),
    smallMakerCode: small ? vin.slice(11, 14) : null,
    year: modelYear(vin, (spec && spec._yearPos) || 9),
    check: { actual: vin[8], expected, ok: vin[8] === expected },
    plant: vin[10],
    plantInfo: plantOf(wmi, vin[10]),
    serial: vin.slice(11),
  };
  return res;
}
