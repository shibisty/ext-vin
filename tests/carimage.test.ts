// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commonsFileName, findCarImage, silhouetteKind, silhouetteUrl, stripHtml, yearSpan } from '../src/carimage';

describe('разбор ответов Wikipedia', () => {
  it('имя файла Commons из адреса картинки', () => {
    expect(commonsFileName('https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Honda_Accord.jpg/320px-Honda_Accord.jpg')).toBe('Honda_Accord.jpg');
    expect(commonsFileName('https://upload.wikimedia.org/wikipedia/commons/a/ab/%C5%A0koda.jpg')).toBe('Škoda.jpg');
    // файл локальной Wikipedia (часто несвободный) — не Commons
    expect(commonsFileName('https://upload.wikimedia.org/wikipedia/en/a/ab/Logo.png')).toBeNull();
  });
  it('годы выпуска из вступления статьи', () => {
    expect(yearSpan('The seventh generation was produced from 2002 to 2007.')).toEqual([2002, 2007]);
    expect(yearSpan('Produced 2012–present')).toEqual([2012, 9999]);
    expect(yearSpan('Sold since 2019 in Europe')).toEqual([2019, 9999]);
    expect(yearSpan('No years here')).toBeNull();
  });
  it('силуэт по типу кузова', () => {
    expect(silhouetteKind('Pickup')).toBe('pickup');
    expect(silhouetteKind('Sport Utility Vehicle (SUV)/Multi-Purpose Vehicle (MPV)')).toBe('van');
    expect(silhouetteKind('Hatchback/Liftback/Notchback')).toBe('hatch');
    expect(silhouetteKind(null)).toBe('sedan');
    expect(silhouetteUrl('Sedan')).toMatch(/^data:image\/svg\+xml;utf8,/);
  });
  it('HTML из метаданных превращается в текст', () => {
    expect(stripHtml('<a href="x">John &amp; Co</a>  ')).toBe('John & Co');
  });
});

describe('поиск фото', () => {
  const calls: string[] = [];
  const summary = {
    type: 'standard', title: 'Honda Accord', description: 'Series of cars', extract: 'The Honda Accord is a car.',
    thumbnail: { source: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Accord.jpg/320px-Accord.jpg' },
    content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Honda_Accord' } },
  };
  const meta = { query: { pages: [{ imageinfo: [{ extmetadata: { LicenseShortName: { value: 'CC BY-SA 4.0' }, Artist: { value: '<b>Jane</b>' }, LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0' } } }] }] } };
  beforeEach(() => {
    calls.length = 0;
    localStorage.clear();
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url);
      const body = url.includes('list=search') ? { query: { search: [] } } : url.includes('/page/summary/') ? summary : url.includes('commons') ? meta : null;
      return { ok: !!body, json: async () => body } as Response;
    }));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('находит фото модели с авторством и лицензией', async () => {
    const r = await findCarImage({ make: 'Honda', model: 'Accord', year: 2003 });
    expect(r).toMatchObject({ scope: 'model', author: 'Jane', license: 'CC BY-SA 4.0', title: 'Honda Accord' });
    expect(r!.filePage).toBe('https://commons.wikimedia.org/wiki/File:Accord.jpg');
  });
  it('в запросы уходят только марка, модель и год, без VIN', async () => {
    await findCarImage({ make: 'Honda', model: 'Accord', year: 2003 });
    expect(calls.length).toBeGreaterThan(0);
    for (const u of calls) expect(u).not.toMatch(/1HGCM/);
  });
  it('результат кэшируется в localStorage', async () => {
    await findCarImage({ make: 'Honda', model: 'Accord', year: 2003 });
    const n = calls.length;
    await findCarImage({ make: 'Honda', model: 'Accord', year: 2003 });
    expect(calls.length).toBe(n);
  });
  it('несвободная лицензия отбрасывается', async () => {
    meta.query.pages[0].imageinfo[0].extmetadata.LicenseShortName.value = 'Fair use';
    try {
      expect(await findCarImage({ make: 'Honda', model: 'Civic' })).toBeNull();
    } finally { meta.query.pages[0].imageinfo[0].extmetadata.LicenseShortName.value = 'CC BY-SA 4.0'; }
  });
  it('без марки или модели запросов нет', async () => {
    expect(await findCarImage({ make: 'Honda', model: null })).toBeNull();
    expect(calls).toEqual([]);
  });
});
