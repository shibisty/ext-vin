import { describe, expect, it } from 'vitest';
import { generateVin, isCheckException, keyPositions, nhtsaDecode, nhtsaYears, setJsonLoader, wmiKey } from '../src/nhtsa';
import { checkDigit } from '../src/decode';
import { diskLoader, seedRandom } from './setup';

describe('ключи шаблонов', () => {
  it('позиции: символы 4–8 до «|», затем 10–17; «*» пропускается', () => {
    expect(keyPositions('*****|*G')).toEqual([11]);
    expect(keyPositions('[BFGS]')).toEqual([4]);
    expect(keyPositions('C*2')).toEqual([4, 6]);
  });
  it('WMI мелкосерийного производителя включает символы 12–14', () => {
    expect(wmiKey('1G9GDM9AXKP042788')).toBe('1G9042');
    expect(wmiKey('1HGCM82633A004352')).toBe('1HG');
  });
});

describe('офлайн-декодер vPIC', () => {
  it('Honda Accord 2003', async () => {
    const nh = (await nhtsaDecode('1HGCM82633A004352'))!;
    expect(nh.make).toBe('Honda');
    expect(nh.model).toBe('Accord');
    expect(nh.year).toBe(2003);
    expect(nh.matched).toBeGreaterThan(0);
    expect(nh.trace.length).toBeGreaterThan(0);
  });
  it('Tesla Model 3 2019', async () => {
    const nh = (await nhtsaDecode('5YJ3E1EA7KF317000'))!;
    expect([nh.make, nh.model, nh.year]).toEqual(['Tesla', 'Model 3', 2019]);
  });
  it('код производителя, которого нет в базе, даёт null', async () => {
    expect(await nhtsaDecode('XTA21099033567890')).toBeNull();
  });
  it('год по правилу NHTSA: цифра на 7-й позиции сдвигает на 30 лет назад', async () => {
    await nhtsaDecode('1HGCM82633A004352');   // загружает базу
    expect(nhtsaYears('1HGCM82633A004352')).toEqual({ rmy: 2003, omy: null, conclusive: true });
  });
  it('список исключений контрольной цифры', async () => {
    expect(await isCheckException('1C9FA2625R1257006')).toBe(true);
    expect(await isCheckException('1HGCM82633A004352')).toBe(false);
  });
  it('без initNhtsa загрузчик вызывается лениво; ошибка загрузки пробрасывается', async () => {
    setJsonLoader(() => Promise.reject(new Error('нет сети')));
    await expect(nhtsaDecode('1HGCM82633A004352')).rejects.toThrow('нет сети');
    setJsonLoader(diskLoader);
  });
});

describe('расширенные данные vPIC', () => {
  const extra = (nh: { extra?: { el: number; value: string; src: string }[] }, el: number) => (nh.extra || []).filter(x => x.el === el);
  it('формульные шаблоны: длина прицепа и число осей записаны цифрами в самом VIN', async () => {
    const nh = (await nhtsaDecode('1UYVS2534LU123456'))!;
    expect(nh.vtype).toBe('Trailer');
    expect(extra(nh, 118)).toMatchObject([{ value: '53', src: 'formula', positions: [7, 8] }]);
    // другие цифры на тех же позициях дают другую длину
    const nh2 = (await nhtsaDecode('1UYVS2484LU123456'))!;
    expect(extra(nh2, 118)[0].value).toBe('48');
  });
  it('Vehicle Specs: оснащение по модели и году, совпавшим ключам (кузов, комплектация)', async () => {
    const nh = (await nhtsaDecode('2T1BURHE0JC123456'))!;   // Corolla 2018
    expect(extra(nh, 86)).toMatchObject([{ value: 'Standard', src: 'spec' }]);   // ABS
    expect(extra(nh, 99)).toMatchObject([{ value: 'Standard', src: 'spec' }]);   // ESC
    expect(nh.filled).toContainEqual({ el: 25, src: 'spec' });   // класс полной массы — тоже из Vehicle Specs
    // у другого года схемы Vehicle Specs нет — оснащение не подставляется
    const old = (await nhtsaDecode('1HGCM82633A004352'))!;
    expect(extra(old, 86)).toEqual([]);
  });
  it('примечания (Note) собираются все, а не одно лучшее', async () => {
    const nh = (await nhtsaDecode('2T1BURHE0JC123456'))!;
    expect(extra(nh, 114).map(x => x.value).sort()).toEqual(['Curb Weight (lbs): 2840-2885', 'Manual Transmission / CVT']);
  });
  it('значение по умолчанию для типа ТС: у мотоцикла класс полной массы 1A', async () => {
    const nh = (await nhtsaDecode('1HD1KB4197Y123456'))!;
    expect(nh.vtype).toBe('Motorcycle');
    expect(nh.gvwr).toMatch(/^Class 1A/);
    expect(nh.filled).toContainEqual({ el: 25, src: 'default' });
  });
  it('страна завода показывается названием, а не кодом справочника', async () => {
    const nh = (await nhtsaDecode('1HGCM82633A004352'))!;
    expect(nh.plantCountry).toBe('UNITED STATES (USA)');
    expect(nh.trace.find(t => t.el === 75)!.value).toBe('UNITED STATES (USA)');
  });
  it('переводы строк в значениях заменяются пробелами, как в выдаче vPIC', async () => {
    const nh = (await nhtsaDecode('2T1BURHE0JC123456'))!;
    for (const x of nh.extra || []) expect(x.value).not.toMatch(/[\r\n\t]|\\[rnt]/);
  });
});

describe('генератор номеров', () => {
  it('выдаёт номер с верной контрольной цифрой и полной расшифровкой', async () => {
    const restore = seedRandom(42);
    try {
      for (const region of ['na', 'eu', 'as']) {
        const g = (await generateVin({ region }))!;
        expect(g).not.toBeNull();
        expect(g.vin).toMatch(/^[0-9A-HJ-NPR-Z]{17}$/);
        expect(g.vin[8]).toBe(checkDigit(g.vin));
        expect(g.nh.make && g.nh.model && g.nh.body).toBeTruthy();
        expect(g.nh.year).toBe(g.year);
      }
    } finally { restore(); }
  });
  it('регион задаёт первый символ', async () => {
    const restore = seedRandom(7);
    try {
      expect('12345').toContain((await generateVin({ region: 'na' }))!.vin[0]);
      expect('STUVWXYZ').toContain((await generateVin({ region: 'eu' }))!.vin[0]);
      expect('JKLMNPR').toContain((await generateVin({ region: 'as' }))!.vin[0]);
    } finally { restore(); }
  });
});
