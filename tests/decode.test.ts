import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkDigit, decodeJdm, decodeLocal, isIso, normalize, plantTable, useMitchell, wmiByMaker } from '../src/decode';
import { MITCHELL } from '../src/mitchell';
import type { IsoDecode, JdmDecode, LegacyDecode, PartialDecode } from '../src/types';

const iso = (v: string): IsoDecode => {
  const d = decodeLocal(v);
  if (!isIso(d)) throw new Error(`${v}: ожидалась ISO-расшифровка`);
  return d;
};

describe('normalize', () => {
  it('убирает пробелы, дефисы и подчёркивания, переводит в верхний регистр', () => {
    expect(normalize(' wvw-zzz_1jz 3w ')).toBe('WVWZZZ1JZ3W');
  });
});

describe('checkDigit (ISO 3779)', () => {
  it('считает контрольную цифру известного VIN', () => {
    expect(checkDigit('1HGCM82633A004352')).toBe('3');
    expect(checkDigit('11111111111111111')).toBe('1');
  });
  it('остаток 10 записывается как X', () => {
    // подбираем номер с остатком 10: меняем серийный номер, пока не выйдет X
    let vin = '';
    for (let n = 0; n < 1000 && !vin; n++) {
      const v = '1M8GDM9A0KP' + String(n).padStart(6, '0');
      if (checkDigit(v) === 'X') vin = v;
    }
    expect(vin).not.toBe('');
  });
});

describe('decodeLocal: полный VIN', () => {
  it('Honda, США: регион, страна, производитель, год, контрольная цифра', () => {
    const d = iso('1HGCM82633A004352');
    expect(d.wmi).toBe('1HG');
    expect(d.region).toBe('Северная Америка');
    expect(d.country).toBe('США');
    expect(d.maker).toMatch(/Honda/);
    expect(d.check).toEqual({ actual: '3', expected: '3', ok: true });
    expect(d.serial).toBe('004352');
  });
  it('Северная Америка: цифра на 7-й позиции означает год до 2010', () => {
    expect(iso('1HGCM82633A004352').year).toEqual({ value: 2003, alt: null });
  });
  it('Европа: несовпадение контрольной цифры не считается ошибкой номера', () => {
    const d = iso('WVWZZZ1JZ3W386752');
    expect(d.region).toBe('Европа');
    expect(d.country).toBe('Германия');
    expect(d.maker).toMatch(/Volkswagen/);
    expect(d.check.ok).toBe(false);
    expect(d.errors).toEqual([]);
  });
  it('находит детали по марке в таблицах', () => {
    expect(iso('WVWZZZ1JZ3W386752').brandSource).toBe('Mitchell 1 и Wikibooks');
  });
  it('мелкосерийный производитель: код продолжается в позициях 12–14', () => {
    const d = iso('1G9GDM9AXKP042788');
    expect(d.smallMaker).toBe(true);
    expect(d.smallMakerCode).toBe('042');
  });
});

describe('decodeLocal: ошибки и частичные номера', () => {
  it('сообщает о неверной длине', () => {
    expect(decodeLocal('ABC').errors).toEqual(['В VIN должно быть 17 символов, сейчас 3.']);
  });
  it('сообщает о недопустимых символах I, O, Q', () => {
    expect(decodeLocal('WVWZZZ1JZ3W38675I').errors[0]).toMatch(/Недопустимые символы: I\./);
  });
  it('частичный VIN со «*»: только известные позиции', () => {
    const d = decodeLocal('1HGCM8*6') as PartialDecode;
    expect(d.partial).toBe(true);
    expect(d.wmi).toBe('1HG');
    expect(d.country).toBe('США');
    expect(d.year).toBeUndefined();
  });
  it('у частичного VIN без WMI нет производителя', () => {
    const d = decodeLocal('1H*CM82633') as PartialDecode;
    expect(d.partial).toBe(true);
    expect(d.wmi).toBeUndefined();
    expect(d.year).toEqual({ value: 2003, alt: null });
  });
});

describe('номера кузова JDM', () => {
  it('код модели и серийный номер', () => {
    const d = decodeLocal('JZX100-6012345') as JdmDecode;
    expect(d.jdm).toBe(true);
    expect(d.code).toBe('JZX100');
    expect(d.serial).toBe('6012345');
    // по японской Википедии код JZX100 указан у Cresta и Mark II (у Chaser — только серия X100, она идёт в ход, когда прямых совпадений нет)
    expect(d.wiki!.map(w => [w.model, w.gen, w.years])).toEqual([['Toyota Cresta', 5, '1996–2001'], ['Toyota Mark II', 8, '1996–2001']]);
    expect(d.match).toBeNull();   // таблица по памяти — только если в Википедии кода нет
  });
  it('префикс сертификации', () => {
    const d = decodeJdm('DBA-ZVW30-1234567')!;
    expect(d.cert).toBe('DBA');
    expect(d.wiki![0].model).toMatch(/^Toyota Prius/);
  });
  it('японская Википедия: «#» в коде — любая цифра, буквенный хвост кода необязателен', () => {
    expect(decodeJdm('ANH10-0012345')!.wiki![0].model).toBe('Toyota Alphard');      // в Википедии «ANH1#W»
    expect(decodeJdm('UZJ100-0012345')!.wiki!.map(w => w.model)).toContain('Toyota Land Cruiser');   // «UZJ100W»
    expect(decodeJdm('HA36S-123456')!.wiki).toEqual([{ brand: 'Suzuki', model: 'Suzuki Alto', gen: 8, years: '2014–2021', article: 'スズキ・アルト (8代目)' }]);
    // серия Toyota: «E3#/5#型» у Corolla третьего поколения -> TE51
    expect(decodeJdm('TE51-123456')!.wiki!.map(w => [w.model, w.gen])).toEqual([['Toyota Corolla', 3]]);
    // серия не перебивает прямое совпадение чужой марки
    expect(decodeJdm('BNR34-000123')!.wiki!.map(w => w.model)).toEqual(['Nissan Skyline GT-R']);
  });
  it('кода нет в Википедии — таблица по памяти; буквенные коды Subaru распознаются', () => {
    const d = decodeJdm('HDJ80-1234567')!;
    expect(d.wiki).toBeNull();
    expect(d.match!.model).toBe('Land Cruiser (80)');
    // «SCP/NCP/NLP1#型» в Википедии: общий хвост у нескольких кодов
    expect(decodeJdm('KSP90-1234567')!.wiki!.map(w => [w.model, w.gen])).toContainEqual(['Toyota Vitz', 2]);
    expect(decodeJdm('GDB-012345')!.match!.model).toBe('Impreza WRX STI');
    expect(decodeJdm('ABC-123456')).toBeNull();   // неизвестный буквенный код — не номер кузова
  });
  it('не JDM без дефиса', () => {
    expect(decodeJdm('JZX1006012345')).toBeNull();
  });
});

describe('старые номера (до 1981)', () => {
  it('Chrysler 1968–1980, 13 символов', () => {
    const d = decodeLocal('BS23J0B275411') as LegacyDecode;
    expect(d.legacy).toBe(true);
    expect(d.format).toMatch(/^Chrysler Corporation/);
    expect(d.segments.at(-1)).toEqual(['serial', 7, 13, 'серийный номер']);
  });
  it('Ford 1965–1980, 11 символов: цифра года даёт два варианта', () => {
    const d = decodeLocal('0F02G100001') as LegacyDecode;
    expect(d.format).toMatch(/^Ford Motor Company/);
    expect(d.rows.find(r => r[0] === 'Модельный год')![1]).toBe('1970 или 1980');
  });
  it('GM 1965–1975: серия, кузов и двигатель по таблицам tpocr.com', () => {
    const row = (v: string, k: string) => (decodeLocal(v) as LegacyDecode).rows.find(r => r[0] === k)!;
    expect(row('242677P100001', 'Серия').slice(1)).toEqual(['GTO (42)', 'по таблицам tpocr.com']);
    expect(row('242677P100001', 'Кузов')[1]).toBe('кабриолет (67)');
    expect(row('136370L100001', 'Серия')[2]).toContain('только модельный ряд');           // Chevrolet до 1971: модель по 2-му символу
    expect(row('335779M100001', 'Серия')[1]).toBe('Cutlass: 2 дв. Sport купе S (3577)');   // Oldsmobile до 1969: серия и кузов одним кодом
    expect(row('2D37P3P100001', 'Двигатель')[1]).toBe('8 цил., 400 cid (6,6 л), карб. 4 камеры, двойной выпуск');
    expect(row('683471Q100001', 'Серия')[1]).toBe('2 дв. купе DeVille (8347)');
  });
  it('AMC 1966–1975 по таблицам tpocr.com: две раскладки позиций', () => {
    const row = (v: string, k: string) => (decodeLocal(v) as LegacyDecode).rows.find(r => r[0] === k)!;
    const old = decodeLocal('A7KM97Q100001') as LegacyDecode;                          // 1966–1967: завод и коробка
    expect(old.format).toBe('American Motors Corporation, 1966–1967 (13 символов)');
    expect(row('A7KM97Q100001', 'Завод')[1]).toBe('Кеноша, Висконсин (K)');
    expect(row('A7KM97Q100001', 'Двигатель')[1]).toBe('8 цил., 343 cid (5,6 л), карб. 4 камеры, Hi Comp. (серия Ambassador) (Q)');
    expect(row('A2A859P100001', 'Серия')[1]).toBe('Ambassador (8)');                     // с 1968: коробка, серия, кузов, модель, двигатель
    expect(row('A2A859P100001', 'Коробка')[1]).toBe('автомат, рычаг на рулевой колонке (A)');
    expect(row('A9M797X100001', 'Модельный год')[1]).toBe('1969 или 1979');
    expect(row('A9M797X100001', 'Серия')[1]).toBe('1969: Javelin (7)');
  });
  it('Chrysler 1966–1975: марка, серия, кузов и двигатель по таблицам tpocr.com', () => {
    const row = (v: string, k: string) => (decodeLocal(v) as LegacyDecode).rows.find(r => r[0] === k)!;
    expect(row('RM23H7G100001', 'Модельный ряд')[1]).toBe('Plymouth Belvedere, Satellite');
    expect(row('RM23H7G100001', 'Двигатель')[1]).toBe('8 цил., 383 cid (6,3 л), карб. 4 камеры, форсированный');
    expect(row('RM23H7G100001', 'Модельный год')[1]).toBe('1967');
    expect(row('XP29J9B100001', 'Модельный ряд')[1]).toBe('1969: Dodge Charger; 1979: Magnum или Charger');   // 1979 — по MoTales
    expect(row('XP29J9B100001', 'Двигатель')[2]).toContain('по таблицам tpocr.com и MoTales');
  });
  it('BMW 02: номер шасси из 7 цифр по диапазонам рынка США', () => {
    const d = decodeLocal('2760847') as LegacyDecode;
    const row = (k: string) => d.rows.find(r => r[0] === k)!;
    expect(d.format).toBe('BMW 02, номер шасси (7 цифр)');
    expect(row('Модель')[1]).toBe('BMW 2002tii');
    expect(row('Модельный год')[1]).toBe('1972');
    expect(row('Выпуск')[1]).toBe('01.1972–12.1972');
    expect((decodeLocal('2532200') as LegacyDecode).rows.find(r => r[0] === 'Модель')![1]).toBe('BMW 2002 с автоматом');
    expect((decodeLocal('1652000') as LegacyDecode).rows.find(r => r[0] === 'Рынок')![1]).toBe('кроме США');
    expect((decodeLocal('1234567') as LegacyDecode).legacy).toBeUndefined();            // вне диапазонов
  });
  it('Porsche 356: номер шасси по каталогам Porsche Classic (без пакета Mitchell 1)', () => {
    useMitchell(null);
    try {
    const row = (v: string, k: string) => (decodeLocal(v) as LegacyDecode).rows.find(r => r[0] === k)!;
    expect((decodeLocal('215500') as LegacyDecode).format).toBe('Porsche 356, номер шасси (1950–1965)');
    expect(row('215500', 'Модель и кузов')[1]).toBe('Porsche 356 C купе (Karmann)');
    expect(row('215500', 'Модельный год')[1]).toBe('1964');
    expect(row('82181', 'Модельный год')[1]).toBe('1956 или 1957');                    // сводки каталога расходятся
    expect(row('5015', 'Модель и кузов')[1]).toContain('Porsche 356 кабриолет');
    } finally { useMitchell(MITCHELL); }
  });
  it('Porsche 356 и Volvo: голый номер с пакетом Mitchell 1 остаётся Volvo, 356 — вариантом', () => {
    const d = decodeLocal('123456') as LegacyDecode;
    expect(d.format).toBe('Volvo');
    expect(d.rows.find(r => r[0] === 'Другой вариант')![1]).toBe('Porsche 356 B купе, 1963');
  });
  it('Cadillac 1965–1970, 8 символов', () => {
    const d = decodeLocal('J8123456') as LegacyDecode;
    expect(d.format).toBe('Cadillac, 1965–1970 (8 символов)');
    expect(d.rows.find(r => r[0] === 'Модель и кузов')![1]).toBe('Coupe DeVille (J)');
    expect(d.rows.find(r => r[0] === 'Модельный год')![1]).toBe('1968');
    expect((decodeLocal('Q8123456') as LegacyDecode).legacy).toBeUndefined();           // буквы Q в таблицах нет
  });
  it('Ford 1965–1975: кузов и двигатель по таблицам tpocr.com, без пакета Mitchell', () => {
    const d = decodeLocal('7R01C100001') as LegacyDecode;
    const row = (k: string) => d.rows.find(r => r[0] === k)!;
    expect(row('Серия кузова')[1]).toBe('1967: Ford — Mustang: хардтоп; Mercury/Lincoln — Comet 202: 2 дв. седан');
    expect(row('Серия кузова')[2]).toContain('по таблицам tpocr.com');
    expect(row('Двигатель')[1]).toMatch(/^1967: 8 цил\., 289 cid \(4,7 л\), карб\. 2 камеры/);
    const big = decodeLocal('5F01R100001') as LegacyDecode;
    expect(big.rows.find(r => r[0] === 'Двигатель')![1]).toBe('1965: 8 цил., 427 cid (7,0 л), 2 карб. по 4 камеры, форсированный');
    const one = decodeLocal('2U54H100001') as LegacyDecode;                 // 1972: год однозначный, префикса года нет
    expect(one.rows.find(r => r[0] === 'Серия кузова')![1]).toMatch(/^Ford — 4 дв\. седан Galaxie 500; Mercury\/Lincoln — /);
    expect(one.rows.find(r => r[0] === 'Двигатель')![1]).toBe('8 цил., 351 cid (5,8 л), карб. 2 камеры');
  });
});

describe('модельный год зависит от текущей даты', () => {
  afterEach(() => { vi.useRealTimers(); });
  it('вне Северной Америки берётся поздний вариант, не позднее следующего года', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-01'));
    // символ года «A»: 1980 или 2010
    expect(iso('WVWZZZ1JZAW386752').year).toEqual({ value: 2010, alt: 1980 });
    // символ «Y»: 2000 или 2030 — 2030 ещё не наступил
    expect(iso('WVWZZZ1JZYW386752').year).toEqual({ value: 2000, alt: null });
  });
});

describe('словари WMI: расхождения и мелкосерийные производители', () => {
  it('у кода несколько строк в Википедии — показываются все (SAD: Daimler до 1987 и Jaguar SUV)', () => {
    expect(iso('SADCA2AN1JA123456').maker).toBe('Daimler until April 1987; Jaguar SUV');
  });
  it('мелкосерийный производитель находится по шести символам (WMI и символы 12–14)', () => {
    const d = iso('SA9BBB11X1A048123');
    expect(d.maker).toBe('McLaren F1');
    expect(d.makerSrc).toMatch(/12–14/);
    // код, которого нет в словаре: общая строка с перечнем производителей, а не случайный из них
    expect(iso('SA9BBB11X1A999123').maker).toMatch(/Morgan Motor Company; OX Global/);
  });
  it('код с 9 на третьем месте без строки в Википедии не берёт случайное название из vininfo', () => {
    expect(iso('1G9GDM9AXKP042788').maker).not.toBe('Google');
  });
  it('если словари называют разные марки, расхождение показывается', () => {
    const d = iso('JTNKARJE5JJ123456');
    expect(d.maker).toBe('Toyota car');
    expect(d.makerAlt).toEqual([['Scion', 'vininfo']]);
    // одна и та же марка разными словами — не расхождение
    expect(iso('1HGCM82633A004352').makerAlt).toBeUndefined();
  });
  it('TMK — Karosa (Iveco Czech Republic), не Kia', () => {
    expect(iso('TMKAAAAAAAA123456').maker).toBe('Karosa');
  });
});

describe('заводы старых американских номеров (Wikibooks)', () => {
  const rows = (v: string) => { const d = decodeLocal(v) as LegacyDecode; return d.rows; };
  const plant = (v: string) => rows(v).find(r => r[0].startsWith('Завод'))!;
  it('GM: завод выбирается по годам его работы', () => {
    expect(plant('1Q87Q5U100001')).toEqual(['Завод', 'Lordstown, OH (1966-1978) (U)', 'по таблице заводов GM в Wikibooks, с учётом годов работы завода']);
    expect(plant('1Q87L4N100001')[1]).toMatch(/^Norwood/);
  });
  it('Ford и Chrysler: подтверждённый код и код без первоисточника различаются', () => {
    expect(plant('0F02G100001')[2]).toBe('под этой буквой тот же завод и в таблице Wikibooks');
    expect(plant('5L02D100001')[2]).toMatch(/^по справочнику без первоисточника.*Michigan Assembly/);
    expect(plant('RH23G5X100001')[1]).toMatch(/^St\. Louis #2/);   // код X раньше отсутствовал
  });
  it('Mercedes W123: тип топлива по 4-й цифре подтверждён справочником Mitchell 1', () => {
    const r = rows('12312312012345').find(x => x[0] === 'Тип топлива')!;
    expect(r[1]).toBe('дизель');
    expect(r[2]).toMatch(/Mitchell 1/);
  });
});

describe('помощники игры', () => {
  it('обратный поиск WMI по названию производителя', () => {
    const maker = iso('1HGCM82633A004352').maker!;
    expect(wmiByMaker(maker)).toContain('1HG');
  });
  it('таблица заводов по марке', () => {
    const t = plantTable('Volkswagen car', 'WVW');
    expect(t && t.key).toBe('vw');
    expect(t && t.map.W).toMatch(/Wolfsburg/);
  });
});

describe('мотоциклы Bajaj и Dafra (vininfo)', () => {
  const rows = (v: string) => Object.fromEntries((iso(v).brandDetails || []).map(r => [r[0], r[1]]));
  it('Bajaj India: модель и завод', () => {
    expect(iso('MD2A67AZ5PCC12345').brandSource).toBe('vininfo (мотоциклы)');
    expect(rows('MD2A67AZ5PCC12345')).toMatchObject({ 'Марка': 'Bajaj', 'Модель (4–6-й символы)': 'Dominar 400', 'Тип': 'мотоцикл', 'Завод (11-й символ)': 'Чакан, Индия (C)' });
  });
  it('Bajaj Бразилия: с 2026 модельного года другие названия', () => {
    expect(rows('92TA92BZ8TM123456')['Модель (4–6-й символы)']).toBe('Dominar NS160');   // T = 2026
    expect(rows('92TA92BZ8NM123456')['Модель (4–6-й символы)']).toBe('Dominar 160');     // N = 2022
  });
  it('Dafra: собственные модели и сборка Bajaj', () => {
    expect(rows('95VCA1AB2JM012345')).toMatchObject({ 'Марка': 'Dafra', 'Модель (4–5-й символы)': 'Speed 150', 'Завод (11-й символ)': 'Манаус, Бразилия (M)' });
    expect(rows('95V2A1AA5LM012345')).toMatchObject({ 'Марка': 'Bajaj', 'Модель (4–6-й символы)': 'Dominar 160' });
  });
  it('неизвестный код модели показывается кодом', () => {
    expect(rows('MD2ZZZAZ5PCC12345')['Модель (4–6-й символы)']).toBe('код ZZZ');
  });
});

describe('Peugeot, европейский формат (Wikibooks)', () => {
  const rows = (v: string) => Object.fromEntries((iso(v).brandDetails || []).map(r => [r[0], r[1]]));
  it('модельная линия по 4-му символу', () => {
    expect(rows('VF38DRHR0BL067462')['Модельная линия (4-й символ)']).toBe('Peugeot 406 или 508');
    expect(rows('VR3UHZKX9PT123456')['Модельная линия (4-й символ)']).toBe('Peugeot 2008');
  });
  it('предупреждает, что до 2009 года 10-й символ мог быть заводом', () => {
    expect(iso('VF3MCYHZ9HS123456').brandDetails!.find(r => r[0] === 'Формат номера')![2]).toMatch(/до 2009/);
  });
  it('американский формат 1981–1992 (Сошо, S) оставлен базе NHTSA', () => {
    expect(iso('VF3BA1657FS123456').brandSource).toBeNull();
  });
});

describe('заводы бывшего СССР: индекс модели и WMI (русская Википедия)', () => {
  const row = (v: string, label: string) => (iso(v).brandDetails || []).find(r => r[0].startsWith(label));
  it('ВАЗ: 4–9-й символы — модель с модификацией (пример из заводского руководства)', () => {
    expect(row('XTA21099033567890', 'Модель по индексу')![1]).toBe('ВАЗ-21099');
    expect(row('XTA211440E1234567', 'Модель по индексу')![1]).toBe('ВАЗ-2114');
    expect(row('XTA211440E1234567', 'Остальные цифры')![1]).toBe('40');
    expect(row('XTA217230F0267649', 'Модель по индексу')![2]).toContain('Lada Priora');
    expect(row('XTA217230F0267649', '11–17')![1]).toBe('0267649');
  });
  it('тип по второй цифре индекса', () => {
    expect(row('X96330200A1234567', 'Тип по индексу')![1]).toBe('грузовой автомобиль');
    expect(row('XTT315195A1234567', 'Модель по индексу')![1]).toBe('УАЗ-315195');
  });
  it('XTM: МАЗ или ПАЗ (код ПАЗ 1986–1997)', () => {
    expect(row('XTM320500T1234567', 'Модель по индексу')![1]).toBe('ПАЗ-3205');
  });
  it('неизвестный индекс и буквенный VDS', () => {
    expect(row('XTA999990Y0123456', 'Индекс модели')![2]).toContain('не нашлось');
    expect(iso('XTAGFL110KY123456').brandSource).toBe('vininfo');
  });
  it('WMI: мелкие заводы по шести символам и заводы, которых нет в других словарях', () => {
    expect(iso('X8912345678AA3123').maker).toContain('Ряжский');
    expect(iso('X1G75470N0123456'.padEnd(17, '0')).maker).toContain('МоАЗ');
    expect(iso('X1R75131N0123456'.padEnd(17, '0')).maker).toContain('БелАЗ');
  });
});

describe('Caterham и сборка Kia в Мьянме (Wikibooks)', () => {
  const row = (v: string, label: string) => (iso(v).brandDetails || []).find(r => r[0].startsWith(label));
  it('Caterham: год по 10–11-му символам с 2010, коробка и комплектация', () => {
    expect(row('SDKRCKSD1170C1234', 'Год выпуска')![1]).toBe('2017');
    expect(row('SDKRCKSD1170C1234', 'Двигатель')![1]).toContain('Ford Duratec 2.0');
    expect(row('SDKLCK3GT20000123', 'Год выпуска')![1]).toBe('2002 или 2020');
    expect(row('SDKLCK3GTY0000123', 'Год выпуска')![1]).toBe('2000');
  });
  it('Kia Myanmar: форматы 2017 и 2019 годов, Super Seven Stars', () => {
    expect(row('MS0BD41A6LY614028', 'Модель')![1]).toBe('Kia Cerato (BD)');
    expect(row('MS0BD41A6LY614028', 'Двигатель')![1]).toContain('1.6');
    expect(row('MS0GU41B4HY614028', 'Модель')![1]).toBe('Kia Optima (G)');
    expect(row('MS0DA21B2LY614028', 'Марка')![1]).toBe('Kia (D)');
    expect(row('MS1WR4097SY000001', 'Модель')![1]).toBe('LS6 (WR)');
  });
});
