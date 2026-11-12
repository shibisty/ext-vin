// Префикс сертификации японского номера кузова: нормы выбросов, топливо и тип машины.
import { CERT_C1, CERT_C2, CERT_C3, CERT_EXEMPT_C2, CERT_EXEMPT_C3, CERT_FUEL, CERT_OLD_CLASSES, CERT_OLD_RAW, CERT_OLD_REGS } from './data/jdm-cert';
import type { Row } from './types';

export interface CertInfo {
  /** «2005» — три символа (с 2005 года), «old» — один-два символа (до 2005), «exempt» — без норм по выбросам */
  scheme: '2005' | 'old' | 'exempt';
  regulation: string;
  fuel: string | null;
  hybrid: boolean | null;
  vehicle: string;
  note: string | null;
}

interface OldEntry { reg: number; fuel: string; hybrid: boolean | null; cls: number }
let OLD: Map<string, OldEntry> | null = null;
function oldTable(): Map<string, OldEntry> {
  if (!OLD) {
    OLD = new Map();
    for (const item of CERT_OLD_RAW.split(' ')) {
      const [code, reg, fuel, hyb, cls] = item.split(':');
      OLD.set(code, { reg: +reg, fuel, hybrid: hyb === '-' ? null : hyb === '1', cls: +cls });
    }
  }
  return OLD;
}

export function decodeJdmCert(raw: string | null | undefined): CertInfo | null {
  const c = String(raw || '').toUpperCase();
  if (c.length === 3) {
    if (c[0] === 'Z' && CERT_EXEMPT_C2[c[1]] && CERT_EXEMPT_C3[c[2]]) {
      return { scheme: 'exempt', regulation: 'нормы по выбросам не применяются', fuel: CERT_EXEMPT_C2[c[1]], hybrid: false, vehicle: CERT_EXEMPT_C3[c[2]], note: null };
    }
    const r = CERT_C1[c[0]], f = CERT_C2[c[1]], v = CERT_C3[c[2]];
    if (!r || !f || !v) return null;
    return { scheme: '2005', regulation: r, fuel: f[0], hybrid: f[1], vehicle: v, note: f[2] || null };
  }
  if (c.length === 1 || c.length === 2) {
    const e = oldTable().get(c);
    if (!e) return null;
    return { scheme: 'old', regulation: CERT_OLD_REGS[e.reg], fuel: CERT_FUEL[e.fuel] || null, hybrid: e.hybrid, vehicle: CERT_OLD_CLASSES[e.cls], note: null };
  }
  return null;
}

/** Противоречие префикса и структуры кода Toyota (гибрид или нет) */
export function certConflict(info: CertInfo | null, toyota: string | null): Row | null {
  if (!info || !toyota || info.hybrid == null || info.scheme === 'exempt') return null;
  const codeHybrid = toyota.startsWith('гибрид') || /; гибрид$/.test(toyota);
  const codeKnown = codeHybrid || /^(бензин|дизель)/.test(toyota) || /; (бензин|бензин\/дизель|электро)$/.test(toyota);
  if (!codeKnown || codeHybrid === info.hybrid) return null;
  return ['Проверка префикса', 'не сходится с кодом модели', info.hybrid
    ? 'префикс говорит «гибрид», а структура кода Toyota — «без гибрида»: номер набран с ошибкой или префикс от другой машины'
    : 'префикс говорит «не гибрид», а структура кода Toyota — «гибрид»: номер набран с ошибкой или префикс от другой машины'];
}

/** Строки для таблицы расшифровки */
export function certRows(cert: string, info: CertInfo): Row[] {
  const src = info.scheme === 'old' ? 'таблица МЛИТ Японии для норм до 2004 года' : 'таблица МЛИТ Японии для норм с 2005 года';
  const rows: Row[] = [['Нормы выбросов', info.regulation, `по префиксу «${cert}»: ${src}`]];
  if (info.fuel) rows.push(['Топливо', info.fuel + (info.hybrid ? ', гибрид' : ''), info.note]);
  else if (info.hybrid) rows.push(['Гибрид', 'да', null]);
  rows.push(['Тип машины по сертификации', info.vehicle, null]);
  return rows;
}
