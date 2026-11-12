import './popup.css';
import { decodeLocal, isIso, normalize, useMitchell } from './decode';
import { MITCHELL } from './mitchell';
import { nhtsaDecode, isCheckException, generateVin, elementLabel, type ExtraItem, type GeneratedVin, type NhSource, type NhtsaResult } from './nhtsa';
import { NH_GROUPS } from './data/nhtsa-elements';
import { tr, setLang, getLang } from './i18n';
import { findCarImage, silhouetteUrl } from './carimage';
import { certConflict, certRows } from './jdm-cert';
import { newRound, evaluate, explainHidden, cellHint, MAX_ATTEMPTS, VIN_CHARS, type Round } from './game';
import { extApi, isSidebarView, sidebarOpener } from './sidebar';
import { explainPositions, positionTitles, explainSegments, jdmRules, sourcesOf, type ExplainSource } from './explain';
import type { IsoDecode, JdmDecode, LegacyDecode, LocalDecode, PartialDecode, PositionExplain, Row, Segment } from './types';

// Справочник Mitchell 1 — отдельный пакет: подключается, только если сборка сделана с VIN_MITCHELL=1 (см. README).
// При __MITCHELL__ = false ветка выкидывается при сборке, а вместе с ней и неиспользуемый модуль ./mitchell.
if (__MITCHELL__) useMitchell(MITCHELL);

declare global {
  // eslint-disable-next-line no-var
  var __VIN_TEST__: unknown;
  // eslint-disable-next-line no-var
  var __vinGame: unknown;
}

function need<T extends HTMLElement = HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`В popup.html нет элемента #${id}`);
  return e as T;
}
const form = need<HTMLFormElement>('form');
const input = need<HTMLInputElement>('vin');
const out = need('out');
type TabName = 'decode' | 'recalls' | 'rules' | 'gen' | 'game';
const panels: Record<TabName, HTMLElement> = { decode: out, recalls: need('tab-recalls'), rules: need('tab-rules'), gen: need('tab-gen'), game: need('tab-game') };

{
  let lg: string | null = null;
  try { lg = localStorage.getItem('lang'); } catch { /* нет хранилища */ }
  if (!lg) lg = /^(ru|uk|be)/i.test((typeof navigator !== 'undefined' && navigator.language) || '') ? 'ru' : 'en';
  setLang(lg);
}
let runId = 0;

/** Результат последней расшифровки для вкладок «Правила» и «Отзывы» */
type Current =
  | { kind: 'iso'; vin: string; d: IsoDecode | PartialDecode; nh: NhtsaResult | null; positions: PositionExplain[] }
  | { kind: 'jdm'; vin: string; d: JdmDecode; rows: Row[] }
  | { kind: 'legacy'; vin: string; d: LegacyDecode; rows: Row[] };
let current: Current | null = null;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string | null, text?: string | null): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = tr(text);
  return e;
}
const tx = (t: string): Text => document.createTextNode(tr(t));

const SEGMENTS: Segment[] = [
  ['wmi', 0, 3, 'производитель'], ['vds', 3, 8, 'модель и двигатель (у каждой марки по-своему)'],
  ['chk', 8, 9, 'контрольная цифра'], ['year', 9, 10, 'модельный год'],
  ['plant', 10, 11, 'завод'], ['serial', 11, 17, 'серийный номер'],
];

function renderVin(vin: string, local: LocalDecode, segments: Segment[] = SEGMENTS, titles: string[] | null = null): [HTMLDivElement, HTMLUListElement] {
  const wrap = el('div', 'vin');
  wrap.style.setProperty('--n', String(vin.length));
  [...vin].forEach((ch, i) => {
    const seg = segments.find(s => i >= s[1] && i < s[2])![0];
    const c = el('span', seg + (seg === 'chk' && local.check && !local.check.ok ? ' bad' : ''), ch);
    if (titles && titles[i]) c.title = tr(titles[i]);
    wrap.append(c);
  });
  const legend = el('ul', 'legend');
  const seen = new Set<string>();
  segments.forEach(([cls, , , label]) => {
    if (!label || seen.has(label)) return; seen.add(label);
    const li = el('li', null, label);
    li.style.setProperty('--c', `var(--${cls})`);
    legend.append(li);
  });
  return [wrap, legend];
}

function row(k: string, v: string, hint?: string | null, cls?: string | null): HTMLDivElement {
  const r = el('div', 'row');
  r.append(el('dt', null, k));
  const dd = el('dd', cls || null, v);
  if (hint) dd.append(el('span', 'hint', hint));
  r.append(dd);
  return r;
}

// «Nissan Skyline GT-R, поколение 5»: название статьи английской Википедии обычно уже начинается с марки
export function jdmModelText(w: { brand: string; model: string; gen: number }): string {
  // японское название (у статьи нет английской версии) — в скобках после марки
  const name = /[\u3040-\u30ff\u4e00-\u9fff]/.test(w.model) ? `${w.brand} (${w.model})` : w.model.startsWith(w.brand) ? w.model : `${w.brand} ${w.model}`;
  return w.gen ? `${name}, поколение ${w.gen}` : name;
}
function jdmSection(d: JdmDecode): HTMLElement {
  const s = el('section');
  s.append(el('h2', null, 'Номер кузова JDM'));
  const dl = el('dl');
  dl.append(row('Формат', 'не VIN, а японский номер кузова', 'машины для внутреннего рынка Японии не имеют 17-значного VIN'));
  if (d.cert) {
    dl.append(row('Тип сертификации', d.cert, d.certInfo ? 'префикс перед кодом модели: код норм выбросов, по нему виден период выпуска' : 'префикс перед кодом модели; такого кода в таблицах МЛИТ нет'));
    if (d.certInfo) certRows(d.cert, d.certInfo).forEach(([k, v, h]) => dl.append(row(k, v, h)));
  }
  dl.append(row('Код модели', d.code));
  const hasRef = d.toyotaRef || d.subaruRef;
  if (d.wiki) d.wiki.slice(0, 6).forEach(w => dl.append(row('Модель', jdmModelText(w),
    `${w.years ? `годы продаж: ${w.years}; ` : ''}по японской Википедии, статья «${w.article}»`)));
  else dl.append(row('Модель', d.match ? `${d.match.brand} ${d.match.model}` : hasRef ? 'см. справочник Mitchell 1 ниже' : 'нет в справочнике',
    d.match ? `годы выпуска поколения: ${d.match.years}. Справочник составлен по памяти, возможны неточности` : hasRef ? null : 'проверьте код в каталоге по вашей марке'));
  if (d.toyotaRef) d.toyotaRef.forEach(([g, b, e, y]) => dl.append(row('Справочник Mitchell 1 (США)', `${g}: ${b}, ${e}, ${y}`,
    'модельный код по американскому справочнику 1973–1995; у японской версии комплектация и двигатель могут отличаться')));
  if (d.subaruRef) d.subaruRef.slice(0, 6).forEach(r => dl.append(row('Диапазон номера Subaru', `${r[4]} (${r[0]})`,
    `диапазон ${r[1]}-${r[2]} … ${r[3] ?? 'и выше'}; сокращения: DL/GL/GF/FE — комплектации, Brat — пикап`)));
  if (d.toyota) dl.append(row('Структура кода', d.toyota, 'по формуле для Toyota/Lexus (Wikipedia). Если машина другой марки, игнорируйте'));
  const conflict = certConflict(d.certInfo, d.toyota);
  if (conflict) dl.append(row(conflict[0], conflict[1], conflict[2], 'no'));
  dl.append(row('Номер кузова', d.serial, d.serial.length === 7 ? 'семь цифр: так обычно у Toyota' : d.serial.length === 6 ? 'шесть цифр: так обычно у Nissan' : null));
  s.append(dl);
  s.append(el('p', 'note', 'Комплектация, цвет и салон в номере не закодированы: их показывает табличка на кузове. Сетевые базы 17-значных VIN такие номера не знают, поэтому запрос в сеть не делаю.'));
  return s;
}

function legacySection(d: LegacyDecode): HTMLElement {
  const s = el('section');
  s.append(el('h2', null, 'Старый VIN (до 1981)'));
  const dl = el('dl');
  d.rows.forEach(([k, v, hint]) => dl.append(row(k, v, hint)));
  s.append(dl);
  s.append(el('p', 'note', 'NHTSA и другие базы 17-значных VIN такие номера не расшифровывают, поэтому запрос в сеть не делаю. Формат определён по структуре номера, это предположение. Справочник неполный: чего нет в таблице, показано кодом.'));
  return s;
}

function brandSection(d: IsoDecode & { brandDetails: Row[] }): HTMLElement {
  const s = el('section');
  const h = el('h2', null, 'Детали по марке ');
  h.append(el('small', null, `(таблицы ${d.brandSource})`));
  s.append(h);
  const dl = el('dl');
  d.brandDetails.forEach(([k, v, hint]) => dl.append(row(k, v, hint)));
  s.append(dl);
  s.append(el('p', 'note', 'Коды для этой марки читаются по таблицам открытого проекта (источник указан в заголовке). Таблицы неполные: часть кодов может быть не расшифрована.'));
  return s;
}

function localSection(d: IsoDecode): HTMLElement {
  const s = el('section');
  const h = el('h2', null, 'По символам VIN ');
  s.append(h, el('small'));
  h.append(el('small', null, '(офлайн)'));
  const dl = el('dl');
  dl.append(row('Страна', d.country ? `${d.country}` : 'не определена', d.region));
  dl.append(row('Производитель', d.maker || 'нет в локальной таблице', `WMI: ${d.wmi}` +
    (d.smallMaker ? `, мелкосерийный (код продолжается: ${d.smallMakerCode})` : '') +
    (d.makerAlt && d.makerAlt.length ? `. Словари расходятся: ${d.makerAlt.map(([n, src]) => `${src} — ${n}`).join('; ')}` : '')));
  if (d.year) {
    dl.append(row('Модельный год', String(d.year.value),
      d.year.src ? `по правилам NHTSA для североамериканских кодов${d.localYear && d.localYear !== d.year.value ? `; прежний локальный расчёт давал ${d.localYear}` : ''}`
        : d.year.alt ? `или ${d.year.alt}: символ года повторяется раз в 30 лет` : 'это модельный год, он может отличаться от года выпуска'));
  }
  const c = d.check;
  if (d.noCheck) dl.append(row('Контрольная цифра', 'не применяется', 'у этой марки 9-й символ означает код модели, а не контрольную цифру'));
  else dl.append(row('Контрольная цифра', c.ok ? `верна (${c.actual})` : `не совпала: в VIN ${c.actual}, расчёт даёт ${c.expected}`,
    c.ok ? null : d.checkException ? 'NHTSA знает это исключение: производитель ошибся в контрольной цифре при выпуске, VIN при этом настоящий.'
      : 'Обязательна только для США/Канады/Китая. Для остальных регионов несовпадение не значит, что VIN поддельный.',
    c.ok || d.checkException ? 'ok' : 'no'));
  const pi = d.plantInfo;
  if (d.plantWb) dl.append(row('Завод (символ 11)', `${d.plantWb.text} (${d.plant})`,
    'по таблицам Wikibooks (название на английском); значение кода зависит от года, модели и страны сборки'));
  else dl.append(row('Завод (символ 11)', pi.name ? `${pi.name} (${d.plant})` : d.plant,
    pi.name ? 'по справочнику, возможны неточности: проверьте по данным NHTSA ниже или по документам'
      : pi.known ? `для ${pi.maker} этого кода нет в справочнике`
      : 'для этой марки таблицы заводов пока нет: коды у каждой марки свои'));
  dl.append(row('Серийный номер', d.serial));
  s.append(dl);
  return s;
}

const meaningful = (v: unknown): boolean => !!v && !!String(v).trim() && !/^not applicable$/i.test(String(v).trim());

async function getJson<T>(url: string, ms = 8000): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json() as T;
  } finally { clearTimeout(t); }
}

// Раздел NHTSA: данные берутся из локальной копии базы vPIC (папка nhtsa/), сеть не нужна
function nhtsaSection(nh: NhtsaResult | null, d: ExplainSource | null): HTMLElement {
  const s = el('section');
  const h = el('h2', null, 'NHTSA vPIC ');
  h.append(el('small', null, '(офлайн, база выпуска 2026-10)'));
  s.append(h);
  if (!nh) {
    s.append(el('p', 'note', 'Этого кода производителя нет в базе NHTSA: такие машины не сертифицировались для США. Для европейских и азиатских VIN это нормально.'));
    return s;
  }
  const dl = el('dl');
  const add = (k: string, v: unknown, hint?: string | null) => { if (meaningful(v)) dl.append(row(k, String(v), hint)); };
  add('Марка', nh.make); add('Модель', nh.model);
  if (nh.year) add('Модельный год', nh.year, nh.ambiguous ? 'год неоднозначен (символ года повторяется), выбран вариант с большим числом совпавших шаблонов'
    : d && d.localYear && d.localYear !== nh.year
      ? (d.vin && !/^[1-5]/.test(d.vin)
        ? `по правилу NHTSA: цифра на 7-й позиции означает год до 2010. Это правило для номеров Северной Америки; у этого номера вернее локальный расчёт — ${d.localYear}, и шаблоны NHTSA могли подобраться не к тому году`
        : `по правилам NHTSA; локальный расчёт дал ${d.localYear}`)
      : null);
  add('Комплектация (Trim)', nh.trim); add('Серия', nh.series); add('Кузов', nh.body); add('Двери', nh.doors); add('Привод', nh.drive);
  const eng = [nh.cyl && `${nh.cyl} цил.`, nh.dispL && `${nh.dispL} л`, nh.hp && `${nh.hp} л.с.`, nh.engCfg, nh.turbo && /turbo/i.test(nh.turbo) ? 'турбо' : null].filter(Boolean).join(', ');
  add('Двигатель', eng, nh.engModel ? `модель двигателя: ${nh.engModel}` : null);
  add('Топливо', [nh.fuel, nh.fuel2].filter(Boolean).join(' / ')); add('Тип электрификации', nh.elec); add('Система питания', nh.fuelInj); add('Газораспределение', nh.valve);
  add('КПП', nh.trans, nh.speeds ? `передач: ${nh.speeds}` : null); add('Полная масса (класс)', nh.gvwr);
  add('Завод', [nh.plantCity, nh.plantState, nh.plantCountry].filter(Boolean).join(', '), nh.plantCompany ? `компания: ${nh.plantCompany}` : null);
  add('Производитель (WMI)', nh.mfr, d && d.maker && nh.mfr && !nh.mfr.toLowerCase().includes(String(d.maker).toLowerCase().split(' ')[0]) ? `локальная таблица называет: ${d.maker}` : null);
  add('Тип ТС', nh.vtype); add('Страна по WMI', nh.wmiCountry); add('Рынок назначения', nh.dest);
  if (dl.children.length) s.append(dl);
  // основные поля, взятые не из символов VIN: Vehicle Specs (по модели и году), формула или значение по умолчанию
  const bySrc = (src: NhSource) => (nh.filled || []).filter(f => f.src === src).map(f => elementLabel(f.el));
  const fromSpec = bySrc('spec'), fromDefault = bySrc('default');
  if (fromSpec.length) s.append(el('p', 'note', `Не по символам VIN, а по данным Vehicle Specs для модели и года: ${fromSpec.join(', ')}.`));
  if (fromDefault.length) s.append(el('p', 'note', `Значение по умолчанию для этого типа ТС: ${fromDefault.join(', ')}.`));
  if (nh.extra && nh.extra.length) s.append(extraBlock(nh.extra));
  if (!nh.matched && !(nh.extra && nh.extra.length)) s.append(el('p', 'note', 'Для этого сочетания VDS и года шаблонов в базе нет: показаны только данные по коду производителя.'));
  if (nh.make && nh.model && nh.year) {
    const btn = el('button', 'link', 'Отзывные кампании для этой модели →');
    btn.type = 'button';
    btn.addEventListener('click', () => setTab('recalls'));
    s.append(btn);
  }
  return s;
}

// Откуда взято значение дополнительного элемента
function extraHint(x: ExtraItem): string | null {
  const pos = x.positions.length ? x.positions.join(', ') : '';
  switch (x.src) {
    case 'spec': return 'Vehicle Specs: по модели и году, не по символам VIN';
    case 'formula': return `число записано прямо в VIN, позиции ${pos}`;
    case 'engine': return 'по модели двигателя';
    case 'default': return 'значение по умолчанию для этого типа ТС';
    default: return pos ? `позиции VIN: ${pos}` : null;
  }
}
// Дополнительные элементы vPIC (оснащение, размеры, прицеп, автобус, мотоцикл, батарея) по группам; блок свёрнут
function extraBlock(extra: ExtraItem[]): HTMLDetailsElement {
  const box = el('details', 'nh-extra');
  const sm = el('summary', null, 'Оснащение и характеристики');
  sm.append(el('small', null, ` · ${extra.length}`));
  box.append(sm);
  const titles = new Map(NH_GROUPS.map(([g, ru]) => [g, ru]));
  let group: string | null = null, dl: HTMLDListElement | null = null;
  for (const x of extra) {
    if (x.group !== group || !dl) {
      group = x.group;
      box.append(el('h3', null, titles.get(group) || group || 'Прочее'));
      dl = el('dl'); box.append(dl);
    }
    dl.append(row(x.label, x.value, extraHint(x)));
  }
  return box;
}

function partialSection(d: PartialDecode): HTMLElement {
  const s = el('section');
  s.append(el('h2', null, 'Частичный VIN'));
  const dl = el('dl');
  dl.append(row('Формат', `${d.vin.length} из 17 символов`, 'неизвестные позиции можно заменить на «*»'));
  if (d.wmi) {
    dl.append(row('Страна', d.country || 'не определена', d.region));
    dl.append(row('Производитель', d.maker || 'нет в локальной таблице', `WMI: ${d.wmi}`));
  }
  if (d.year) dl.append(row('Модельный год', String(d.year.value), d.year.alt ? `или ${d.year.alt}` : null));
  s.append(dl);
  s.append(el('p', 'note', 'Контрольную цифру, завод и серийный номер по неполному VIN не проверить. NHTSA умеет разбирать частичные номера, запрос ниже.'));
  return s;
}


// ---------- фото модели ----------
const photosOn = (): boolean => { try { return localStorage.getItem('photos') !== 'off'; } catch { return true; } };
const photosBox = document.getElementById('photos') as HTMLInputElement | null;
if (photosBox) {
  photosBox.checked = photosOn();
  photosBox.addEventListener('change', () => { try { localStorage.setItem('photos', photosBox.checked ? 'on' : 'off'); } catch { /* хранилище недоступно */ } });
}
function link(text: string, href: string): HTMLAnchorElement { const a = el('a', null, text); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a; }

/** Машина для фото: марка, модель, год и (необязательно) кузов для силуэта */
interface CarRef { make?: string | null; model?: string | null; year?: number | null; body?: string | null }
// марка и модель для фото, если базы NHTSA нет: только там, где модель определена однозначно (таблицы vininfo)
function localCar(d: IsoDecode): CarRef | null {
  if (d.brandSource !== 'vininfo' || !d.brandDetails) return null;
  const r = d.brandDetails.find(x => x[0] === 'Модель');
  if (!r) return null;
  const maker = String(d.maker || '');
  const make = d.brandKey === 'lada' ? 'Lada' : /Dacia/i.test(maker) ? 'Dacia' : /Infiniti/i.test(maker) ? 'Infiniti' : /Vauxhall/i.test(maker) ? 'Vauxhall'
    : ({ renault: 'Renault', nissan: 'Nissan', opel: 'Opel' } as Record<string, string>)[d.brandKey || ''];
  const model = String(r[1]).split(/ \/ | \(/)[0].trim();
  return make && model ? { make, model, year: d.year && d.year.value } : null;
}
function photoBox(nh: CarRef | null): HTMLElement | null {
  if ((photosBox ? !photosBox.checked : !photosOn()) || !nh || !nh.make || !nh.model) return null;
  const name = [nh.year, nh.make, nh.model].filter(Boolean).join(' ');
  const box = el('figure', 'car-photo');
  const img = el('img', 'sil'); img.alt = name; img.src = silhouetteUrl(nh.body);
  const cap = el('figcaption', null, 'Ищу фото модели…');
  box.append(img, cap);
  findCarImage({ make: nh.make, model: nh.model, year: nh.year }).then(r => {
    if (!r) { cap.textContent = tr('Фото в Wikipedia не найдено или недоступно: показан силуэт по типу кузова.'); return; }
    img.className = ''; img.src = r.src; img.alt = name;
    const parts: Node[] = [tx(`Фото: ${r.author} · `), r.licenseUrl ? link(r.license, r.licenseUrl) : tx(r.license),
      tx(' · '), link('Wikimedia Commons', r.filePage)];
    if (r.article) parts.push(tx(' · '), link('статья', r.article));
    parts.push(tx(r.scope === 'generation' ? ' · поколение определено по году' : ' · фото модели в целом, поколение не определено'));
    cap.replaceChildren(...parts);
  }).catch(() => { cap.textContent = tr('Фото недоступно.'); });
  return box;
}

async function run(manual = false): Promise<void> {
  const id = ++runId;
  const raw = input.value.toUpperCase().replace(/\s/g, '');
  const d = decodeLocal(raw);
  const vin = d.vin || normalize(raw);
  input.value = vin;
  out.replaceChildren();
  current = null;
  setTab('decode');
  if (!vin) { out.append(el('p', 'empty', 'Вставьте VIN или номер кузова, чтобы увидеть расшифровку.')); return; }
  if (d.partial) {
    if (!manual) return;
    let nhp: NhtsaResult | null = null;
    try { nhp = await nhtsaDecode(vin.padEnd(17, '*')); } catch { /* база недоступна */ }
    if (id !== runId) return;
    const positions = explainPositions(vin, d, nhp);
    out.append(...renderVin(vin, d, [['wmi', 0, 3, 'производитель'], ['vds', 3, 17, 'остальные позиции']], positionTitles(positions)), partialSection(d), nhtsaSection(nhp, d));
    current = { kind: 'iso', vin, d, nh: nhp, positions };
    return;
  }
  if (d.errors.length) {
    d.errors.forEach(m => out.append(el('p', 'error', m)));
    return;
  }
  if (d.jdm) {
    const segs: Segment[] = []; let p = 0;
    if (d.cert) { segs.push(['chk', 0, d.cert.length, 'тип сертификации'], ['vds', d.cert.length, d.cert.length + 1, '']); p = d.cert.length + 1; }
    segs.push(['wmi', p, p + d.code.length, 'код модели'], ['vds', p + d.code.length, p + d.code.length + 1, ''],
      ['serial', p + d.code.length + 1, vin.length, 'номер кузова']);
    const rows = jdmRules(d);
    out.append(...renderVin(vin, d, segs, explainSegments(vin, segs, rows, 'номер кузова JDM')), jdmSection(d));
    current = { kind: 'jdm', vin, d, rows };
    return;
  }
  if (d.legacy) {
    out.append(...renderVin(d.vin, d, d.segments, explainSegments(d.vin, d.segments, d.rows, d.format)), legacySection(d));
    current = { kind: 'legacy', vin: d.vin, d, rows: d.rows };
    return;
  }
  if (!isIso(d)) return;   // сюда не попадаем: без ошибок остаётся только полная ISO-расшифровка
  let nh: NhtsaResult | null = null;
  try { nh = await nhtsaDecode(vin); } catch { /* база недоступна: останется локальная расшифровка */ }
  if (id !== runId) return;
  // для североамериканских кодов год по правилам NHTSA надёжнее локального расчёта
  d.localYear = d.year ? d.year.value : null;
  if (d.check && !d.check.ok) { try { d.checkException = await isCheckException(vin); } catch { /* список недоступен */ } }
  if (nh && nh.year && /^[1-5]/.test(vin)) d.year = { value: nh.year, alt: null, src: 'NHTSA' };
  const positions = explainPositions(vin, d, nh);
  const photo = photoBox(nh || localCar(d));
  out.append(...renderVin(vin, d, SEGMENTS, positionTitles(positions)), ...(photo ? [photo] : []), localSection(d));
  if (d.brandDetails) out.append(brandSection(d as IsoDecode & { brandDetails: Row[] }));
  out.append(nhtsaSection(nh, d));
  current = { kind: 'iso', vin, d, nh, positions };
}

// ---------- вкладки ----------
let currentTab: TabName = 'decode';
const isTab = (s: string | undefined): s is TabName => !!s && s in panels;
function setTab(name: TabName): void {
  currentTab = name;
  for (const b of document.querySelectorAll<HTMLElement>('.tab')) b.setAttribute('aria-selected', String(b.dataset.tab === name));
  for (const [k, p] of Object.entries(panels)) if (p) p.hidden = k !== name;
  if (name === 'rules') renderRules();
  if (name === 'recalls') openRecalls();
  if (name === 'gen') openGen();
  if (name === 'game') openGame();
}
for (const b of document.querySelectorAll<HTMLElement>('.tab')) b.addEventListener('click', () => { if (isTab(b.dataset.tab)) setTab(b.dataset.tab); });

// ---------- вкладка «Правила» ----------
function renderRules(): void {
  const box = panels.rules;
  box.replaceChildren(); box.className = 'panel rules';
  if (!current) { box.append(el('p', 'empty', 'Сначала расшифруйте номер на вкладке «Расшифровка»: здесь появятся правила, по которым это сделано.')); return; }
  const c = current, d = c.d;
  box.append(el('h2', null, 'Формат номера'));
  box.append(el('p', 'note', c.kind === 'iso'
    ? 'Стандарт ISO 3779: 17 символов. Символы 1–3 — код производителя (WMI), 4–8 — описательная часть (VDS), 9 — контрольная цифра, 10 — модельный год, 11 — завод, 12–17 — серийный номер. Буквы I, O и Q не используются.'
    : `${(c.kind === 'legacy' && c.d.format) || 'Номер кузова JDM'}. До 1981 года единого стандарта не было: у каждой фирмы своя схема, поэтому правила привязаны к формату.`));
  if (c.kind === 'iso') {
    box.append(el('h2', null, 'Правила по символам'));
    const t = el('table', 'rules-table');
    const hd = el('tr'); ['№', 'Символ', 'Что означает и по какому правилу'].forEach(x => hd.append(el('th', null, x))); t.append(hd);
    c.positions.forEach(x => {
      const trow = el('tr');
      trow.append(el('td', null, String(x.pos)), el('td', 'mono', x.ch));
      const td = el('td'); const w = tr(x.what); td.append(document.createTextNode(w[0].toUpperCase() + w.slice(1)));
      td.append(el('span', 'sub', `Группа: ${x.group}`), el('span', 'sub', `Правило: ${x.rule}`));
      x.result.forEach(r => td.append(el('span', 'sub', r)));
      trow.append(td); t.append(trow);
    });
    box.append(t);
    if (c.nh && c.nh.trace && c.nh.trace.some(x => x.key)) {
      box.append(el('h2', null, 'Шаблоны NHTSA'));
      box.append(el('p', 'note', 'Ключ шаблона описывает символы 4–8, затем «|» и символы 10–17: «*» — любой символ, в скобках — допустимые. Из подходящих шаблонов для каждого элемента выбирается самый приоритетный: сначала схема с более поздним годом.'));
      const t2 = el('table', 'rules-table');
      const h2 = el('tr'); ['Элемент', 'Значение', 'Шаблон', 'Позиции'].forEach(x => h2.append(el('th', null, x))); t2.append(h2);
      c.nh.trace.filter(x => x.key && x.value != null).forEach(x => {
        const trow = el('tr'); trow.append(el('td', null, x.label), el('td', null, String(x.value)), el('td', 'mono', x.key), el('td', null, `${x.positions.join(', ')}\nсхема с ${x.from} г.`));
        t2.append(trow);
      });
      box.append(t2);
      const yi = c.nh.yearInfo;
      if (yi && yi.candidates) box.append(el('p', 'note', `Год: ${yi.descriptor ? 'задан списком известных номеров' : `кандидаты ${yi.candidates.filter(Boolean).join(' и ') || 'не определены'}`}; для расшифровки взят ${c.nh.year ?? 'без года'}. Совпало шаблонов: ${c.nh.matched}.`));
    }
  } else {
    box.append(el('h2', null, 'Поля формата'));
    const t = el('table', 'rules-table');
    const hd = el('tr'); ['Поле', 'Значение', 'Основание'].forEach(x => hd.append(el('th', null, x))); t.append(hd);
    c.rows.forEach(([k, v, h]) => { const trow = el('tr'); trow.append(el('td', null, k), el('td', null, String(v)), el('td', null, h || '')); t.append(trow); });
    box.append(t);
  }
  box.append(el('h2', null, 'Источники данных'));
  const ul = el('ul', 'sources'); sourcesOf(d, c.kind === 'iso' ? c.nh : undefined, c.kind).forEach(x => ul.append(el('li', null, x))); box.append(ul);
}

// ---------- вкладка «Отзывы» ----------
/** Запись API api.nhtsa.gov/recalls (используемые поля) */
interface Recall {
  NHTSACampaignNumber?: string; Component?: string; Manufacturer?: string; ReportReceivedDate?: string;
  Summary?: string; Consequence?: string; Remedy?: string; Notes?: string;
  parkIt?: boolean; parkOutSide?: boolean; overTheAirUpdate?: boolean;
}
interface RecallForm { make: HTMLInputElement; model: HTMLInputElement; year: HTMLInputElement; results: HTMLDivElement }
const rf: { built: boolean; ui: RecallForm | null; vin: string | null; queried: string | null } = { built: false, ui: null, vin: null, queried: null };
function openRecalls(): void {
  const box = panels.recalls;
  if (!rf.built || !rf.ui) {
    rf.built = true;
    box.className = 'panel';
    const ui: RecallForm = { make: el('input'), model: el('input'), year: el('input'), results: el('div') };
    ui.make.placeholder = tr('Марка'); ui.model.placeholder = tr('Модель');
    ui.year.placeholder = tr('Год'); ui.year.maxLength = 4;
    const btn = el('button', null, 'Найти'); btn.type = 'button'; btn.addEventListener('click', searchRecalls);
    const f = el('div', 'recall-form'); f.append(ui.make, ui.model, ui.year, btn);
    box.append(f, el('p', 'recall-note', 'Отзывные кампании относятся к модели и году, а не к конкретному номеру: проверьте VIN на сайте производителя или на nhtsa.gov/recalls. Для запроса нужен интернет.'), ui.results);
    [ui.make, ui.model, ui.year].forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') searchRecalls(); }));
    rf.ui = ui;
  }
  const ui = rf.ui;
  const nh = current && current.kind === 'iso' ? current.nh : null;
  if (current && nh && nh.make && nh.model && nh.year && rf.vin !== current.vin) {
    rf.vin = current.vin; ui.make.value = nh.make; ui.model.value = nh.model; ui.year.value = String(nh.year);
    searchRecalls();
  } else if (!rf.queried) {
    ui.results.replaceChildren(el('p', 'empty', 'Расшифруйте номер, и марка, модель и год подставятся сами. Можно ввести их вручную.'));
  }
}
const parseDate = (s: string | undefined): number => { const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(s || ''); return m ? +m[3] * 10000 + +m[2] * 100 + +m[1] : 0; };
async function searchRecalls(): Promise<void> {
  const ui = rf.ui; if (!ui) return;
  const make = ui.make.value.trim(), model = ui.model.value.trim(), year = ui.year.value.trim();
  if (!make || !model || !/^\d{4}$/.test(year)) { ui.results.replaceChildren(el('p', 'recall-note', 'Укажите марку, модель и год из четырёх цифр.')); return; }
  rf.queried = `${make}|${model}|${year}`;
  const mine = rf.queried;
  ui.results.replaceChildren(el('p', 'empty', 'Запрашиваю NHTSA…'));
  try {
    const j = await getJson<{ results?: Recall[] }>('https://api.nhtsa.gov/recalls/recallsByVehicle?' + new URLSearchParams({ make, model, modelYear: year }));
    if (mine !== rf.queried) return;
    const list = (j.results || []).slice().sort((a, b) => parseDate(b.ReportReceivedDate) - parseDate(a.ReportReceivedDate));
    const head = el('p', 'recall-note', list.length ? `Найдено отзывных кампаний: ${list.length} (${year} ${make} ${model}). Сначала новые.` : 'Отзывных кампаний для этой модели и года не найдено.');
    const frag: HTMLElement[] = [head];
    list.forEach(r => {
      const d = el('details', 'recall');
      const sm = el('summary', null, `${r.NHTSACampaignNumber || ''} · ${r.Component || 'без компонента'}`);
      if (r.parkIt) sm.append(el('span', 'badge', 'не эксплуатировать'));
      if (r.parkOutSide) sm.append(el('span', 'badge', 'не парковать у зданий'));
      sm.append(el('small', null, [r.ReportReceivedDate, r.Manufacturer].filter(Boolean).join(' · ')));
      d.append(sm);
      ([['Суть', r.Summary], ['Последствия', r.Consequence], ['Устранение', r.Remedy], ['Примечания', r.Notes]] as const).forEach(([k, v]) => {
        if (v && String(v).trim()) { d.append(el('span', 'lbl', k), el('p', null, String(v).trim())); }
      });
      if (r.overTheAirUpdate) d.append(el('span', 'lbl', 'Обновление'), el('p', null, 'Устраняется обновлением ПО по воздуху'));
      frag.push(d);
    });
    ui.results.replaceChildren(...frag);
  } catch (e) {
    if (mine !== rf.queried) return;
    const b = el('button', 'link', 'Повторить'); b.type = 'button'; b.addEventListener('click', searchRecalls);
    ui.results.replaceChildren(el('p', 'error', `Не удалось получить данные (${e instanceof Error ? e.message : String(e)}). Нужен доступ к api.nhtsa.gov.`), b);
  }
}

// ---------- вкладка «Игра: угадай VIN» ----------
interface GameState {
  built: boolean; busy: boolean; round: Round | null; status: 'play' | 'won' | 'lost'; attemptsLeft: number;
  values: Record<number, string>; locked: Record<number, boolean>; wrong: Record<number, boolean>;
  history: string[]; msg: string; region: string; inputs: Record<number, HTMLInputElement>;
}
const gm: GameState = { built: false, busy: false, round: null, status: 'play', attemptsLeft: MAX_ATTEMPTS, values: {}, locked: {}, wrong: {}, history: [], msg: '', region: 'any', inputs: {} };
if (typeof globalThis.__VIN_TEST__ !== 'undefined') globalThis.__vinGame = gm;   // только для автотестов
interface Stats { played: number; won: number; streak: number; best: number }
const loadStats = (): Stats => { try { return { played: 0, won: 0, streak: 0, best: 0, ...JSON.parse(localStorage.getItem('game') || '{}') }; } catch { return { played: 0, won: 0, streak: 0, best: 0 }; } };
const saveStats = (st: Stats): void => { try { localStorage.setItem('game', JSON.stringify(st)); } catch { /* хранилище недоступно */ } };
const segClass = (i: number): string => SEGMENTS.find(s => i >= s[1] && i < s[2])![0];

function openGame(): void {
  if (!gm.built) { gm.built = true; if (gm.round) renderGame(); else newGame(); } else renderGame();
}
async function newGame(): Promise<void> {
  if (gm.busy) return;
  gm.busy = true; gm.round = null; gm.status = 'play'; gm.attemptsLeft = MAX_ATTEMPTS; gm.values = {}; gm.locked = {}; gm.wrong = {}; gm.history = []; gm.msg = '';
  renderGame();
  try { gm.round = await newRound({ region: gm.region }); } catch { gm.round = null; }
  gm.busy = false;
  renderGame();
}
function focusFrom(p: number, dir: number): void {
  const r = gm.round; if (!r) return;
  const list = r.hidden.filter(q => !gm.locked[q]);
  const cand = dir > 0 ? list.find(q => q > p) : [...list].reverse().find(q => q < p);
  if (cand && gm.inputs[cand]) gm.inputs[cand].focus();
}
const REGION_OPTIONS = [['any', 'Любой рынок'], ['na', 'Северная Америка'], ['eu', 'Европа'], ['as', 'Азия']] as const;
function renderGame(): void {
  const box = panels.game; box.replaceChildren(); box.className = 'panel game';
  const sel = el('select');
  REGION_OPTIONS.forEach(([v, t]) => { const o = el('option', null, t); o.value = v; sel.append(o); });
  sel.value = gm.region; sel.addEventListener('change', () => { gm.region = sel.value; });
  const nb = el('button', null, 'Новая игра'); nb.type = 'button'; nb.addEventListener('click', newGame);
  const ctl = el('div', 'gen-controls'); ctl.append(sel, nb); box.append(ctl);
  const st = loadStats();
  box.append(el('p', 'game-stats', `Сыграно: ${st.played} · Побед: ${st.won} · Серия: ${st.streak} · Лучшая серия: ${st.best}`));
  box.append(el('p', 'recall-note', 'Часть символов скрыта. Каждый из них можно вывести по правилам из показанных сведений: год даёт символ года, WMI определяется по производителю и стране, завод по таблице, контрольная цифра по расчёту. Наведите курсор на клетку, чтобы узнать, какое правило к ней относится.'));
  const r = gm.round;
  if (!r) { box.append(el('p', gm.busy ? 'empty' : 'error', gm.busy ? 'Подбираю номер…' : 'Не удалось подобрать номер, попробуйте ещё раз.')); return; }
  const card = el('div', 'game-card');
  card.append(el('div', 'game-title', r.info.title));
  const photo = photoBox(r.nh); if (photo) card.append(photo);
  const dl = el('dl'); r.info.rows.forEach(([k, v]) => dl.append(row(k, v))); card.append(dl);
  const wrap = el('div', 'vin game-vin'); wrap.style.setProperty('--n', '17');
  gm.inputs = {};
  for (let i = 0; i < 17; i++) {
    const pos = i + 1, hid = r.hidden.includes(pos), done = gm.status !== 'play';
    if (hid && !gm.locked[pos] && !done) {
      const inp = el('input', 'gcell' + (gm.wrong[pos] ? ' wrong' : '')); inp.maxLength = 1; inp.value = gm.values[pos] || '';
      inp.title = tr(cellHint(r, pos)); inp.setAttribute('aria-label', `${tr('Позиция')} ${pos}`);
      inp.addEventListener('input', () => {
        const v = String(inp.value || '').toUpperCase().split('').filter(ch => VIN_CHARS.test(ch)).pop() || '';
        inp.value = v; gm.values[pos] = v; gm.wrong[pos] = false; inp.className = 'gcell';
        if (v) focusFrom(pos, 1);
      });
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') checkGuess(); else if (e.key === 'Backspace' && !inp.value) focusFrom(pos, -1); });
      gm.inputs[pos] = inp; wrap.append(inp);
    } else {
      const cls = segClass(i) + (hid ? (gm.locked[pos] ? ' solved' : ' revealed') : '');
      const c = el('span', cls, r.vin[i]); c.title = tr(cellHint(r, pos)); wrap.append(c);
    }
  }
  card.append(wrap); box.append(card);
  if (gm.status === 'play') {
    box.append(el('p', 'game-status', `Попыток: ${gm.attemptsLeft} из ${MAX_ATTEMPTS}`));
    if (gm.msg) box.append(el('p', 'error', gm.msg));
    const act = el('div', 'game-actions');
    const ck = el('button', null, 'Проверить'); ck.type = 'button'; ck.addEventListener('click', checkGuess);
    const gv = el('button', 'sec', 'Сдаться'); gv.type = 'button'; gv.addEventListener('click', () => finish(false));
    act.append(ck, gv); box.append(act);
  } else {
    const used = MAX_ATTEMPTS - gm.attemptsLeft;
    box.append(el('p', 'game-status ' + (gm.status === 'won' ? 'win' : 'lose'), gm.status === 'won' ? `Верно! Номер угадан, использовано попыток: ${used}.` : `Не угадано. Номер: ${r.vin}`));
    const ul = el('ul', 'game-explain'); explainHidden(r).forEach(x => ul.append(el('li', null, x.text))); box.append(ul);
    const act = el('div', 'game-actions');
    const dec = el('button', null, 'Расшифровать этот номер'); dec.type = 'button'; dec.addEventListener('click', () => { input.value = r.vin; run(true); });
    const again = el('button', 'sec', 'Новая игра'); again.type = 'button'; again.addEventListener('click', newGame);
    act.append(dec, again); box.append(act);
  }
  if (gm.history.length) { const ul = el('ul', 'game-hist'); gm.history.forEach((h, n) => ul.append(el('li', null, `${tr('Попытка')} ${n + 1}: ${h}`))); box.append(ul); }
  if (gm.status === 'play') { const first = r.hidden.find(q => !gm.locked[q]); if (first && gm.inputs[first]) gm.inputs[first].focus(); }
}
function checkGuess(): void {
  const r = gm.round; if (!r || gm.status !== 'play') return;
  const open = r.hidden.filter(p => !gm.locked[p]);
  if (open.some(p => !gm.values[p])) { gm.msg = 'Заполните все пустые клетки.'; renderGame(); return; }
  gm.msg = '';
  const res = evaluate(r, Object.fromEntries(open.map(p => [p, gm.values[p]])));
  gm.history.push(open.map(p => `${gm.values[p]}${res[p] ? '✓' : '✗'}`).join(' '));
  gm.attemptsLeft--;
  open.forEach(p => { if (res[p]) gm.locked[p] = true; else { gm.wrong[p] = true; gm.values[p] = ''; } });
  if (r.hidden.every(p => gm.locked[p])) return finish(true);
  if (gm.attemptsLeft <= 0) return finish(false);
  renderGame();
}
function finish(won: boolean): void {
  gm.status = won ? 'won' : 'lost';
  const st = loadStats(); st.played++; if (won) { st.won++; st.streak++; st.best = Math.max(st.best, st.streak); } else st.streak = 0; saveStats(st);
  renderGame();
}

// ---------- вкладка «Генератор» ----------
interface GenUi { region: HTMLSelectElement; card: HTMLDivElement; histBox: HTMLUListElement }
const gen: { built: boolean; ui: GenUi | null; history: GeneratedVin[]; busy: boolean } = { built: false, ui: null, history: [], busy: false };
function renderHistory(): void {
  const ui = gen.ui; if (!ui) return;
  ui.histBox.replaceChildren(...gen.history.map(h => {
    const li = el('li'); const b = el('button', null, h.vin); b.type = 'button';
    b.append(el('small', null, [h.nh.year, h.nh.make, h.nh.model].filter(Boolean).join(' ')));
    b.addEventListener('click', () => showGen(h)); li.append(b); return li;
  }));
}
function openGen(): void {
  if (gen.built) return;
  gen.built = true;
  const box = panels.gen; box.className = 'panel';
  const ui: GenUi = { region: el('select'), card: el('div'), histBox: el('ul', 'gen-history') };
  REGION_OPTIONS.forEach(([v, t]) => { const o = el('option', null, t); o.value = v; ui.region.append(o); });
  const btn = el('button', null, 'Сгенерировать'); btn.type = 'button'; btn.addEventListener('click', generate);
  const c = el('div', 'gen-controls'); c.append(ui.region, btn);
  gen.ui = ui;
  box.append(c, ui.card,
    el('p', 'recall-note', 'Номер собран по реальным шаблонам NHTSA: модель, кузов и двигатель существуют в базе, контрольная цифра верна. Серийный номер случайный, поэтому конкретной машине номер не принадлежит.'),
    ui.histBox);
  if (gen.history.length) { showGen(gen.history[0]); renderHistory(); } else generate();
}
async function copyText(t: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(t); return true; } catch { /* запасной путь */ }
  try { const ta = document.createElement('textarea'); ta.value = t; document.body.append(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok; } catch { return false; }
}
function showGen(r: GeneratedVin): void {
  const ui = gen.ui; if (!ui) return;
  const nh = r.nh;
  const card = el('div', 'gen-card');
  card.append(el('div', 'gen-vin', r.vin));
  card.append(el('div', 'gen-title', [nh.year, nh.make, nh.model, nh.trim].filter(Boolean).join(' ')));
  const eng = [nh.cyl && `${nh.cyl} цил.`, nh.dispL && `${nh.dispL} л`, nh.hp && `${nh.hp} л.с.`, nh.fuel].filter(Boolean).join(', ');
  card.append(el('div', 'gen-sub', [nh.body, eng, [nh.plantCity, nh.plantCountry].filter(Boolean).join(', ')].filter(Boolean).join(' · ')));
  const gp = photoBox(nh);
  if (gp) card.append(gp);
  const act = el('div', 'gen-actions');
  const dec = el('button', null, 'Расшифровать'); dec.type = 'button';
  dec.addEventListener('click', () => { input.value = r.vin; run(true); });
  const cp = el('button', 'sec', 'Копировать'); cp.type = 'button';
  cp.addEventListener('click', async () => { cp.textContent = tr((await copyText(r.vin)) ? 'Скопировано' : 'Не удалось'); });
  act.append(dec, cp); card.append(act);
  ui.card.replaceChildren(card);
}
async function generate(): Promise<void> {
  const ui = gen.ui;
  if (gen.busy || !ui) return;
  gen.busy = true;
  ui.card.replaceChildren(el('p', 'empty', 'Подбираю номер…'));
  try {
    const r = await generateVin({ region: ui.region.value });
    if (!r) { ui.card.replaceChildren(el('p', 'error', 'Не удалось подобрать номер для этого рынка, попробуйте ещё раз.')); return; }
    showGen(r);
    gen.history.unshift(r); gen.history = gen.history.slice(0, 6);
    renderHistory();
  } catch (e) {
    ui.card.replaceChildren(el('p', 'error', `Не удалось сгенерировать номер: ${e instanceof Error ? e.message : String(e)}`));
  } finally { gen.busy = false; }
}


// ---------- настройки: язык и тема ----------
const root = document.documentElement;
const save = (k: string, v: string): void => { try { localStorage.setItem(k, v); } catch { /* хранилище недоступно */ } };
const load = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };
const settingsBtn = document.getElementById('settingsBtn'), settingsBox = document.getElementById('settings');
const langSel = document.getElementById('langSel') as HTMLSelectElement | null, themeSel = document.getElementById('themeSel') as HTMLSelectElement | null;

function applyStatic(): void {
  root.lang = getLang();
  for (const n of document.querySelectorAll<HTMLElement>('[data-i18n]')) { if (n.dataset.ru === undefined) n.dataset.ru = n.textContent || ''; n.textContent = tr(n.dataset.ru); }
  for (const n of document.querySelectorAll<HTMLInputElement>('[data-i18n-ph]')) { if (n.dataset.ruPh === undefined) n.dataset.ruPh = n.placeholder; n.placeholder = tr(n.dataset.ruPh); }
  for (const n of document.querySelectorAll<HTMLElement>('[data-i18n-title]')) { if (n.dataset.ruTitle === undefined) n.dataset.ruTitle = n.title; n.title = tr(n.dataset.ruTitle); }
}
function applyTheme(): void {
  const th = themeSel ? themeSel.value : 'system';
  if (th === 'light' || th === 'dark') root.dataset.theme = th; else delete root.dataset.theme;
}
async function changeLang(l: string): Promise<void> {
  setLang(l); applyStatic();
  rf.built = false; rf.ui = null; rf.vin = null; rf.queried = null; panels.recalls.replaceChildren();
  gen.built = false; gen.ui = null; panels.gen.replaceChildren();
  gm.built = false; panels.game.replaceChildren();
  const prev = currentTab;
  if (input.value.trim()) { await run(true); if (prev !== 'decode') setTab(prev); }
  else { out.replaceChildren(el('p', 'empty', 'Вставьте номер: расшифровка запустится сама, когда он станет полным. Наведите курсор на символ, чтобы увидеть правило и значение.')); setTab(prev); }
}
if (settingsBtn && settingsBox) {
  settingsBtn.addEventListener('click', () => { const open = settingsBox.hidden; settingsBox.hidden = !open; settingsBtn.setAttribute('aria-expanded', String(open)); });
}
if (langSel) { langSel.value = getLang(); langSel.addEventListener('change', () => { save('lang', langSel.value); changeLang(langSel.value); }); }
if (themeSel) { const th = load('theme'); themeSel.value = th === 'light' || th === 'dark' ? th : 'system'; themeSel.addEventListener('change', () => { save('theme', themeSel.value); applyTheme(); }); }

applyStatic(); applyTheme();

// ---------- боковая панель ----------
// В попапе — кнопка «Открыть в боковой панели» (Chrome: sidePanel, Firefox: sidebarAction). В самой панели кнопки нет,
// а смена языка или темы в попапе сразу применяется и здесь (событие storage приходит в другие страницы расширения).
const sidebarBtn = document.getElementById('sidebarBtn');
if (typeof location !== 'undefined' && isSidebarView(location.pathname)) {
  window.addEventListener('storage', e => {
    if (e.key === 'theme' && themeSel) { const th = e.newValue; themeSel.value = th === 'light' || th === 'dark' ? th : 'system'; applyTheme(); }
    if (e.key === 'lang' && langSel && e.newValue) { langSel.value = e.newValue; changeLang(e.newValue); }
  });
} else if (sidebarBtn) {
  const opener = sidebarOpener(extApi());
  if (opener.available) {
    sidebarBtn.hidden = false;
    opener.prepare();
    // open() — синхронно, прямо в обработчике клика: иначе браузер не считает это действием пользователя
    sidebarBtn.addEventListener('click', () => { if (opener.open()) window.close(); });
  }
}
form.addEventListener('submit', e => { e.preventDefault(); run(true); });
input.addEventListener('input', () => {
  const raw = input.value.toUpperCase().replace(/\s/g, '');
  const d = raw ? decodeLocal(raw) : null;
  if (d && !d.partial && !d.errors.length) run();
});
