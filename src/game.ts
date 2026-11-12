// Игра «Угадай VIN»: скрываются только символы, которые однозначно восстанавливаются по правилам и показанным сведениям.
import { generateVin, type NhtsaResult } from './nhtsa';
import { decodeLocal, wmiByMaker, plantTable } from './decode';
import { explainPositions } from './explain';
import { tr } from './i18n';
import type { IsoDecode, PositionExplain } from './types';

export const MAX_ATTEMPTS = 5;
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
const TRANSL: Record<string, number> = { A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9, S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9 };
const YEAR_CHARS = 'ABCDEFGHJKLMNPRSTVWXY123456789';
export const VIN_CHARS = /^[0-9A-HJ-NPR-Z]$/;
const shuffle = <T>(a: T[]): T[] => a.map(x => [Math.random(), x] as const).sort((p, q) => p[0] - q[0]).map(x => x[1]);

export const yearChar = (y: number): string => YEAR_CHARS[(y - 1980) % 30];
export function checkSum(vin: string): { sum: number; rem: number; digit: string } {
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += (/\d/.test(vin[i]) ? +vin[i] : TRANSL[vin[i]]) * WEIGHTS[i];
  const rem = sum % 11;
  return { sum, rem, digit: rem === 10 ? 'X' : String(rem) };
}

// какие позиции можно скрыть так, чтобы ответ определялся однозначно
function deducible(vin: string, d: IsoDecode): number[] {
  const base = [10];                                         // год: символ однозначно следует из показанного года
  const cand = d.maker ? wmiByMaker(d.maker) : [];
  if (cand.includes(vin.slice(0, 3))) for (let p = 0; p < 3; p++) if (cand.every(w => w[p] === vin[p])) base.push(p + 1);
  if (d.plantWb) {
    const t = plantTable(d.maker, vin.slice(0, 3));
    const plantWb = d.plantWb;
    if (t && Object.entries(t.map).filter(([, txt]) => txt === plantWb.text).map(([c]) => c).join() === vin[10]) base.push(11);
  }
  return base;
}

export interface Round {
  vin: string;
  nh: NhtsaResult;
  d: IsoDecode;
  /** скрытые позиции, 1..17 */
  hidden: number[];
  attempts: number;
  positions: PositionExplain[];
  info: { title: string; rows: [string, string][] };
}

export async function newRound({ region = 'any', hidden = 5 }: { region?: string; hidden?: number } = {}): Promise<Round | null> {
  for (let i = 0; i < 80; i++) {
    const g = await generateVin({ region });
    if (!g) continue;
    const d = decodeLocal(g.vin);
    if (d.errors && d.errors.length) continue;
    if (d.jdm || d.legacy || d.partial) continue;   // сгенерированный номер всегда 17-значный: сюда не попадаем
    const base = deducible(g.vin, d as IsoDecode);
    const extra = Math.random() < 0.5 ? 9 : 12 + Math.floor(Math.random() * 6);   // контрольная цифра или цифра серийного номера (через контрольную сумму)
    if (base.length + 1 < hidden) continue;
    const finalHidden = shuffle([...base, extra]).slice(0, hidden).sort((x, y) => x - y);   // 9 и цифра серийного номера не могут быть скрыты вместе: extra один
    const nh = g.nh, iso = d as IsoDecode;
    const eng = [nh.cyl && `${nh.cyl} цил.`, nh.dispL && `${nh.dispL} л`, nh.hp && `${nh.hp} л.с.`, nh.fuel].filter(Boolean).join(', ');
    const rows = ([['Модельный год', String(nh.year)], ['Кузов', nh.body], ['Двигатель', eng], ['Привод', nh.drive], ['КПП', nh.trans],
      ['Производитель по коду WMI', iso.maker], ['Страна', iso.country], ['Завод', iso.plantWb ? iso.plantWb.text : [nh.plantCity, nh.plantCountry].filter(Boolean).join(', ')]] as [string, string | null | undefined][])
      .filter((r): r is [string, string] => !!r[1]);
    return { vin: g.vin, nh, d: iso, hidden: finalHidden, attempts: MAX_ATTEMPTS, positions: explainPositions(g.vin, iso, nh),
      info: { title: [nh.year, nh.make, nh.model, nh.trim].filter(Boolean).join(' '), rows } };
  }
  return null;
}

// guess: { позиция: символ } -> { позиция: true/false }
export function evaluate(round: Pick<Round, 'hidden' | 'vin'>, guess: Record<number, string | undefined>): Record<number, boolean> {
  const out: Record<number, boolean> = {};
  for (const p of round.hidden) out[p] = (guess[p] || '').toUpperCase() === round.vin[p - 1];
  return out;
}

// Разбор после игры: почему именно этот символ
export function explainHidden(round: Round): { pos: number; ch: string; text: string }[] {
  const { vin, d, nh } = round, ys = nh.year;
  return round.hidden.map(p => {
    const ch = vin[p - 1];
    let text: string;
    if (p === 10) text = `Модельный год ${ys}: по таблице года (цикл 30 лет) ему соответствует символ «${ch}».`;
    else if (p === 9) { const c = checkSum(vin); text = `Контрольная цифра считается по остальным символам: сумма значений на веса позиций равна ${c.sum}, остаток от деления на 11 равен ${c.rem}${c.rem === 10 ? ', то есть X' : ''}.`; }
    else if (p <= 3) text = `Код производителя «${vin.slice(0, 3)}» означает «${d.maker}»${d.country ? ` (страна: ${d.country})` : ''}; символ ${p} равен «${ch}».`;
    else if (p === 11) text = `Код завода «${ch}» в таблице марки означает: ${d.plantWb ? d.plantWb.text : '—'}.`;
    else text = `Цифру на позиции ${p} можно найти из контрольной суммы: вес позиции ${WEIGHTS[p - 1]}, подходит только цифра «${ch}».`;
    return { pos: p, ch, text };
  });
}

// Подсказка для скрытой клетки: что это за позиция и какое правило, без значения
export function cellHint(round: Pick<Round, 'positions'>, p: number): string {
  const x = round.positions[p - 1], w = tr(x.what);   // сначала перевод, потом заглавная буква
  return `${tr('Позиция')} ${p} · ${tr(x.group)}\n${w[0].toUpperCase() + w.slice(1)}\n${tr('Правило: ')}${tr(x.rule)}`;
}
