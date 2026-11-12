// Пакет справочника Mitchell 1 «2009 VIN Decoding»: все данные и дешифраторы, взятые из него (только значения кодов, см. NOTICE.txt).
// Отдельный модуль, чтобы каждую сборку (расширение, сайт, библиотека) можно было собрать с ним или без него.
// Подключение: import { MITCHELL } from './mitchell'; useMitchell(MITCHELL);
import { US_LEGACY } from './data/legacy-us';
import { US_TRUCKS } from './data/legacy-trucks';
import { MB_TYPES, AUDI_TYPES, VOLVO_RANGES, PORSCHE, VW_BY_YEAR, VW_BY_TYPE, TOYOTA_CODES, SUBARU_RANGES, JAGUAR } from './data/euro-tables';
import { FORD_PLANTS_WB } from './data/plants-us-wb';
import { PO_ENGINES, VW_ENGINE_PREFIX, VW_ENGINE_CODES, VW_BEETLE_ENGINES, MB_ENGINE_TYPES, MAZDA_7980 } from './data/mitchell-engines';
import type { Dict, UsLegacy } from './data/types';
import type { LegacyDecode, MitchellPack, Row } from './types';
import { legacyResult, NOTE_STD, ruBody, ruEngine, ruTrans, plantRow, gmPlantRow, FORD_PLANT, FORD_PLANT_OK } from './decode';

// American Motors 1974–1980, 13 символов: «A9S055A100001»
function decodeAmcLegacy(vin: string): LegacyDecode | null {
  if (!/^A[0-9A][A-Z]\d{3}[A-Z]\d{6}$/.test(vin)) return null;
  const y = vin[1] === 'A' || vin[1] === '0' ? 1980 : +vin[1] >= 4 ? 1970 + +vin[1] : null;
  if (!y) return null;
  const t: Partial<UsLegacy['amc'][string]> = US_LEGACY.amc[y] || {};
  type AmcKey = keyof UsLegacy['amc'][string];
  const get = (k: AmcKey, code: string, f: (x: string) => string = x => x): string | null => { const m = t[k]; return m && m[code] ? f(m[code]) : null; };
  const row = (label: string, k: AmcKey, code: string, f?: (x: string) => string, hint?: string): Row => {
    const v = get(k, code, f);
    return [label, v ? `${v} (${code})` : `код ${code}`, v ? hint || null : 'такого кода в таблице за этот год нет'];
  };
  return legacyResult(vin, 'American Motors Corporation, 1974–1980 (13 символов)',
    [['wmi', 0, 1, 'производитель'], ['year', 1, 2, 'год'], ['vds', 2, 3, 'коробка'], ['vds', 3, 4, 'серия'], ['chk', 4, 5, 'кузов'],
     ['vds', 5, 6, 'модель'], ['plant', 6, 7, 'двигатель'], ['serial', 7, 13, 'серийный номер']],
    [['Формат', 'American Motors Corporation, 1974–1980 (13 символов)', NOTE_STD],
     ['Производитель', 'American Motors Corporation (A)'], ['Модельный год', String(y)],
     row('Коробка', 't', vin[2], ruTrans), row('Серия', 's', vin[3]), row('Кузов', 'b', vin[4], ruBody), row('Модель', 'm', vin[5]),
     row('Двигатель', 'e', vin[6], ruEngine, 'hp здесь по старой методике (SAE gross), карб. = карбюратор'),
     ['Серийный номер', vin.slice(7)]]);
}

// ---- Таблицы по справочнику Mitchell 1: Mercedes (тип шасси), Audi (код типа), Volvo (диапазоны номеров) ----
function ruMb(s: string): string {
  return s.replace(/\(Turbo Diesel\)/g, '(турбодизель)').replace(/\(Diesel\)/g, '(дизель)').replace(/\bFour\b/g, '4 цил.').replace(/\bFive\b/g, '5 цил.')
    .replace(/\bSix\b/g, '6 цил.').replace(/\bCabriolet\b|\bConvertible\b/g, 'кабриолет').replace(/\bCoupe\b/g, 'купе')
    .replace(/\bSedan\b|\bSed\b/g, 'седан').replace(/\bS\/W\b/g, 'универсал').replace(/\bSupercharged\b/g, 'компрессор').replace(/\bTurbo\b/g, 'турбо');
}
function ruPo(s: string): string {
  return s.replace(/\bSix\b/g, '6 цил.').replace(/\bFour\b/g, '4 цил.').replace(/\bTen\b/g, '10 цил.').replace(/\bLitre\b/g, 'л')
    .replace(/\bCabrio(?:let)?\b/g, 'кабриолет').replace(/\bCoupe\b/g, 'купе').replace(/\bTarga\b/g, 'тарга').replace(/\bSpeedster\b/g, 'спидстер');
}
function poLookup(key: string): string | null {
  const hit = PORSCHE[key];
  return hit ? hit.map(([d, y]) => `${ruPo(d)} (${y})`).join('; ') : null;
}
function porscheDetails(vin: string): Row[] | null {
  if (!/^WP[01]$/.test(vin.slice(0, 3))) return null;
  const v = poLookup(vin.slice(6, 8) + vin[9] + vin[10] + vin.slice(11, 13));
  return v ? [['Модель по справочнику Mitchell 1', v, 'ключ: код типа (7–8-й символы), год, завод и первые две цифры серийного номера; справочник 1973–2004']] : null;
}
const MB_17 = /^(WD[B-F1-4A]|W1[KNV])$/;
function mercedesDetails(vin: string): Row[] | null {
  if (!MB_17.test(vin.slice(0, 3))) return null;
  const type = vin.slice(3, 9), hit = MB_TYPES[type];
  if (!hit) return null;
  return [['Тип шасси (4–9-й символы)', `${type.slice(0, 3)}.${type.slice(3)}`, 'первые три цифры — модельный ряд, следующие три — версия'],
    ['Модель и двигатель', hit.map(([d, y]) => `${ruMb(d)} (${y})`).join('; '), 'по справочнику Mitchell 1 для американского рынка, 1973–2004']];
}
function audiDetails(vin: string): Row[] | null {
  const t = AUDI_TYPES[vin.slice(6, 8)];
  return t ? [['Код типа (7–8-й символы)', vin.slice(6, 8), 'по справочнику Mitchell 1; для американского рынка 1980–2003'],
    ['Модель по коду типа', `${t.m.join(' / ')} (${t.y})`, 'один код типа может объединять несколько моделей']] : null;
}
function decodeVolvoNumber(vin: string): LegacyDecode | null {
  if (!/^\d{5,7}$/.test(vin)) return null;
  const n = +vin;
  const hits = VOLVO_RANGES.filter(r => n >= r[4] && n <= (r[5] ?? r[4] + 60000));
  if (!hits.length) return null;
  hits.sort((a, b) => a[0] - b[0]);
  const rows: Row[] = [['Формат', 'порядковый номер Volvo 1973–1997 (предположительно)', 'сопоставление по таблице диапазонов номеров шасси: номер без кода модели неоднозначен']];
  hits.slice(0, 8).forEach((r, i) => rows.push([`Совпадение ${i + 1}`, `${ruBody(r[3] || r[2])}, ${r[0] === r[1] ? r[0] : r[0] + '–' + r[1]}`,
    `диапазон ${r[4]}–${r[5] ?? 'и выше'}`]));
  if (hits.length > 8) rows.push(['…', `ещё совпадений: ${hits.length - 8}`, null]);
  return legacyResult(vin, 'Volvo', [['serial', 0, vin.length, 'номер']], rows);
}

// Volkswagen: код типа (2 символа) + год: хвост номера шасси по справочнику Mitchell 1 (американский рынок, 1973–2002)
function vwModels(key: string): string | null {
  const hit = VW_BY_YEAR[key];
  return hit ? hit.map(([m, y]) => `${m} (${y})`).join('; ') : null;
}
function vwYearDetails(vin: string): Row[] | null {
  const typ = vin.slice(6, 8), y = vwModels(typ + vin[9]);
  return y ? [['Код типа (7–8-й символы) и год', `${typ} / ${vin[9]}`, 'тип модели и символ года образуют ключ справочника'], ['Модель по справочнику Mitchell 1', y, 'американский рынок 1973–2002']] : null;
}
function vwTypeDetails(vin: string): Row[] | null {
  const typ = vin.slice(6, 8), t = VW_BY_TYPE[typ];
  return t ? [['Код типа (7–8-й символы)', typ, null], ['Модели с этим кодом', t.map(([m, yy]) => `${m} (${yy})`).join('; '), 'сочетания с этим годом в справочнике нет']] : null;
}
function decodeVwLegacy(vin: string): LegacyDecode | null {
  if (!/^[0-9A-Z]{9,10}$/.test(vin) || !/^\d{6}$/.test(vin.slice(-6))) return null;
  const y = vwModels(vin.slice(0, 3));
  if (!y) return null;
  return legacyResult(vin, 'Volkswagen, хвост номера шасси',
    [['wmi', 0, 2, 'тип'], ['year', 2, 3, 'год'], ['vds', 3, vin.length - 6, 'завод'], ['serial', vin.length - 6, vin.length, 'серийный номер']],
    [['Формат', 'Volkswagen: тип (2 знака), год (1), серийный номер', NOTE_STD], ['Код типа', vin.slice(0, 2)],
     ['Модель по справочнику Mitchell 1', y, 'американский рынок 1973–2002'], ['Серийный номер', vin.slice(-6)]]);
}

// ---- Jaguar (номера шасси 1973–1999), по справочнику Mitchell 1 ----
function ruJag(s: string): string {
  return ruBody(s.replace(/(\d+) Cyl-([\d.]+) Litre/, '$1 цил., $2 л').replace(/Supercharged/, 'компрессор').replace(/w\/Active Restraint/, 'с активной системой безопасности')
    .replace(/w\/Passive Restraint/, 'с пассивной системой безопасности').replace(/Conv \(Open Car\)/, 'кабриолет').replace(/\bSeries\b/, 'серия'));
}
function jagLookup(key: string): string | null {
  const hit = JAGUAR[key];
  return hit ? hit.map(([d, y]) => `${ruJag(d)} (${y})`).join('; ') : null;
}
function jaguarDetails(vin: string): Row[] | null {
  if (vin.slice(0, 3) !== 'SAJ') return null;
  const v = jagLookup(vin.slice(3, 8));
  return v ? [['Модель по справочнику Mitchell 1', v, 'ключ: символы 4–8; справочник американского рынка 1981–1999']] : null;
}
function decodeJaguarChassis(vin: string): LegacyDecode | null {
  if (/^\d[A-Z]\d{5}$/.test(vin)) {
    const v = jagLookup(vin.slice(0, 3));
    if (!v) return null;
    return legacyResult(vin, 'Jaguar, номер шасси 1973–1979 (7 знаков)', [['wmi', 0, 3, 'код модели'], ['serial', 3, 7, 'номер']],
      [['Формат', 'Jaguar: серия и модель по первым трём знакам', NOTE_STD], ['Модель по справочнику Mitchell 1', v, 'американский рынок; номера в справочнике — первые номера выпуска'], ['Номер', vin.slice(3)]]);
  }
  if (/^SAJ[A-Z0-9]{13}$/.test(vin)) {   // 16-значные номера до 1987 года
    const v = jagLookup(vin.slice(3, 8));
    if (!v) return null;
    return legacyResult(vin, 'Jaguar, 16-значный номер до 1987 года', [['wmi', 0, 3, 'производитель'], ['vds', 3, 8, 'модель'], ['year', 8, 9, 'год'], ['serial', 9, 16, 'остальное']],
      [['Формат', 'Jaguar: 16 знаков, без контрольной цифры', NOTE_STD], ['Модель по справочнику Mitchell 1', v, 'ключ: символы 4–8'], ['Год (9-й символ)', vin[8], 'буква года по обычной таблице']]);
  }
  return null;
}

// ---- Saab: VIN 1993–2009 (YS3, YK1), по справочнику Mitchell 1 ----
type SaabScheme = 'A' | 'B' | 'C';
const SAAB_YEAR: Dict<[number, SaabScheme]> = { P: [1993, 'A'], R: [1994, 'A'], S: [1995, 'A'], T: [1996, 'A'], V: [1997, 'A'], W: [1998, 'A'], X: [1999, 'A'], Y: [2000, 'A'],
  1: [2001, 'A'], 2: [2002, 'A'], 3: [2003, 'A'], 4: [2004, 'B'], 5: [2005, 'B'], 6: [2006, 'B'], 7: [2007, 'C'], 8: [2008, 'C'], 9: [2009, 'C'] };
const SAAB: Record<SaabScheme, { model: Dict; series: Dict; body: Dict; trans: Dict; plant: Dict }> = {
  A: { model: { A: '900', C: '9000', D: '900 (1995–98) / 9-3', E: '9-5', F: '9-3' },
    series: { D: 'двойные подушки (CD/CS, S, 9-3, 9-5)', F: 'двойные подушки (SE, CDE/CSE)', H: 'двойные подушки (Aero)', K: 'без турбо, подушка водителя', L: 'турбо, подушка водителя', M: 'без турбо, двойные подушки', N: 'турбо, двойные подушки', P: 'двойные подушки (9-3 Viggen)' },
    body: { 3: '2 дв. хэтчбек', 4: '4 дв. седан', 5: '4 дв. хэтчбек', 6: '4 дв. хэтчбек', 7: '2 дв. кабриолет' },
    trans: { 5: '5-ст. механика', 6: '3-ст. автомат (900) / 6-ст. механика (с 2000)', 8: '4-ст. автомат (9000)', 9: '5-ст. автомат' },
    plant: { 1: 'Трольхеттан, линия A (9000)', 2: 'Трольхеттан, линия B (900)', 7: 'Нюстад, Финляндия (900 кабриолет)', 9: 'Трольхеттан, опытная линия' } },
  B: { model: { E: '9-5', F: '9-3', G: '9-2x', 3: '9-7x' },
    series: { A: '9-5 Linear, подушка водителя', B: '9-3 Linear / 9-5 Linear с двойными подушками', C: '9-5 Arc, подушка водителя', D: '9-3 Arc / 9-5 Arc с двойными подушками', E: '9-7X (6001–7000 lb)', G: '9-5 Aero, подушка водителя', H: '9-3 Aero / 9-5 Aero с двойными подушками' },
    body: { 3: '4 дв.', 4: '4 дв.', 5: '5 дв.', 7: 'кабриолет', G: '5 дв. хэтчбек' },
    trans: { 5: '5-ст. механика', 6: '6-ст. механика', 9: '5-ст. автомат', '*': '4-ст. автомат' },
    plant: { 2: 'Морейн, Огайо', 3: 'Трольхеттан', 9: 'Трольхеттан, предсерия' } },
  C: { model: { E: '9-5', F: '9-3' },
    series: { B: '9-3 2.0T с двойными подушками', D: '9-3 2.0T / 9-5 2.3T с двойными подушками', H: '9-3 / 9-5 Aero с двойными подушками' },
    body: { 4: '4 дв.', 5: '5 дв.', 7: '2 дв. кабриолет' },
    trans: { 1: '6-ст. автомат', 5: '5-ст. механика', 6: '6-ст. механика', 9: '5-ст. автомат' },
    plant: { 1: 'Трольхеттан', 3: 'Трольхеттан', 6: 'Грац, Австрия' } },
};
const SAAB_ENG: Dict<Dict> = {
  A93: { B: '2.3L 16V', E: '2.1L 16V (900); 2.3L 16V (9-5)', G: '2.3L High Output Turbo (9-3 Viggen, 9-5)', L: '2.0L 16V с интеркулером, турбо', M: '2.3L 16V с интеркулером, турбо (9000)',
    N: '2.0L 16V, турбо Automatic Pressure', P: '2.0L турбо / 2.0L High Output турбо (9-3)', R: '2.3L 16V с интеркулером, турбо (9000 Sport)', T: '2.0L 16V с интеркулером, турбо (900 Sport)',
    U: '2.3L 16V, турбо Light Pressure', V: '2.5L 24V V6 (900)', W: '3.0L 24V V6 (9000)', Z: '3.0L турбо (9-5)' },
  A00: { E: '2.3L 16V (9-5)', G: '2.3L High Output Turbo (9-3 Viggen, 9-5)', K: '2.0L 16V', N: '2.0L 16V, турбо Automatic Pressure', P: '2.0L турбо / 2.0L High Output турбо (9-3)', S: '2.0L 16V', Y: '2.0L 16V', Z: '3.0L турбо (9-5)' },
  B: { A: '2.3L', E: '2.3L', G: '2.3L', L: '3.0L', M: '5.3L', S: '4.2L', U: '2.8L', Y: '2.0L', 2: '2.0L турбо', 6: '2.5L' },
  C: { G: '2.3L / 2.3L турбо / 2.3L High Output турбо', R: '2.8L High Output турбо', U: '2.8L турбо', Y: '2.0L' },
};
function saabDetails(vin: string): Row[] | null {
  if (!/^(YS3|YK1)$/.test(vin.slice(0, 3))) return null;
  const yr = SAAB_YEAR[vin[9]];
  if (!yr) return null;
  const [year, sch] = yr, T = SAAB[sch];
  const engT = sch === 'A' ? (year <= 1999 ? SAAB_ENG.A93 : SAAB_ENG.A00) : SAAB_ENG[sch];
  const g = (map: Dict, ch: string): string => map[ch] || `код ${ch}`;
  return [['Модель (4-й символ)', g(T.model, vin[3])], ['Серия и подушки (5-й символ)', g(T.series, vin[4])], ['Кузов (6-й символ)', g(T.body, vin[5])],
    ['Коробка (7-й символ)', g(T.trans, vin[6])], ['Двигатель (8-й символ)', g(engT, vin[7]), 'по справочнику Mitchell 1; у разных периодов буквы повторяются'],
    ['Завод (11-й символ)', g(T.plant, vin[10])], ['Год по 10-му символу', String(year), 'схема VIN Saab ' + (sch === 'A' ? '1993–2003' : sch === 'B' ? '2004–2006' : '2007–2009')]];
}

// ---- Chrysler Motors / Mitsubishi: Colt, Champ, Vista (1979–1994), по справочнику Mitchell 1 ----
const COLT_YEAR: Dict<number> = { B: 1981, C: 1982, D: 1983, E: 1984, F: 1985, G: 1986, H: 1987, J: 1988, K: 1989, L: 1990, M: 1991, N: 1992, P: 1993, R: 1994 };
const COLT_PLANT: Dict = { U: 'Мидзусима', Y: 'Нагоя', Z: 'Окадзаки', A: 'Мидзусима-2', J: 'Нагоя-3', P: 'Нагоя-2', O: 'Таиланд' };
const COLT_SERIES: Dict = { 1: 'Economy', 2: 'Low', 3: 'Medium', 4: 'High', 5: 'Premium', 6: 'Special' };
function coltModel(y: number, c: string): string | undefined {
  if (y <= 1985) return { A: 'Colt E, DL, Premier', E: 'Colt и Champ (до 1984)', G: 'Colt Vista FWD', H: 'Colt Vista 4WD' }[c];
  if (y <= 1988) return { A: 'Colt E, DL, Premier', G: 'Colt Vista FWD', H: 'Colt Vista AWD' }[c];
  if (y <= 1991) return { G: 'Colt Vista FWD', H: 'Colt Vista AWD', U: 'Colt', V: 'Colt DL универсал FWD', W: 'Colt DL универсал AWD' }[c];
  return { A: 'Colt', B: 'Colt Vista FWD', C: 'Colt Vista AWD' }[c];
}
function coltEngine(y: number, c: string): string | undefined {
  if (y <= 1985) return { 2: '1.4 л (1981–84)', 3: '1.6 л (1981–83)', D: '2.0 л (1984–85)', F: '1.6 л турбо (1984–85)', K: '1.5 л (1985)' }[c];
  if (y <= 1988) return { D: '2.0 л (карбюратор)', F: '1.6 л турбо', K: '1.5 л' }[c];
  if (y <= 1991) return { T: '1.8 л (Vista)', V: '2.0 л MPI', X: '1.5 л MPI', Z: '1.6 л MPI', A: '1.5 л MPI' }[c];
  return { A: '1.5 л MPI', C: '1.8 л MPI', G: '2.4 л MPI' }[c];
}
const COLT_BODY: Dict = { 1: '2-дверный седан / 5-дверный универсал (MPV)', 4: '2-дверный хэтчбек', 6: '4-дверный седан', 8: '4-дверный хэтчбек', 9: '4-дверный универсал', 0: '4-дверный универсал' };
function coltDetails(vin: string): Row[] | null {
  if (!/^[JM][BP][34]$/.test(vin.slice(0, 3))) return null;
  const y = COLT_YEAR[vin[9]];
  if (!y) return null;
  const model = coltModel(y, vin[4]);
  if (!model) return null;
  const eng = coltEngine(y, vin[7]);
  return [['Марка (2-й символ)', vin[1] === 'B' ? 'Dodge' : 'Plymouth'], ['Модель (5-й символ)', model], ['Серия (6-й символ)', COLT_SERIES[vin[5]] || `код ${vin[5]}`],
    ['Кузов (7-й символ)', COLT_BODY[vin[6]] || `код ${vin[6]}`, 'для легковых; у MPV коды иные'], ['Двигатель (8-й символ)', eng || `код ${vin[7]}`],
    ['Модельный год (10-й символ)', String(y)], ['Завод (11-й символ)', COLT_PLANT[vin[10]] || vin[10], 'по справочнику Mitchell 1']];
}
function decodeColtLegacy(vin: string): LegacyDecode | null {
  if (!/^[14][A-Z]\d{2}[JK][9A]\d\d\d{5}$/.test(vin)) return null;
  const y = vin[5] === '9' ? 1979 : 1980;
  return legacyResult(vin, 'Chrysler Motors (Mitsubishi), Champ / Colt, 1979–1980 (13 знаков)',
    [['wmi', 0, 1, 'модель'], ['vds', 1, 2, 'класс'], ['chk', 2, 4, 'кузов'], ['vds', 4, 5, 'двигатель'], ['year', 5, 6, 'год'], ['vds', 6, 8, 'отделка и коробка'], ['serial', 8, 13, 'серийный номер']],
    [['Формат', 'Chrysler Motors: Champ / Colt, 13 знаков', NOTE_STD], ['Модель', vin[0] === '1' ? 'Plymouth Champ' : 'Dodge Colt'], ['Класс', vin[1]],
     ['Кузов', vin.slice(2, 4) === '24' ? '2 двери (24)' : `код ${vin.slice(2, 4)}`], ['Двигатель', vin[4] === 'J' ? '1.4 л (1400 cc)' : '1.6 л (1600 cc)'],
     ['Модельный год', String(y)], ['Серийный номер', vin.slice(8)]]);
}

// ---- Грузовики и Jeep США 1974–1980 (Ford, Chevrolet/GMC, Dodge, Plymouth, Jeep), по справочнику Mitchell 1 ----
function ruTruck(s: string): string {
  return ruBody(s.replace(/Conv Cab/g, 'стандартная кабина')).replace(/\bPickup\b/g, 'пикап').replace(/\bVan\b/g, 'фургон').replace(/\bWagon\b/g, 'универсал').replace(/\bCab\b/g, 'кабина')
    .replace(/\bChassis\b/g, 'шасси').replace(/\bSport Utility\b/g, 'внедорожник').replace(/\bServices?\b/g, 'серия').replace(/\bSer\b/g, 'серия')
    .replace(/\bAuto\b/g, 'автомат').replace(/\bSpd\b/g, 'ст.').replace(/\bToledo\b/g, 'Толидо');
}
function ruEng2(s: string): string {
  const m = /^(\d)-(\d+)(?: \(([\d.]+)\))? (?:(\d)BC)?(.*)$/.exec(s);
  if (!m) return ruTruck(s);
  const fuel = m[4] ? `карб. ${m[4]} ${m[4] === '1' ? 'камера' : 'камеры'}` : '';
  return `${m[1]} цил., ${m[2]} cid${m[3] ? ` (${m[3].replace('.', ',')} л)` : ''}${fuel ? ', ' + fuel : ''}${m[5].trim() ? ', ' + ruTruck(m[5].trim()) : ''}`;
}
const TR_NOTE_ENG = 'hp и объёмы по старой методике, карб. = карбюратор';
const shapeOf = (x: string): string => x.replace(/[A-Z]/g, 'L').replace(/\d/g, 'D');
const mk = (label: string, map: Dict | undefined, code: string, f: (s: string) => string = ruTruck, hint: string | null = null): Row => map && map[code] ? [label, `${f(map[code])} (${code})`, hint] : [label, `код ${code}`, map ? 'такого кода в таблицах нет' : null];

function decodeFordTruck(vin: string): LegacyDecode | null {
  if (!/^[A-Z]\d{2}[A-Z][A-Z][A-Z]{1,2}\d{4,5}$/.test(vin)) return null;
  const ser = vin.slice(5), sh = shapeOf(ser);
  const hits = US_TRUCKS.ford_serial.filter(r => shapeOf(r[0]) === sh && ser >= r[0] && ser <= r[1]);
  const years = [...new Set(hits.map(r => r[2]))];
  if (!years.length) return null;
  const rows: Row[] = [['Формат', 'Ford, грузовики и фургоны 1974–1980 (11 знаков)', NOTE_STD],
    ['Модельный год (по серийному номеру)', years.join(' или '), `диапазон серийных номеров: ${hits.map(r => `${r[0]}–${r[1]}${r[3] ? ' ' + r[3] : ''}`).join('; ')}`]];
  const byYear = (kind: 's' | 'e', code: string) => years.map(y => [y, US_TRUCKS.ford[y] && US_TRUCKS.ford[y][kind][code]] as [number, string | undefined]).filter((e): e is [number, string] => !!e[1]);
  const sr = byYear('s', vin.slice(0, 3));
  const en = byYear('e', vin[3]);
  rows.push(['Серия (1–3-й символы)', sr.length ? sr.map(([y, v]) => `${years.length > 1 ? y + ': ' : ''}${ruTruck(v)}`).join('; ') : vin.slice(0, 3), sr.length ? null : 'такого кода в таблицах нет']);
  rows.push(['Двигатель (4-й символ)', en.length ? en.map(([y, v]) => `${years.length > 1 ? y + ': ' : ''}${ruEng2(v)}`).join('; ') : `код ${vin[3]}`, en.length ? TR_NOTE_ENG : 'такого кода в таблицах нет']);
  rows.push(plantRow('Завод (5-й символ)', FORD_PLANT, FORD_PLANT_OK, FORD_PLANTS_WB, vin[4]));
  rows.push(['Серийный номер', ser]);
  return legacyResult(vin, 'Ford (грузовики)', [['wmi', 0, 3, 'серия'], ['chk', 3, 4, 'двигатель'], ['plant', 4, 5, 'завод'], ['serial', 5, 11, 'серийный номер']], rows);
}

function decodeGmTruck(vin: string): LegacyDecode | null {
  if (!/^[CT][A-Z][A-Z][1-9]\d\d[A-Z0-9]\d{6}$/.test(vin)) return null;
  const d = +vin[5], year = d === 0 ? 1980 : d >= 4 ? 1970 + d : null;
  if (!year) return null;
  const T = US_TRUCKS[vin[0] === 'C' ? 'chevrolet' : 'gmc'][year];
  if (!T) return null;
  const rows: Row[] = [['Формат', 'General Motors, грузовики 1974–1980 (13 знаков)', NOTE_STD], ['Марка', vin[0] === 'C' ? 'Chevrolet' : 'GMC'],
    mk('Шасси (2-й символ)', T.c, vin[1]), mk('Двигатель (3-й символ)', T.e, vin[2], ruEng2, TR_NOTE_ENG), mk('Серия (4-й символ)', T.s, vin[3]),
    mk('Кузов (5-й символ)', T.b, vin[4]), ['Модельный год', String(year)], gmPlantRow('Завод (7-й символ)', vin[6], [year]),
    ['Серийный номер', vin.slice(7)]];
  return legacyResult(vin, 'GM (грузовики)', [['wmi', 0, 2, 'марка и шасси'], ['chk', 2, 3, 'двигатель'], ['vds', 3, 5, 'серия и кузов'], ['year', 5, 6, 'год'], ['plant', 6, 7, 'завод'], ['serial', 7, 13, 'серийный номер']], rows);
}

function decodeMoparTruck(vin: string): LegacyDecode | null {
  let make: 'dodge' | 'plymouth' | null = null;
  if (/^[ABDEW][1-3][0-9][A-D][A-Z][0-9A][A-Z0-9]\d{6}$/.test(vin)) make = 'dodge';
  else if (/^[ABE][A-C][0-9][A-D][A-Z][0-9A][A-Z0-9]\d{6}$/.test(vin)) make = 'plymouth';
  if (!make) return null;
  const c = vin[5], cand = c === 'A' ? [1980] : +c >= 4 && +c <= 7 ? [1970 + +c] : +c >= 8 ? [1970 + +c] : null;
  if (!cand) return null;
  const year = cand[0], T = US_TRUCKS[make][year];
  if (!T || !T.m[vin.slice(0, 2)]) return null;
  const rows: Row[] = [['Формат', `${make === 'dodge' ? 'Dodge' : 'Plymouth'}, грузовики 1974–1980 (13 знаков)`, NOTE_STD],
    mk('Модель (1–2-й символы)', T.m, vin.slice(0, 2)), mk('Кузов (3-й символ)', T.b, vin[2]), mk('Полная масса (4-й символ), lb', T.g, vin[3], x => x),
    mk('Двигатель (5-й символ)', T.e, vin[4], ruEng2, TR_NOTE_ENG), ['Модельный год', String(year)], ['Завод (7-й символ)', vin[6], 'таблицы заводов в справочнике нет'], ['Серийный номер', vin.slice(7)]];
  return legacyResult(vin, `${make === 'dodge' ? 'Dodge' : 'Plymouth'} (грузовики)`, [['wmi', 0, 2, 'модель'], ['vds', 2, 3, 'кузов'], ['vds', 3, 4, 'масса'], ['chk', 4, 5, 'двигатель'], ['year', 5, 6, 'год'], ['plant', 6, 7, 'завод'], ['serial', 7, 13, 'серийный номер']], rows);
}

function decodeJeepLegacy(vin: string): LegacyDecode | null {
  let tag = null;
  if (/^J4[A-Z]\d{2}[0-9A-Z][A-Z][A-Z]\d{5}$/.test(vin)) tag = '1974:v5';
  else if (/^J4[A-Z]\d{2}[0-9A-Z][A-Z]\d{6}$/.test(vin)) tag = '1974:v6';
  else if (/^J[5-9][A-Z]\d{2}[A-Z][A-Z]\d{6}$/.test(vin)) tag = String(1970 + +vin[1]);
  else if (/^J0[A-Z]\d{2}[A-Z][A-Z]\d{6}$/.test(vin)) tag = '1980';
  if (!tag) return null;
  const T = US_TRUCKS.jeep[tag];
  if (!T) return null;
  const rows: Row[] = [['Формат', 'Jeep, 13 знаков (1974–1980)', NOTE_STD], ['Модельный год', tag.slice(0, 4)], mk('Завод, коробка, привод (3-й символ)', T.t, vin[2]), mk('Серия (4–5-й символы)', T.s, vin.slice(3, 5))];
  let seq;
  if (tag === '1974:v5') { rows.push(mk('Кузов (6-й символ)', T.b, vin[5]), mk('Полная масса (7-й символ), lb', T.g, vin[6], x => x), mk('Двигатель (8-й символ)', T.e, vin[7], ruEng2, TR_NOTE_ENG)); seq = vin.slice(8); }
  else if (tag === '1974:v6') { rows.push(mk('Кузов (6-й символ)', T.b, vin[5]), mk('Двигатель (7-й символ)', T.e, vin[6], ruEng2, TR_NOTE_ENG)); seq = vin.slice(7); }
  else { rows.push(mk('Полная масса (6-й символ), lb', T.g, vin[5], x => x), mk('Двигатель (7-й символ)', T.e, vin[6], ruEng2, TR_NOTE_ENG)); seq = vin.slice(7); }
  rows.push(['Серийный номер', seq]);
  return legacyResult(vin, 'Jeep', [['wmi', 0, 1, 'производитель'], ['year', 1, 2, 'год'], ['vds', 2, 3, 'коробка/привод'], ['vds', 3, 5, 'серия'], ['chk', 5, vin.length - seq.length, 'кузов/масса/двигатель'], ['serial', vin.length - seq.length, vin.length, 'серийный номер']], rows);
}

// ---- Номера двигателей (Porsche, VW, Mercedes-Benz) и номера шасси Mazda 1979–1980 (пункт 2.2 плана) ----
const ENG_HINT = 'по справочнику Mitchell 1 (американский рынок); это номер двигателя, а не VIN';
const yrs = (a: number, b: number): string => (a === b ? String(a) : `${a}–${b}`);
function ruLitre(s: string): string {
  return s.replace(/\bSix\b/g, '6 цил.').replace(/\bFour\b/g, '4 цил.').replace(/(\d)\.(\d) ?Litre/g, '$1,$2 л').replace(/(\d)\.(\d) ?L\b/g, '$1,$2 л')
    .replace(/\bTurbo[- ]?[Dd]iesel\b/g, 'турбодизель').replace(/\bGas\b/g, 'бензин').replace(/\bDiesel\b/g, 'дизель').replace(/\bRotary\b/g, 'роторный');
}
const PO_CTX: Dict = { 'Std Trans': 'механика', 'Auto Trans': 'автомат', 'w/Calif E.C.S.': 'исполнение для Калифорнии', 'w/o Calif E.C.S.': 'не для Калифорнии' };
function decodePorscheEngine(v: string): LegacyDecode | null {
  if (!/^[0-9A-Z]{7,9}$/.test(v) || !/\d{4}$/.test(v)) return null;
  const fam = PO_ENGINES.filter(([n]) => n.length === v.length && n.slice(0, 3) === v.slice(0, 3) && n <= v);
  if (!fam.length) return null;
  const top = fam.reduce((a, r) => (r[0] > a ? r[0] : a), '');
  const hit = fam.filter(r => r[0] === top);
  const [, y1, y2, , eng] = hit[0];
  const models = [...new Set(hit.map(r => r[3][0]))].join(' / ');
  const extra = [...new Set(hit.flatMap(r => r[3].slice(1)).map(c => PO_CTX[c] || c))];
  const rows: Row[] = [['Формат', 'Porsche, номер двигателя (1973–1999)', ENG_HINT],
    ['Модель', models], ['Модельный год', yrs(y1, y2), `ближайший стартовый номер в справочнике: ${top}`],
    ['Двигатель', ruLitre(eng)]];
  if (extra.length) rows.push(['Исполнение', extra.join(', ')]);
  rows.push(['Номер', v]);
  return legacyResult(v, 'Porsche (номер двигателя)', [['wmi', 0, 3, 'тип двигателя и год'], ['serial', 3, v.length, 'порядковый номер']], rows);
}

function vwPrefixRows(code: string): string[] {
  return (VW_ENGINE_PREFIX[code] || []).map(t => t.replace(/\s+/g, ' ').trim());
}
function decodeVwEngine(v: string): LegacyDecode | null {
  let m = /^(A[EHJK])(\d{6,7})$/.exec(v);
  if (m) {   // Beetle 1973–1980: диапазоны номеров
    const n = +m[2];
    const hit = VW_BEETLE_ENGINES.filter(([a, b]) => a.slice(0, 2) === m![1] && n >= +a.slice(2) && n <= +b.slice(2));
    if (hit.length) return legacyResult(v, 'Volkswagen Beetle (номер двигателя)', [['wmi', 0, 2, 'серия'], ['serial', 2, v.length, 'номер']],
      [['Формат', 'Volkswagen Beetle, номер двигателя 1973–1980', ENG_HINT], ['Модельный год', [...new Set(hit.map(r => r[2]))].join(' или '),
        hit.map(r => `диапазон ${r[0]}–${r[1]}`).join('; ')], ['Мощность', `${hit[0][3]} л.с. (DIN)`], ['Номер', v]]);
  }
  if (/^\d/.test(v) && /^\d+$/.test(v)) return null;
  for (const len of [4, 3, 2]) {
    const code = v.slice(0, len);
    if (!/^\d{5,7}$/.test(v.slice(len))) continue;   // после кода — только цифры порядкового номера
    const late = VW_ENGINE_CODES[code], early = vwPrefixRows(code);
    if (!late && !early.length) continue;
    const items: string[] = [];
    if (late) {
      const by = new Map<string, [number, number]>();
      for (const [a, b, model, eng, fuel] of late) {
        const k = `${model}, ${ruLitre(eng)}, ${ruLitre(fuel)}`;
        const cur = by.get(k);
        by.set(k, cur ? [Math.min(cur[0], a), Math.max(cur[1], b)] : [a, b]);
      }
      for (const [k, [a, b]] of by) items.push(`${k} (${yrs(a, b)})`);
    }
    items.push(...early.map(ruLitre));
    return legacyResult(v, 'Volkswagen (номер двигателя)', [['wmi', 0, len, 'код двигателя'], ['serial', len, v.length, 'номер']],
      [['Формат', 'Volkswagen, номер двигателя: код и порядковый номер', ENG_HINT], ['Код двигателя', code],
       ['Модели и годы', items.join('; '), late ? 'коды 2003–2009 годов: модель, объём, топливо' : 'начальные символы номеров двигателей 1974–2002 годов'],
       ['Номер', v.slice(len)]]);
  }
  return null;
}

function mbEngine(key: string): string | null {
  const hit = MB_ENGINE_TYPES[key];
  if (!hit) return null;
  const by = new Map<string, [number, number]>();
  for (const [a, b, model] of hit) { const c = by.get(model); by.set(model, c ? [Math.min(c[0], a), Math.max(c[1], b)] : [a, b]); }
  return [...by].map(([model, [a, b]]) => `${model} (${yrs(a, b)})`).join('; ') + `; двигатель ${ruLitre(hit[0][3])}`;
}

function decodeMazda7980(v: string): LegacyDecode | null {
  let m = /^SA22C(\d{6})$/.exec(v);
  let name: string, eng: string | null = null, prefix: string, rows: Row[];
  if (m) { name = 'RX7'; prefix = 'SA22C'; }
  else if ((m = /^PE2([MV])([67])(\d{6})$/.exec(v))) {
    name = `B2000 ${m[2]} Ft Bed`; prefix = v.slice(0, 5);
    eng = m[1] === 'M' ? '2000 см³' : '1800 см³';
  } else return null;
  const serial = +v.slice(-6);
  const hit = MAZDA_7980.filter(([n, , , a, b]) => n === name && serial >= a && (b === null || serial <= b));
  rows = [['Формат', 'Mazda, номер шасси 1979–1980', 'до введения 17-значного VIN; ' + ENG_HINT.replace('; это номер двигателя, а не VIN', '')],
    ['Модель', prefix === 'SA22C' ? 'Mazda RX-7 (SA22C)' : `Mazda B-серия, пикап (${v.slice(0, 3)})`]];
  if (eng) rows.push(['Двигатель (4-й знак)', eng, 'по справочнику: M = 2000 см³, V = 1800 см³'], ['Кузов (5-й знак)', v[4] === '6' ? 'короткая платформа (6 футов)' : 'длинная платформа (7 футов)']);
  rows.push(['Модельный год', hit.length ? hit.map(r => r[1]).join(' или ') : 'не определён', hit.length ? `по диапазону серийных номеров: ${hit.map(r => `${r[3]}–${r[4] ?? 'и выше'}`).join('; ')}` : 'номер вне диапазонов 1979–1980 годов'],
    ['Серийный номер', v.slice(-6)]);
  return legacyResult(v, 'Mazda', [['wmi', 0, v.length - 6, 'модель'], ['serial', v.length - 6, v.length, 'серийный номер']], rows);
}

export const MITCHELL: MitchellPack = {
  usLegacy: US_LEGACY,
  hyundaiBody: { 1: 'универсал FWD', 3: 'хэтчбек 3 дв.', 4: 'седан 4 дв.', 5: 'хэтчбек 5 дв.', 6: 'купе', 7: 'универсал AWD', 8: 'универсал' },
  details: { mercedes: mercedesDetails, audi: audiDetails, porsche: porscheDetails, vwYear: vwYearDetails, vwType: vwTypeDetails,
    jaguar: jaguarDetails, saab: saabDetails, colt: coltDetails },
  legacy: { amc: decodeAmcLegacy, colt: decodeColtLegacy, jeep: decodeJeepLegacy, gmTruck: decodeGmTruck, moparTruck: decodeMoparTruck,
    fordTruck: decodeFordTruck, vw: decodeVwLegacy, volvo: decodeVolvoNumber, jaguar: decodeJaguarChassis,
    porscheEngine: decodePorscheEngine, vwEngine: decodeVwEngine, mazda: decodeMazda7980 },
  mbEngine,
  mbType: key => { const mt = MB_TYPES[key]; return mt ? mt.map(([d, y]) => `${ruMb(d)} (${y})`).join('; ') : null; },
  porscheRef: poLookup,
  toyotaRef: code => TOYOTA_CODES[code] || null,
  subaruRef: (code, n) => { const r = SUBARU_RANGES.filter(x => x[1] === code && n >= x[2] && n <= (x[3] ?? x[2] + 80000)); return r.length ? r : null; },
};
