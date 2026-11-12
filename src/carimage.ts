// Фото автомобиля: заглавная картинка статьи Wikipedia (REST summary) + авторство и лицензия из Wikimedia Commons.
// Наружу уходят только марка, модель и год; сам VIN в запросах не участвует.
const WIKI = 'https://en.wikipedia.org';
const COMMONS = 'https://commons.wikimedia.org';
const CAR_WORDS = /\b(cars?|automobiles?|vehicles?|suvs?|crossovers?|trucks?|pickups?|vans?|minivans?|hatchbacks?|sedans?|coupes?|coupés?|wagons?|motorcycles?|roadsters?|convertibles?)\b/i;
const FREE_BAD = /fair use|non-free|nonfree|all rights reserved/i;
const TTL_HIT = 30 * 86400e3, TTL_MISS = 3 * 86400e3;

// Ответы API: описаны только используемые поля
interface WikiSummary {
  type?: string;
  title?: string;
  description?: string;
  extract?: string;
  thumbnail?: { source: string };
  originalimage?: { source: string };
  content_urls?: { desktop?: { page: string } };
}
interface ExtMeta { value: unknown }
interface CommonsQuery {
  query?: { pages?: { imageinfo?: { extmetadata?: Record<string, ExtMeta | undefined> }[] }[] | Record<string, { imageinfo?: { extmetadata?: Record<string, ExtMeta | undefined> }[] }> };
}
interface WikiSearch { query?: { search?: { title: string }[] } }

export interface Attribution { author: string; license: string; licenseUrl: string | null; filePage: string }
export interface CarImage extends Attribution {
  src: string;
  article: string | null;
  title: string | undefined;
  /** фото конкретного поколения (по году) или модели в целом */
  scope: 'generation' | 'model';
}

async function getJson<T>(url: string, ms = 8000): Promise<T | null> {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { 'Api-User-Agent': 'VIN-Decoder-Extension/0.4 (browser extension)' } });
    if (!r.ok) return null;
    return await r.json() as T;
  } catch { return null; } finally { clearTimeout(t); }
}
export const stripHtml = (h: unknown): string => {
  if (!h) return '';
  const s = String(h);
  if (typeof DOMParser !== 'undefined') return (new DOMParser().parseFromString(s, 'text/html').body.textContent || '').replace(/\s+/g, ' ').trim();
  return s.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
};

// --- кэш в localStorage (если доступен)
const store = (): Storage | null => { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; } };
/** undefined — в кэше нет; null — уже искали и не нашли */
function cacheGet(key: string): CarImage | null | undefined {
  const s = store(); if (!s) return undefined;
  try {
    const v = JSON.parse(s.getItem('img:' + key) || 'null') as { ts: number; hit: boolean; data: CarImage | null } | null;
    if (v && Date.now() - v.ts < (v.hit ? TTL_HIT : TTL_MISS)) return v.hit ? v.data : null;
  } catch { /* битая запись */ }
  return undefined;
}
function cacheSet(key: string, data: CarImage | null): void {
  const s = store(); if (!s) return;
  try { s.setItem('img:' + key, JSON.stringify({ ts: Date.now(), hit: !!data, data })); } catch { /* переполнение */ }
}

// Имя файла Commons из адреса картинки: у файлов локальной Wikipedia (часто несвободных) пути другие
export function commonsFileName(src: string | null | undefined): string | null {
  const m = /\/wikipedia\/commons\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^\/?#]+)/.exec(src || '');
  return m ? decodeURIComponent(m[1]) : null;
}

async function attribution(file: string): Promise<Attribution | null> {
  const q = new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', prop: 'imageinfo', iiprop: 'extmetadata',
    iiextmetadatafilter: 'Artist|Credit|LicenseShortName|LicenseUrl|NonFree|Restrictions', titles: 'File:' + file, origin: '*' });
  const j = await getJson<CommonsQuery>(`${COMMONS}/w/api.php?${q}`);
  const raw = j && j.query && j.query.pages;
  const pages = raw && !Array.isArray(raw) ? Object.values(raw) : raw;
  const ii = pages && pages[0] && pages[0].imageinfo && pages[0].imageinfo[0];
  const m = ii && ii.extmetadata;
  if (!m || !m.LicenseShortName) return null;
  const license = stripHtml(m.LicenseShortName.value);
  if (FREE_BAD.test(license) || (m.NonFree && String(m.NonFree.value).toLowerCase() === 'true') || (m.Restrictions && /nonfree/i.test(String(m.Restrictions.value)))) return null;
  return {
    author: stripHtml(m.Artist && m.Artist.value) || 'автор не указан', license, licenseUrl: (m.LicenseUrl && m.LicenseUrl.value as string) || null,
    filePage: `${COMMONS}/wiki/File:${encodeURIComponent(file).replace(/%2F/g, '/')}`,
  };
}

async function summaryOf(title: string): Promise<WikiSummary | null> {
  return getJson<WikiSummary>(`${WIKI}/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`);
}
async function imageFromSummary(sum: WikiSummary | null): Promise<Omit<CarImage, 'scope'> | null> {
  if (!sum || sum.type === 'disambiguation' || !sum.thumbnail) return null;
  if (!CAR_WORDS.test(`${sum.description || ''} ${(sum.extract || '').slice(0, 300)}`)) return null;   // не автомобильная статья
  const file = commonsFileName((sum.originalimage && sum.originalimage.source) || sum.thumbnail.source);
  if (!file) return null;
  const meta = await attribution(file);
  if (!meta) return null;
  return { src: sum.thumbnail.source, article: sum.content_urls && sum.content_urls.desktop ? sum.content_urls.desktop.page : null, title: sum.title, ...meta };
}

// Годы выпуска из вступления статьи: «2002–2007», «from 2002 to 2007», «since 2012»
export function yearSpan(text: string | null | undefined): [number, number] | null {
  const t = String(text || '').slice(0, 400);
  const a = /\b(19[5-9]\d|20[0-4]\d)\s*(?:[–—-]|to|until|through)\s*(19[5-9]\d|20[0-4]\d|present)\b/i.exec(t);
  if (a) return [+a[1], a[2].toLowerCase() === 'present' ? 9999 : +a[2]];
  const b = /\b(?:from|since|in)\s+(19[5-9]\d|20[0-4]\d)\b/i.exec(t);
  return b ? [+b[1], 9999] : null;
}

async function generationImage(make: string, model: string, year: number): Promise<CarImage | null> {
  const q = new URLSearchParams({ action: 'query', list: 'search', srsearch: `${make} ${model} generation`, srnamespace: '0', srlimit: '8', format: 'json', formatversion: '2', origin: '*' });
  const j = await getJson<WikiSearch>(`${WIKI}/w/api.php?${q}`);
  const hits = ((j && j.query && j.query.search) || []).map(x => x.title)
    .filter(t => /generation/i.test(t) && t.toLowerCase().includes(model.toLowerCase().split(' ')[0])).slice(0, 5);
  for (const title of hits) {
    const sum = await summaryOf(title);
    const span = sum && yearSpan(sum.extract);
    if (span && year >= span[0] && year <= span[1]) {
      const img = await imageFromSummary(sum);
      if (img) return { ...img, scope: 'generation' };
    }
  }
  return null;
}

export interface CarQuery { make?: string | null; model?: string | null; year?: number | string | null }
// {make, model, year} -> {src, article, title, author, license, licenseUrl, filePage, scope} | null
export async function findCarImage({ make, model, year }: CarQuery): Promise<CarImage | null> {
  if (!make || !model) return null;
  const key = `${make}|${model}|${year || ''}`.toLowerCase();
  const cached = cacheGet(key);
  if (cached !== undefined) return cached;
  let res: CarImage | null = null;
  if (year) res = await generationImage(make, model, +year);
  if (!res) {
    const base = model.toLowerCase().startsWith(make.toLowerCase()) ? model : `${make} ${model}`;
    for (const title of [base, `${base} (car)`]) {
      const img = await imageFromSummary(await summaryOf(title));
      if (img) { res = { ...img, scope: 'model' }; break; }
    }
  }
  cacheSet(key, res);
  return res;
}

// Силуэт по типу кузова: запасной вариант, когда фото нет или нет сети
const SIL = {
  sedan: 'M8 38c0-5 3-7 8-8l12-9c4-3 9-4 17-4h24c9 0 14 2 19 6l9 6c8 1 12 3 12 9v4H8z',
  hatch: 'M8 38c0-5 3-7 8-8l10-10c3-3 7-4 13-4h38c7 0 11 2 15 6l8 8c8 1 12 3 12 8v4H8z',
  suv: 'M8 38c0-5 3-7 8-8l6-14c2-4 5-5 10-5h56c6 0 9 1 12 5l7 9c8 1 11 3 11 8v5H8z',
  pickup: 'M8 38c0-5 3-7 8-8l9-11c2-2 5-3 9-3h22v10h50c6 0 9 3 9 8v4H8z',
  van: 'M8 38c0-5 2-7 6-8l6-16c2-4 4-5 9-5h74c7 0 11 3 13 8l6 13c6 1 9 3 9 8v4H8z',
} as const;
export type SilhouetteKind = keyof typeof SIL;
export function silhouetteKind(body: string | null | undefined): SilhouetteKind {
  const b = String(body || '').toLowerCase();
  return /pickup|truck/.test(b) ? 'pickup' : /van|minivan|mpv|bus/.test(b) ? 'van' : /suv|sport utility|crossover|wagon/.test(b) ? 'suv' : /hatch/.test(b) ? 'hatch' : 'sedan';
}
export function silhouetteUrl(body: string | null | undefined): string {
  const k = silhouetteKind(body);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 130 56"><path d="${SIL[k]}" fill="#8a97a1"/><circle cx="34" cy="42" r="8" fill="#5e6b75"/><circle cx="98" cy="42" r="8" fill="#5e6b75"/></svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}
