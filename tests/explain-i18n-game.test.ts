import { afterEach, describe, expect, it } from 'vitest';
import { decodeLocal, isIso } from '../src/decode';
import { explainPositions, explainSegments, positionTitles, sourcesOf } from '../src/explain';
import { checkSum, evaluate, explainHidden, newRound, yearChar } from '../src/game';
import { getLang, setLang, tr } from '../src/i18n';
import { nhtsaDecode } from '../src/nhtsa';
import type { LegacyDecode } from '../src/types';
import { seedRandom } from './setup';

describe('объяснение позиций', () => {
  it('по записи на каждый символ, с группой и правилом', async () => {
    const d = decodeLocal('1HGCM82633A004352');
    if (!isIso(d)) throw new Error('ожидалась ISO-расшифровка');
    const nh = await nhtsaDecode(d.vin);
    const pos = explainPositions(d.vin, d, nh);
    expect(pos).toHaveLength(17);
    expect(pos[8]).toMatchObject({ pos: 9, ch: '3', group: 'контрольная цифра' });
    expect(pos[8].result).toContain('Совпало');
    expect(pos[9].result[0]).toBe('Выбран год: 2003');
    // символы VDS объясняются шаблонами NHTSA
    expect(pos[3].result.some(r => r.startsWith('NHTSA, шаблон'))).toBe(true);
    expect(positionTitles(pos)[0]).toMatch(/^Позиция 1 · WMI/);
  });
  it('«*» в частичном VIN — неизвестный символ', () => {
    const pos = explainPositions('1HG*', {}, null);
    expect(pos[3]).toMatchObject({ ch: '*', what: 'неизвестный символ' });
  });
  it('подсказки для старых форматов по сегментам', () => {
    const d = decodeLocal('BS23J0B275411') as LegacyDecode;
    const titles = explainSegments(d.vin, d.segments, d.rows, d.format);
    expect(titles).toHaveLength(13);
    expect(titles[4]).toMatch(/^Двигатель · символ 5: «J»/);
  });
  it('источники для ISO и старого формата', () => {
    expect(sourcesOf({ makerSrc: 'x' }, null, 'iso')).toContain('Производитель: x');
    expect(sourcesOf({ format: 'Ford' }, null, 'legacy')[0]).toBe('Формат: Ford');
  });
});

describe('перевод интерфейса', () => {
  afterEach(() => setLang('ru'));
  it('по умолчанию русский и строки не меняются', () => {
    expect(getLang()).toBe('ru');
    expect(tr('Страна')).toBe('Страна');
  });
  it('английский: подстановка самых длинных фраз, латиница не трогается', () => {
    setLang('en');
    expect(tr('Страна')).toBe('Country');
    expect(tr('Регион: Европа')).toMatch(/^Region: /);
    expect(tr('Honda Accord')).toBe('Honda Accord');
  });
  it('не заменяет часть слова', () => {
    setLang('en');
    // «Совпало» есть в словаре, но внутри другого слова заменяться не должно
    expect(tr('НеСовпалось')).toBe('НеСовпалось');
  });
  it('null и undefined проходят как есть; неизвестный язык = русский', () => {
    setLang('en');
    expect(tr(null)).toBeNull();
    setLang('de');
    expect(getLang()).toBe('ru');
  });
});

describe('игра «Угадай VIN»', () => {
  it('символ года', () => {
    expect(yearChar(2003)).toBe('3');
    expect(yearChar(2010)).toBe('A');
    expect(yearChar(2001)).toBe('1');
  });
  it('контрольная сумма', () => {
    expect(checkSum('1HGCM82633A004352')).toMatchObject({ digit: '3' });
  });
  it('проверка ответа без учёта регистра', () => {
    const round = { vin: '1HGCM82633A004352', hidden: [9, 10] };
    expect(evaluate(round, { 9: '3', 10: 'x' })).toEqual({ 9: true, 10: false });
    expect(evaluate({ vin: 'WVWZZZ1JZAW386752', hidden: [10] }, { 10: 'a' })).toEqual({ 10: true });
  });
  it('раунд: скрытые позиции выводятся по правилам, разбор объясняет каждую', async () => {
    const restore = seedRandom(2026);
    try {
      const r = (await newRound({ region: 'na' }))!;
      expect(r).not.toBeNull();
      expect(r.hidden.length).toBe(5);
      expect(r.hidden).toContain(10);
      expect(r.info.rows.length).toBeGreaterThan(3);
      const ex = explainHidden(r);
      expect(ex.map(x => x.pos)).toEqual(r.hidden);
      expect(ex.find(x => x.pos === 10)!.text).toContain(`символ «${r.vin[9]}»`);
    } finally { restore(); }
  });
});

describe('английский интерфейс без русских остатков', () => {
  afterEach(() => setLang('ru'));
  it('в эталоне все подсказки, источники и ошибки переведены', async () => {
    const { readFileSync } = await import('node:fs');
    const g = JSON.parse(readFileSync(new URL('./fixtures/golden.json', import.meta.url), 'utf8')) as { records: ({ v: string; en?: string[] } | null)[] };
    const left = g.records.flatMap(r => (r && r.en || []).filter(s => /[А-Яа-яЁё]/.test(s)).map(s => `${r!.v}: ${s.split('\n').find(l => /[А-Яа-яЁё]/.test(l))}`));
    expect(left).toEqual([]);
  });
  it('все строки таблиц префиксов JDM переводятся', async () => {
    const T = await import('../src/data/jdm-cert');
    const strings = [
      ...Object.values(T.CERT_C1), ...Object.values(T.CERT_C3), ...Object.values(T.CERT_EXEMPT_C2), ...Object.values(T.CERT_EXEMPT_C3), ...Object.values(T.CERT_FUEL),
      ...Object.values(T.CERT_C2).flatMap(([f, , n]) => (n ? [f, n] : [f])), ...T.CERT_OLD_CLASSES, ...T.CERT_OLD_REGS,
    ];
    setLang('en');
    expect(strings.filter(s => /[А-Яа-яЁё]/.test(tr(s)))).toEqual([]);
  });
});
