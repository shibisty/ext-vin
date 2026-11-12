// Сверка с эталоном. Эталон (fixtures/golden.json) снят с исходной JS-версии до перевода на TypeScript
// тем же набором номеров (fixtures/vins.json + 60 сгенерированных) и тем же seed. Любое расхождение = изменение поведения.
// Если поведение меняется намеренно: UPDATE_GOLDEN=1 npm test — фикстура перезапишется из текущего кода.
import { readFileSync, writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { decodeLocal } from '../src/decode';
import { generateVin, isCheckException, nhtsaDecode } from '../src/nhtsa';
import { explainPositions, explainSegments, jdmRules, positionTitles, sourcesOf } from '../src/explain';
import { setLang, tr } from '../src/i18n';
import { cellHint, explainHidden, newRound } from '../src/game';
import { GOLDEN_DATE, seedRandom } from './setup';

const FIXTURE = new URL('./fixtures/golden.json', import.meta.url);
const FIXED: string[] = JSON.parse(readFileSync(new URL('./fixtures/vins.json', import.meta.url), 'utf8'));
const REGIONS = ['any', 'na', 'eu', 'as'];

interface Golden { date: string; records: (Record<string, unknown> | null)[]; rounds: unknown[] }

// JSON-круг: undefined-поля исчезают так же, как при сохранении эталона
const plain = <T>(x: T): T => JSON.parse(JSON.stringify(x));

async function build(): Promise<Golden> {
  const restore = seedRandom(20261110);
  try {
    const vins: (string | null)[] = [...FIXED];
    for (let i = 0; i < 60; i++) { const r = await generateVin({ region: REGIONS[i % 4] }); vins.push(r ? r.vin : null); }
    const records: Golden['records'] = [];
    for (const [idx, v] of vins.entries()) {
      if (!v) { records.push(null); continue; }
      const d = decodeLocal(v);
      const rec: Record<string, unknown> = { v, local: d };
      let titles: string[] = [], sources: string[] = [];
      if (d.jdm) { rec.rules = jdmRules(d); rec.sources = sources = sourcesOf(d, null, 'jdm'); }
      else if (d.legacy) { rec.titles = titles = explainSegments(d.vin, d.segments, d.rows, d.format); rec.sources = sources = sourcesOf(d, null, 'legacy'); }
      else if (d.partial || !d.errors.length) {
        const n = await nhtsaDecode(d.partial ? d.vin.padEnd(17, '*') : d.vin);
        rec.nh = n;
        if (!d.partial) rec.exc = await isCheckException(d.vin);
        rec.titles = titles = positionTitles(explainPositions(d.vin, d, n));
        if (!d.partial) rec.sources = sources = sourcesOf(d, n, 'iso');
      }
      if (idx < FIXED.length) { setLang('en'); rec.en = [...titles, ...sources, ...(d.errors || [])].map(t => tr(t)); setLang('ru'); }
      records.push(plain(rec));
    }
    const rounds = [];
    for (let i = 0; i < 4; i++) {
      const r = await newRound({ region: REGIONS[i] });
      rounds.push(r && plain({ vin: r.vin, hidden: r.hidden, info: r.info, explain: explainHidden(r), hints: r.hidden.map(p => cellHint(r, p)) }));
    }
    return { date: GOLDEN_DATE.toISOString().slice(0, 10), records, rounds };
  } finally { restore(); }
}

describe('совпадение с исходной JS-версией', () => {
  let actual: Golden;
  let expected: Golden;
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(GOLDEN_DATE);
    actual = await build();
    if (process.env.UPDATE_GOLDEN) writeFileSync(FIXTURE, JSON.stringify(actual));
    expected = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  }, 120_000);
  afterAll(() => { vi.useRealTimers(); });

  it('генератор выдаёт ту же последовательность номеров', () => {
    expect(actual.records.map(r => r && r.v)).toEqual(expected.records.map(r => r && r.v));
  });
  it('набор покрывает все виды номеров', () => {
    const kinds = new Set(expected.records.map(r => {
      const d = r && (r.local as { jdm?: boolean; legacy?: boolean; partial?: boolean; errors: string[] });
      return !d ? 'none' : d.jdm ? 'jdm' : d.legacy ? 'legacy' : d.partial ? 'partial' : d.errors.length ? 'error' : 'iso';
    }));
    expect([...kinds].sort()).toEqual(expect.arrayContaining(['error', 'iso', 'jdm', 'legacy', 'partial']));
  });
  // по записи на номер: при расхождении видно, какой именно VIN разошёлся
  for (let i = 0; i < FIXED.length + 60; i++) {
    it(`запись ${i}`, () => {
      expect(actual.records[i]).toEqual(expected.records[i]);
    });
  }
  it('раунды игры', () => {
    expect(actual.rounds).toEqual(expected.rounds);
  });
});
