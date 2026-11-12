// Справочник Mitchell 1 — отдельный пакет: без него декодер работает и не выдаёт ничего из справочника.
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeLocal, hasMitchell, useMitchell } from '../src/decode';
import { MITCHELL } from '../src/mitchell';
import { sourcesOf } from '../src/explain';
import type { JdmDecode, LegacyDecode } from '../src/types';

const FIXED: string[] = JSON.parse(readFileSync(new URL('./fixtures/vins.json', import.meta.url), 'utf8'));

describe('без пакета Mitchell 1', () => {
  beforeAll(() => useMitchell(null));
  afterAll(() => useMitchell(MITCHELL));

  it('пакет отключён', () => expect(hasMitchell()).toBe(false));

  it('ни один номер эталона не падает и не ссылается на данные справочника', () => {
    for (const v of FIXED) {
      const d = decodeLocal(v);
      const text = JSON.stringify(d);
      expect(text, v).not.toMatch(/по справочнику Mitchell|Модель по справочнику Mitchell|По справочнику Mitchell/);
      expect((d as { brandSource?: string }).brandSource || '', v).not.toContain('Mitchell');
      expect(JSON.stringify(sourcesOf(d as never, null, (d as JdmDecode).jdm ? 'jdm' : (d as LegacyDecode).legacy ? 'legacy' : 'iso')), v).not.toContain('Mitchell');
    }
  });

  it('форматы только из справочника не распознаются, общие — без таблиц', () => {
    expect((decodeLocal('A6S055A100001') as LegacyDecode).legacy).toBeUndefined();     // AMC 1976: только справочник
    expect((decodeLocal('CCL144A123456') as LegacyDecode).legacy).toBeUndefined();     // грузовик Chevrolet
    const gm = decodeLocal('1Q87H6N100001') as LegacyDecode;                            // GM 1976: формат известен, таблиц без справочника нет
    expect(gm.legacy).toBe(true);
    expect(gm.rows.find(r => r[0] === 'Двигатель')![2]).toContain('не подключены');
    const po = decodeLocal('9113100123') as LegacyDecode;                               // Porsche 1970-х: формат по 911UK
    expect(po.legacy).toBe(true);
    expect(po.rows.some(r => r[0].includes('Mitchell'))).toBe(false);
    expect((decodeLocal('123456') as LegacyDecode).format).toMatch(/^Porsche 356/);       // без пакета Volvo нет, остаётся Porsche 356
    const jdm = decodeLocal('TA12-1234567') as JdmDecode;
    expect(jdm.toyotaRef).toBeNull();
    expect(jdm.subaruRef).toBeNull();
  });
});

describe('с пакетом Mitchell 1', () => {
  it('те же номера расшифровываются по справочнику', () => {
    expect(hasMitchell()).toBe(true);
    expect((decodeLocal('A9S055A100001') as LegacyDecode).legacy).toBe(true);
    expect((decodeLocal('TA12-1234567') as JdmDecode).toyotaRef).not.toBeNull();
  });
});

describe('номера двигателей и Mazda 1979–1980 (пакет Mitchell 1)', () => {
  const rows = (v: string) => (decodeLocal(v) as LegacyDecode).rows;
  const val = (v: string, label: string) => rows(v).find(r => r[0] === label)?.[1];
  it('Porsche: ближайший стартовый номер своей серии', () => {
    expect(val('6349123', 'Модель')).toBe('911 Carrera,911S');
    expect(val('6349123', 'Исполнение')).toBe('автомат');
    expect(val('6340500', 'Исполнение')).toBe('механика');
    expect(val('62M01234', 'Модель')).toBe('911 Carrera 2 / 911 Carrera 4');
    expect(val('EC0040000', 'Модельный год')).toBe('1975');
    expect(val('64E01234', 'Модельный год')).toBe('1984');
  });
  it('Volkswagen: коды 2003–2009, начальные символы 1974–2002 и Beetle', () => {
    expect(val('BEV012345', 'Модели и годы')).toContain('Golf, 2,0 л 4 цил., бензин (2004–2008)');
    expect(val('CK123456', 'Модели и годы')).toContain('Rabbit 77-80');
    expect(val('AJ0100000', 'Модельный год')).toBe('1977');
  });
  it('Mercedes-Benz: тип двигателя по первым шести цифрам', () => {
    expect(val('11291230123456', 'Если это номер двигателя')).toBe('C240 (2004–2005); двигатель V6 2,6 л');
  });
  it('Mazda: RX-7 и пикап по диапазонам серийных номеров', () => {
    expect(val('SA22C512345', 'Модельный год')).toBe('1979');
    expect(val('SA22C570000', 'Модельный год')).toBe('1980');
    expect(val('PE2M6501000', 'Двигатель (4-й знак)')).toBe('2000 см³');
  });
  it('без пакета эти номера не расшифровываются', () => {
    useMitchell(null);
    try {
      for (const v of ['6349123', 'BEV012345', 'SA22C512345']) expect((decodeLocal(v) as LegacyDecode).legacy, v).toBeUndefined();
      expect(rows('11291230123456').some(r => r[0] === 'Если это номер двигателя')).toBe(false);
    } finally { useMitchell(MITCHELL); }
  });
});
