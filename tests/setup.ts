// Общая подготовка тестов: база NHTSA читается с диска (public/nhtsa), а не через fetch.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setJsonLoader } from '../src/nhtsa';
import { useMitchell } from '../src/decode';
import { MITCHELL } from '../src/mitchell';

// от корня проекта: в окружении happy-dom import.meta.url не файловый
const PUBLIC = resolve(process.cwd(), 'public') + '/';

/** Загрузчик JSON для тестов: пути вида './nhtsa/…' читаются из public/ */
export const diskLoader = async (path: string): Promise<unknown> => JSON.parse(await readFile(PUBLIC + path.replace(/^\.\//, ''), 'utf8'));

setJsonLoader(diskLoader);
// эталон снят с подключённым справочником Mitchell 1; тесты без него отключают пакет сами (tests/mitchell.test.ts)
useMitchell(MITCHELL);

/** Детерминированный Math.random (тот же LCG, что в скрипте эталона) */
export function seedRandom(seed: number): () => void {
  const orig = Math.random;
  let s = seed;
  Math.random = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  return () => { Math.random = orig; };
}

/** Дата, на которую снят эталон: от текущего года зависят правила модельного года */
export const GOLDEN_DATE = new Date('2026-11-10T21:00:00Z');
