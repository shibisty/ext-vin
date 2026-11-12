// Сверка офлайн-декодера с живым API vPIC. Фикстура fixtures/vpic-api.json снята 2026-11-11 запросами
// https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVin/<VIN>?format=json: [id элемента, значение, id значения].
// Номера подобраны так, чтобы покрыть легковые, грузовики, прицепы, автобусы и мотоцикл.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { nhtsaDecode, type NhtsaResult } from '../src/nhtsa';

const API: Record<string, [number, string, string][]> = JSON.parse(readFileSync(new URL('./fixtures/vpic-api.json', import.meta.url), 'utf8'));
// служебные элементы (марка, производитель, год, тип ТС, коды ошибок) и пересчёт объёма/мощности в другие единицы
const SKIP = new Set([26, 27, 29, 39, 142, 143, 144, 156, 191, 196, 204, 11, 12, 21, 125]);
// основные элементы -> поле NhtsaResult
const FIELDS: Record<number, keyof NhtsaResult> = { 28: 'model', 34: 'series', 38: 'trim', 5: 'body', 14: 'doors', 15: 'drive', 9: 'cyl', 18: 'engModel', 24: 'fuel',
  66: 'fuel2', 64: 'engCfg', 135: 'turbo', 126: 'elec', 67: 'fuelInj', 62: 'valve', 37: 'trans', 63: 'speeds', 25: 'gvwr', 75: 'plantCountry', 77: 'plantState',
  31: 'plantCity', 76: 'plantCompany', 10: 'dest', 146: 'engMfr', 13: 'dispL', 71: 'hp' };
// известные расхождения: живая база правилась после выпуска дампа 2026-10 (адрес завода Bentley перенесён из «Note» в «Plant Address»)
const KNOWN: Record<string, number[]> = { SJAAJ4ZV3LC383265: [114], SJAAR5ZV8LC726439: [114] };

const norm = (v: string): string => {
  const t = v.trim();
  return /^\d+(\.\d+)?$/.test(t) ? String(Math.round(parseFloat(t) * 10) / 10) : t.toLowerCase();
};
function ours(nh: NhtsaResult): Map<number, Set<string>> {
  const m = new Map<number, Set<string>>();
  const add = (el: number, v: unknown) => {
    if (v == null || v === '') return;
    const s = m.get(el) || new Set<string>(); s.add(norm(String(v))); m.set(el, s);
  };
  for (const [el, k] of Object.entries(FIELDS)) add(+el, k === 'hp' ? String(nh.hp || '').split('–')[0] : nh[k]);
  for (const x of nh.extra || []) add(x.el, x.value);
  return m;
}

describe('сверка с API vPIC', () => {
  for (const [vin, rows] of Object.entries(API)) {
    it(vin, async () => {
      const nh = (await nhtsaDecode(vin))!;
      const mine = ours(nh);
      const theirs = new Map<number, Set<string>>();
      for (const [el, v] of rows) {
        if (SKIP.has(el) || v === 'Not Applicable') continue;
        const s = theirs.get(el) || new Set<string>(); s.add(norm(v)); theirs.set(el, s);
      }
      const diff: string[] = [];
      for (const [el, s] of theirs) {
        if ((KNOWN[vin] || []).includes(el)) continue;
        const o = mine.get(el);
        if (!o) diff.push(`нет ${el}: ${[...s].join(' | ')}`);
        else if ([...s].sort().join('\n') !== [...o].sort().join('\n')) diff.push(`${el}: api ${[...s].join(' | ')} / наш ${[...o].join(' | ')}`);
      }
      // лишнее: то, чего API не выдаёт (кроме объёма и мощности, которые API пересчитывает в другие единицы)
      for (const el of mine.keys()) if (!theirs.has(el) && !SKIP.has(el) && !(KNOWN[vin] || []).includes(el) && el !== 13 && el !== 71) diff.push(`лишнее ${el}`);
      expect(diff).toEqual([]);
    });
  }
});
