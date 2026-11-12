// Язык интерфейса: русский (исходные строки в коде) или английский (перевод подстановкой).
import { EN as EN_MAIN } from './data/i18n-en';
import { EN_EXTRA } from './data/i18n-en-extra';
import { NH_EXTRA_EN } from './data/nhtsa-elements';
import { USSR_EN } from './data/ussr';

// основной словарь важнее: дополнения не меняют уже переведённые фразы
const EN: Record<string, string> = { ...USSR_EN, ...NH_EXTRA_EN, ...EN_EXTRA, ...EN_MAIN };

export type Lang = 'ru' | 'en';

const CYR = /[А-Яа-яЁё]/;
let lang: Lang = 'ru';
let RE: RegExp | null = null;
export const getLang = (): Lang => lang;
export function setLang(l: string | null | undefined): void { lang = l === 'en' ? 'en' : 'ru'; }

function build(): RegExp {
  const keys = Object.keys(EN).filter(k => k.length).sort((a, b) => b.length - a.length);
  // у ключей, начинающихся или заканчивающихся буквой, проверяем границу слова, чтобы не заменять часть слова
  const part = (k: string) => (/^[А-Яа-яЁё]/.test(k) ? '(?<![А-Яа-яЁё])' : '') + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + (/[А-Яа-яЁё]$/.test(k) ? '(?![А-Яа-яЁё])' : '');
  return new RegExp(keys.map(part).join('|'), 'g');
}
// Строка на русском -> строка на выбранном языке. Незнакомые фрагменты остаются как есть.
export function tr(s: string): string;
export function tr(s: string | null | undefined): string | null | undefined;
export function tr(s: string | null | undefined): string | null | undefined {
  if (lang === 'ru' || s == null) return s;
  s = String(s);
  if (!CYR.test(s)) return s;
  if (!RE) RE = build();
  return s.replace(RE, m => EN[m]);
}
