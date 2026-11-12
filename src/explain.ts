import { tr } from './i18n';
import { certConflict, certRows } from './jdm-cert';
import { hasMitchell } from './decode';
import type { NhtsaResult, TraceItem } from './nhtsa';
import type { IsoDecode, JdmDecode, LegacyDecode, PositionExplain, Row, Segment } from './types';

// Правила расшифровки: подписи для подсказок при наведении (title) и данные для вкладки «Правила».

const clip = <T extends string | null | undefined>(t: T, n = 110): T => (t && t.length > n ? t.slice(0, n - 1) + '…' : t) as T;
const GROUP = (p: number): string => (p <= 3 ? 'WMI, код производителя' : p <= 8 ? 'VDS, описательная часть' : p === 9 ? 'контрольная цифра' : p === 10 ? 'модельный год' : p === 11 ? 'завод-сборщик' : 'серийный номер');

const RULE_YEAR_NHTSA = 'Правило NHTSA: у легковых и лёгких грузовиков цифра на 7-й позиции означает 1980–2009, буква — 2010 и позже; год позже «текущий + 2» сдвигается на 30 лет назад.';
const RULE_YEAR_NA = 'Северная Америка: 10-й символ задаёт год с циклом 30 лет; 7-й символ (буква → 2010+, цифра → до 2009) снимает неоднозначность.';
const RULE_YEAR_LOCAL = 'Символ даёт два года с шагом 30 лет (A = 1980 или 2010, … Y = 2000 или 2030, 1–9 = 2001–2009 или 2031–2039). Берётся самый поздний вариант не позднее текущего года + 1.';
const RULE_CHECK = 'ISO 3779 / FMVSS 115: каждый символ заменяется числом (A=1 … Z=9), умножается на вес позиции (8,7,6,5,4,3,2,10,0,9,8,7,6,5,4,3,2), сумма делится на 11; остаток 10 записывается как X.';

// Позиции из подписей таблиц вида «Двигатель (6–7-й символы)»
function labelRange(label: string | undefined): [number, number] | null {
  const m = /\((\d+)(?:\s*[–-]\s*(\d+))?-?й?\s*символ/.exec(label || '');
  return m ? [+m[1], +(m[2] || m[1])] : null;
}

/** То, что explainPositions читает из расшифровки: полный VIN или частичный (у частичного часть полей отсутствует) */
export type ExplainSource = Partial<Omit<IsoDecode, 'partial' | 'jdm' | 'legacy'>>;

// Для 17-значного (и частичного) VIN: что означает каждый символ и по какому правилу
export function explainPositions(vin: string, d: ExplainSource, nh: NhtsaResult | null): PositionExplain[] {
  const out: PositionExplain[] = [];
  for (let i = 0; i < vin.length; i++) {
    const p = i + 1, ch = vin[i];
    const e: PositionExplain = { pos: p, ch, group: GROUP(p), what: '', rule: '', result: [] };
    if (ch === '*') { e.what = 'неизвестный символ'; e.rule = 'в частичном VIN «*» означает любой символ'; out.push(e); continue; }
    if (p === 1) {
      e.what = 'первый символ WMI: регион или страна';
      e.rule = 'таблица диапазонов ISO 3780 по первым двум символам';
      if (d.region) e.result.push(`Регион: ${d.region}`);
      if (d.country) e.result.push(`Страна: ${d.country}`);
    } else if (p === 2) {
      e.what = 'второй символ WMI: производитель; вместе с первым определяет страну';
      e.rule = 'таблица диапазонов ISO 3780 по первым двум символам';
      if (d.country) e.result.push(`Страна: ${d.country}`);
    } else if (p === 3) {
      e.what = 'третий символ WMI: тип ТС или подразделение производителя';
      e.rule = 'три символа WMI целиком ищутся в словарях производителей';
      if (d.maker) e.result.push(`Производитель: ${clip(d.maker, 80)}`);
      if (d.makerSrc) e.result.push(`Источник названия: ${d.makerSrc}`);
      for (const [n, src] of d.makerAlt || []) e.result.push(`Иначе в словаре ${src}: ${clip(n, 80)}`);
      if (ch === '9') e.result.push(`Код 9: мелкосерийный производитель, его код продолжается в позициях 12–14${d.smallMakerCode ? ` («${d.smallMakerCode}»)` : ''}`);
    } else if (p <= 8) {
      e.what = 'описательная часть VDS: модель, кузов, двигатель, коробка';
      e.rule = 'общего стандарта нет: схема своя у каждого производителя, значения берутся из таблиц марки и шаблонов NHTSA';
      // шаблоны NHTSA, которые используют этот символ: сворачиваем по ключу и показываем главные элементы
      const byKey = new Map<string | null, { from: number; items: TraceItem[] }>();
      for (const t of (nh && nh.trace) || []) {
        if (!t.positions.includes(p) || t.value == null) continue;
        let g = byKey.get(t.key);
        if (!g) { g = { from: t.from, items: [] }; byKey.set(t.key, g); }
        g.items.push(t);
      }
      const PRI = [28, 38, 5, 18, 9, 13, 24, 37];
      const rank = (t: TraceItem) => (PRI.indexOf(t.el) < 0 ? 99 : PRI.indexOf(t.el));
      for (const [key, g] of byKey) {
        const items = g.items.slice().sort((a, b) => rank(a) - rank(b));
        const top = items.slice(0, 4).map(t => `${t.label}: ${clip(String(t.value), 36)}`);
        e.result.push(`NHTSA, шаблон ${key} (схема с ${g.from} г.): ${top.join('; ')}${items.length > 4 ? `; ещё ${items.length - 4}` : ''}`);
      }
      for (const r of d.brandDetails || []) { const rg = labelRange(r[0]); if (rg && p >= rg[0] && p <= rg[1]) e.result.push(`${d.brandSource || 'таблица марки'}: ${r[0].replace(/\s*\(.*$/, '')} = ${clip(r[1], 70)}`); }
      if (!e.result.length) e.result.push('в таблицах правил для этого символа ничего не нашлось');
    } else if (p === 9) {
      e.what = d.noCheck ? 'код модели (у этой марки это не контрольная цифра)' : 'контрольная цифра';
      e.rule = d.noCheck ? 'у этой марки 9-й символ используется иначе, контрольную цифру не проверяют' : RULE_CHECK;
      if (d.check && !d.noCheck) {
        e.result.push(`В VIN: ${d.check.actual}; по расчёту: ${d.check.expected}`);
        e.result.push(d.check.ok ? 'Совпало' : d.checkException ? 'Не совпало, но номер есть в списке исключений NHTSA' : 'Не совпало (вне США это не всегда ошибка)');
      }
    } else if (p === 10) {
      e.what = 'модельный год';
      e.rule = d.year && d.year.src === 'NHTSA' ? RULE_YEAR_NHTSA : /^[1-5]/.test(vin) ? RULE_YEAR_NA : RULE_YEAR_LOCAL;
      if (d.year) { e.result.push(`Выбран год: ${d.year.value}`); if (d.year.alt) e.result.push(`Альтернатива через 30 лет: ${d.year.alt}`); }
      if (nh && nh.yearInfo && nh.yearInfo.candidates && nh.yearInfo.candidates.length > 1) e.result.push(`Кандидаты NHTSA: ${nh.yearInfo.candidates.join(', ')}`);
      if (nh && nh.yearInfo && nh.yearInfo.descriptor) e.result.push('Год задан списком известных номеров NHTSA');
    } else if (p === 11) {
      e.what = 'завод-сборщик';
      e.rule = hasMitchell() ? 'коды заводов у каждого производителя свои: таблицы Wikibooks, Mitchell 1 и база NHTSA' : 'коды заводов у каждого производителя свои: таблицы Wikibooks и база NHTSA';
      if (d.plantWb) e.result.push(`Wikibooks: ${clip(d.plantWb.text, 80)}`);
      else if (d.plantInfo && d.plantInfo.name) e.result.push(`Справочник: ${d.plantInfo.name}`);
      if (nh && (nh.plantCity || nh.plantCountry)) e.result.push(`NHTSA: ${[nh.plantCity, nh.plantState, nh.plantCountry].filter(Boolean).join(', ')}`);
      if (!e.result.length) e.result.push('для этого кода завода таблиц нет');
    } else {
      e.what = 'серийный номер: порядковый номер машины на заводе';
      e.rule = 'у легковых и лёгких грузовиков 13–17-й символы цифры; сам номер ничего не кодирует';
      if (vin[2] === '9' && p <= 14) e.result.push('У мелкосерийных производителей позиции 12–14 продолжают WMI');
    }
    out.push(e);
  }
  return out;
}

export function positionTitles(positions: PositionExplain[]): string[] {
  return positions.map(x => [`Позиция ${x.pos} · ${x.group}`, `Символ «${x.ch}»: ${x.what}`, `Правило: ${x.rule}`, ...x.result].join('\n'));
}

// Для старых форматов, JDM и других номеров с готовой разбивкой на сегменты
export function explainSegments(vin: string, segments: Segment[], rows: Row[] | null, format: string | null): string[] {
  const titles: string[] = [];
  for (let i = 0; i < vin.length; i++) {
    const s = segments.find(x => i >= x[1] && i < x[2]);
    if (!s) { titles.push(''); continue; }
    const label = s[3] || 'разделитель';
    const tok = label.toLowerCase().split(/[ ,]/)[0];
    const r = (rows || []).find(x => x[0] && tok && x[0].toLowerCase().includes(tok));
    const span = s[2] - s[1] === 1 ? `символ ${s[2]}` : `символы ${s[1] + 1}–${s[2]}`;
    const tl = tr(label);
    const lines = [`${tl[0].toUpperCase() + tl.slice(1)} · ${span}: «${vin.slice(s[1], s[2])}»`];
    if (format) lines.push(`Формат: ${format}`);
    if (r) { lines.push(`Значение: ${clip(String(r[1]), 120)}`); if (r[2]) lines.push(`Основание: ${clip(r[2], 120)}`); }
    titles.push(lines.join('\n'));
  }
  return titles;
}

// Строки-правила для JDM-номера
export function jdmRules(d: JdmDecode): Row[] {
  const rows: Row[] = [['Формат', 'японский номер кузова: [префикс сертификации-]код модели-серийный номер', 'не VIN; ISO 3779 к нему не применяется']];
  if (d.cert) {
    rows.push(['Префикс сертификации', d.cert, d.certInfo ? 'код норм выбросов: по нему виден период выпуска, топливо и тип машины' : 'тип сертификации выбросов; такого кода в таблицах МЛИТ нет']);
    if (d.certInfo) rows.push(...certRows(d.cert, d.certInfo));
  }
  rows.push(['Код модели', d.code, d.wiki ? `по японской Википедии: ${d.wiki.map(w => w.model.startsWith(w.brand) ? w.model : `${w.brand} ${w.model}`).filter((x, i, a) => a.indexOf(x) === i).join('; ')}`
    : d.match ? `по таблице: ${d.match.brand} ${d.match.model}` : (d.toyotaRef || d.subaruRef) ? 'найден в справочнике Mitchell 1' : 'в таблицах не найден']);
  if (d.toyota) rows.push(['Структура кода Toyota', d.toyota, 'формула: буквы кода = код двигателя + код платформы']);
  const conflict = certConflict(d.certInfo, d.toyota);
  if (conflict) rows.push(conflict);
  rows.push(['Номер кузова', d.serial, d.serial.length === 7 ? 'семь цифр: так обычно у Toyota' : d.serial.length === 6 ? 'шесть цифр: так обычно у Nissan' : null]);
  return rows;
}

export type SourceKind = 'iso' | 'jdm' | 'legacy';
/** Поля расшифровки, по которым перечисляются источники */
export type SourcesInput = ExplainSource & Partial<Pick<LegacyDecode, 'format'>>;
// Откуда взяты данные в этой расшифровке
export function sourcesOf(d: SourcesInput, nh: NhtsaResult | null | undefined, kind: SourceKind | string): string[] {
  const out: string[] = [];
  if (kind === 'iso') {
    out.push('Страна и регион: таблица диапазонов ISO 3780 (по данным vininfo)');
    out.push(`Производитель: ${d.makerSrc || 'в словарях не найден'}`);
    if (d.brandDetails) out.push(`Детали по марке: ${d.brandSource}`);
    out.push(d.plantWb ? 'Завод: таблицы Wikibooks' : d.plantInfo && d.plantInfo.name ? 'Завод: справочник по памяти, возможны неточности' : 'Завод: таблицы нет');
    out.push('Контрольная цифра: локальный расчёт по ISO 3779');
    out.push(d.year && d.year.src === 'NHTSA' ? 'Год: правило NHTSA' : 'Год: локальный расчёт (цикл 30 лет)');
    out.push(nh ? 'NHTSA vPIC: офлайн-копия базы выпуска 2026-10, алгоритм сопоставления spVinDecode' : 'NHTSA vPIC: кода производителя нет в базе (машины не продавались в США)');
  } else {
    out.push(`Формат: ${d.format || 'номер кузова JDM'}`);
    if (kind === 'jdm') out.push('Модель по коду кузова: японская Википедия (карточки моделей), иначе таблица по памяти');
    out.push(hasMitchell() ? 'Правила и таблицы: справочники Mitchell 1, MoTales, MB Spares, 911UK, Wikibooks, tpocr.com и собственные таблицы (см. NOTICE.txt)' : 'Правила и таблицы: справочники MoTales, MB Spares, 911UK, Wikibooks, tpocr.com и собственные таблицы (см. NOTICE.txt)');
  }
  return out;
}
