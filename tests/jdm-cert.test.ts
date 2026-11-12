import { describe, expect, it } from 'vitest';
import { certConflict, certRows, decodeJdmCert } from '../src/jdm-cert';
import { decodeLocal } from '../src/decode';
import { jdmRules } from '../src/explain';
import type { JdmDecode } from '../src/types';

describe('префиксы с 2005 года (три символа)', () => {
  it('DAA — Prius ZVW30: нормы 2005, −75%, бензиновый гибрид, легковой', () => {
    expect(decodeJdmCert('DAA')).toEqual({
      scheme: '2005', regulation: 'нормы 2005 г., выбросы на 75% ниже нормы', fuel: 'бензин или LPG', hybrid: true,
      vehicle: 'легковой (кроме дизелей норм 2005 г.)', note: null,
    });
  });
  it('DBA и CBA различаются уровнем снижения выбросов', () => {
    expect(decodeJdmCert('DBA')!.regulation).toMatch(/75%/);
    expect(decodeJdmCert('CBA')!.regulation).toMatch(/50%/);
    expect(decodeJdmCert('ABA')!.regulation).toBe('нормы 2005 г.');
  });
  it('цифры в первом символе: нормы 2018 года (6AA — Yaris Hybrid)', () => {
    expect(decodeJdmCert('6AA')).toMatchObject({ regulation: 'нормы 2018 г., выбросы на 75% ниже', hybrid: true });
    expect(decodeJdmCert('3BA')!.regulation).toBe('нормы 2018 г.');
  });
  it('третий символ: дизель по массе, кей-грузовик, мотоцикл', () => {
    expect(decodeJdmCert('LDC')!.vehicle).toBe('легковой дизель норм 2005 г., масса свыше 1265 кг');
    expect(decodeJdmCert('EBD')!.vehicle).toBe('кей-кар (грузовой или автобус)');
    expect(decodeJdmCert('JBK')!.vehicle).toBe('мотоцикл 126–250 см³');
  });
  it('гибрид с подзарядкой и примечание о топливной экономичности', () => {
    expect(decodeJdmCert('DLA')).toMatchObject({ fuel: 'бензин или LPG + электричество', note: 'гибрид с подзарядкой от сети' });
    expect(decodeJdmCert('QKG')!.note).toMatch(/2015/);
  });
  it('электромобиль и машина на водороде: нормы не применяются (ZAA — Leaf)', () => {
    expect(decodeJdmCert('ZAA')).toMatchObject({ scheme: 'exempt', fuel: 'электричество (электромобиль)', vehicle: 'легковой' });
    expect(decodeJdmCert('ZBA')!.fuel).toBe('водород (топливные элементы)');
  });
  it('несуществующий код', () => {
    expect(decodeJdmCert('QQQ')).toBeNull();
    expect(decodeJdmCert('DIA')).toBeNull();
  });
});

describe('префиксы до 2005 года (один-два символа)', () => {
  it('E — нормы 1978, легковой (Supra JZA80: E-JZA80)', () => {
    expect(decodeJdmCert('E')).toMatchObject({ scheme: 'old', regulation: 'нормы 1978 г.', vehicle: 'легковой' });
  });
  it('GF — нормы холостого хода 1998', () => {
    expect(decodeJdmCert('GF')).toMatchObject({ regulation: 'нормы холостого хода 1998 г.', hybrid: false });
  });
  it('TA, LA, UA — нормы 2000 с разным уровнем снижения', () => {
    expect(['TA', 'LA', 'UA'].map(c => decodeJdmCert(c)!.regulation)).toEqual([
      'нормы 2000 г.; выбросы на 25% ниже норм 2000 г.', 'нормы 2000 г.; выбросы на 50% ниже норм 2000 г.', 'нормы 2000 г.; выбросы на 75% ниже норм 2000 г.',
    ]);
  });
  it('KH — дизельный легковой тяжелее 1265 кг, нормы 1998 (Land Cruiser 100: KH-HDJ101K)', () => {
    expect(decodeJdmCert('KH')).toMatchObject({ regulation: 'нормы 1998 г.', fuel: 'дизель', vehicle: 'легковой, масса свыше 1265 кг' });
  });
  it('пары кодов «обычный — гибрид» сходятся по нормам и классу', () => {
    for (const [plain, hybrid] of [['KE', 'HA'], ['DA', 'WA'], ['TA', 'XA'], ['LM', 'YM'], ['PR', 'VR']]) {
      const a = decodeJdmCert(plain)!, b = decodeJdmCert(hybrid)!;
      expect([a.regulation, a.vehicle, a.hybrid]).toEqual([b.regulation, b.vehicle, false]);
      expect(b.hybrid).toBe(true);
    }
  });
});

describe('номер кузова с префиксом', () => {
  it('расшифровка префикса попадает в результат и в правила', () => {
    const d = decodeLocal('DAA-ZVW30-1234567') as JdmDecode;
    expect(d.certInfo).toMatchObject({ scheme: '2005', hybrid: true });
    const rows = jdmRules(d);
    expect(rows.map(r => r[0])).toEqual(expect.arrayContaining(['Префикс сертификации', 'Нормы выбросов', 'Топливо', 'Тип машины по сертификации']));
    expect(rows.find(r => r[0] === 'Проверка префикса')).toBeUndefined();
  });
  it('без префикса — без расшифровки', () => {
    expect((decodeLocal('JZX100-6012345') as JdmDecode).certInfo).toBeNull();
  });
  it('префикс «не гибрид» у гибридного кода Toyota — предупреждение', () => {
    const d = decodeLocal('DBA-ZVW30-1234567') as JdmDecode;
    expect(certConflict(d.certInfo, d.toyota)).toEqual(['Проверка префикса', 'не сходится с кодом модели', expect.stringContaining('«не гибрид»')]);
    expect(jdmRules(d).some(r => r[0] === 'Проверка префикса')).toBe(true);
  });
  it('строки таблицы: источник называет схему', () => {
    expect(certRows('GF', decodeJdmCert('GF')!)[0][2]).toMatch(/до 2004 года/);
    expect(certRows('DBA', decodeJdmCert('DBA')!)[0][2]).toMatch(/с 2005 года/);
  });
});
