// @vitest-environment happy-dom
// Сценарии попапа в DOM: разметка берётся из popup.html, модуль попапа импортируется поверх неё.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Round } from '../src/game';
import { seedRandom } from './setup';

interface GameState { round: Round | null; status: string; busy: boolean }
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const $$ = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];
const input = () => $<HTMLInputElement>('#vin');
const typeVin = (v: string) => { input().value = v; input().dispatchEvent(new Event('input')); };
const submit = (v: string) => { input().value = v; $<HTMLFormElement>('#form').dispatchEvent(new Event('submit', { cancelable: true })); };
const text = (sel: string) => $(sel).textContent || '';

const fetchMock = vi.fn(async (url: string) => {
  if (url.startsWith('https://api.nhtsa.gov/recalls/')) {
    return { ok: true, json: async () => ({ results: [
      { NHTSACampaignNumber: '03V001000', Component: 'AIR BAGS', ReportReceivedDate: '01/02/2003', Summary: 'Старая кампания' },
      { NHTSACampaignNumber: '05V002000', Component: 'BRAKES', ReportReceivedDate: '03/04/2005', Summary: 'Новая кампания', parkIt: true },
    ] }) } as Response;
  }
  return { ok: false, json: async () => null } as Response;   // Wikipedia и прочее: «нет сети»
});

beforeAll(async () => {
  const html = readFileSync(resolve(process.cwd(), 'popup.html'), 'utf8');
  document.body.innerHTML = /<body>([\s\S]*)<\/body>/.exec(html)![1].replace(/<script[\s\S]*?<\/script>/g, '');
  localStorage.setItem('lang', 'ru');
  vi.stubGlobal('fetch', fetchMock);
  globalThis.__VIN_TEST__ = true;
  await import('../src/popup');
});

describe('боковая панель', () => {
  it('вне расширения кнопка «Открыть в боковой панели» скрыта', () => {
    expect((document.getElementById('sidebarBtn') as HTMLButtonElement).hidden).toBe(true);
  });
});

describe('расшифровка', () => {
  it('полный VIN расшифровывается сам при вводе', async () => {
    typeVin('1hgcm82633a004352');
    await vi.waitFor(() => expect(text('#out')).toContain('NHTSA vPIC'));
    expect(input().value).toBe('1HGCM82633A004352');
    expect($$('#out .vin span')).toHaveLength(17);
    expect(text('#out')).toContain('По символам VIN');
    expect(text('#out')).toContain('Accord');
    // подсказка с правилом на каждом символе
    expect($$('#out .vin span')[8].title).toMatch(/^Позиция 9 · контрольная цифра/);
    expect($$('#out .vin span.bad')).toHaveLength(0);
  });
  it('неверная контрольная цифра подсвечивается', async () => {
    typeVin('WVWZZZ1JZ3W386752');
    await vi.waitFor(() => expect(text('#out')).toContain('NHTSA vPIC'));
    expect($$('#out .vin span.chk.bad')).toHaveLength(1);
    expect(text('#out')).toContain('Детали по марке');
  });
  it('частичный VIN — только по кнопке', async () => {
    typeVin('1HGCM8*6');
    await new Promise(r => setTimeout(r, 20));
    expect(text('#out')).not.toContain('Частичный VIN');
    submit('1HGCM8*6');
    await vi.waitFor(() => expect(text('#out')).toContain('Частичный VIN'));
  });
  it('ошибка ввода', async () => {
    submit('ABC');
    await vi.waitFor(() => expect($$('#out .error')).toHaveLength(1));
    expect(text('#out .error')).toBe('В VIN должно быть 17 символов, сейчас 3.');
  });
  it('номер кузова JDM и старый формат', async () => {
    submit('JZX100-6012345');
    await vi.waitFor(() => expect(text('#out')).toContain('Номер кузова JDM'));
    expect(text('#out')).toContain('Toyota Mark II, поколение 8');
    submit('BS23J0B275411');
    await vi.waitFor(() => expect(text('#out')).toContain('Старый VIN (до 1981)'));
  });
});

describe('оснащение NHTSA', () => {
  it('дополнительные элементы показываются по группам, свёрнутым блоком', async () => {
    submit('2T1BURHE0JC123456');
    await vi.waitFor(() => expect($$('#out details.nh-extra')).toHaveLength(1));
    const box = $('#out details.nh-extra');
    expect(box.querySelector('summary')!.textContent).toContain('Оснащение и характеристики');
    expect([...box.querySelectorAll('h3')].map(h => h.textContent)).toEqual(expect.arrayContaining(['Активная безопасность', 'Подушки безопасности']));
    expect(box.textContent).toContain('ABS');
    expect(box.textContent).toContain('Vehicle Specs: по модели и году');
    expect(text('#out')).toContain('Не по символам VIN, а по данным Vehicle Specs');
  });
});

describe('год NHTSA для европейского номера', () => {
  it('правило 7-го символа помечается как североамериканское, называется локальный год', async () => {
    submit('WAUZZZ8V5FA123456');
    await vi.waitFor(() => expect(text('#out')).toContain('NHTSA vPIC'));
    expect(text('#out')).toContain('Это правило для номеров Северной Америки; у этого номера вернее локальный расчёт — 2015');
  });
});

describe('вкладки', () => {
  it('«Правила» показывают таблицу по символам и шаблоны NHTSA', async () => {
    submit('1HGCM82633A004352');
    await vi.waitFor(() => expect(text('#out')).toContain('NHTSA vPIC'));
    $('[data-tab="rules"]').click();
    expect($('#tab-rules').hidden).toBe(false);
    expect($('#out').hidden).toBe(true);
    expect($$('#tab-rules .rules-table')).toHaveLength(2);
    expect(text('#tab-rules')).toContain('Источники данных');
  });
  it('«Отзывы» подставляют модель и сортируют кампании от новых', async () => {
    $('[data-tab="recalls"]').click();
    await vi.waitFor(() => expect($$('#tab-recalls details.recall')).toHaveLength(2));
    const inputs = $$('#tab-recalls .recall-form input') as HTMLInputElement[];
    expect(inputs.map(i => i.value)).toEqual(['Honda', 'Accord', '2003']);
    expect(text('#tab-recalls details.recall summary')).toMatch(/^05V002000/);
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('modelYear=2003'))).toBe(true);
  });
  it('«Генератор» выдаёт номер, который можно расшифровать', async () => {
    const restore = seedRandom(1);
    try {
      $('[data-tab="gen"]').click();
      await vi.waitFor(() => expect($$('#tab-gen .gen-vin')).toHaveLength(1));
    } finally { restore(); }
    const vin = text('#tab-gen .gen-vin');
    expect(vin).toMatch(/^[0-9A-HJ-NPR-Z]{17}$/);
    ($$('#tab-gen .gen-actions button')[0]).click();
    await vi.waitFor(() => expect(input().value).toBe(vin));
    await vi.waitFor(() => expect(text('#out')).toContain('NHTSA vPIC'));
  });
});

describe('игра', () => {
  it('правильные символы во всех клетках — победа и запись в статистику', async () => {
    const restore = seedRandom(3);
    try {
      $('[data-tab="game"]').click();
      const gm = globalThis.__vinGame as GameState;
      await vi.waitFor(() => expect(gm.round).not.toBeNull(), { timeout: 20_000 });
      const r = gm.round!;
      const cells = $$('#tab-game input.gcell') as HTMLInputElement[];
      expect(cells).toHaveLength(r.hidden.length);
      cells.forEach((c, i) => { c.value = r.vin[r.hidden[i] - 1].toLowerCase(); c.dispatchEvent(new Event('input')); });
      ($$('#tab-game .game-actions button')[0]).click();
      expect(gm.status).toBe('won');
      expect(text('#tab-game .game-status')).toMatch(/^Верно!/);
      expect(JSON.parse(localStorage.getItem('game')!)).toMatchObject({ played: 1, won: 1, streak: 1 });
    } finally { restore(); }
  });
});

describe('настройки', () => {
  it('переключение на английский переводит интерфейс и пересобирает расшифровку', async () => {
    $('[data-tab="decode"]').click();
    submit('1HGCM82633A004352');
    await vi.waitFor(() => expect(text('#out')).toContain('NHTSA vPIC'));
    const sel = $<HTMLSelectElement>('#langSel');
    sel.value = 'en';
    sel.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(text('#out')).toContain('Manufacturer'));
    expect(document.documentElement.lang).toBe('en');
    expect(text('h1')).not.toMatch(/[А-Яа-я]/);
    // блок оснащения тоже переведён целиком
    submit('2T1BURHE0JC123456');
    await vi.waitFor(() => expect(text('#out details.nh-extra summary')).toContain('Equipment and specifications'));
    expect(text('#out details.nh-extra')).not.toMatch(/[А-Яа-яЁё]/);
    expect(localStorage.getItem('lang')).toBe('en');
  });
  it('тема сохраняется и применяется', () => {
    const sel = $<HTMLSelectElement>('#themeSel');
    sel.value = 'dark';
    sel.dispatchEvent(new Event('change'));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('theme')).toBe('dark');
  });
});
