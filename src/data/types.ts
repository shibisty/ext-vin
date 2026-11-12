// Типы справочных таблиц. Сами таблицы сгенерированы из внешних источников (см. NOTICE.txt) и хранятся как литералы.

export type Dict<T = string> = Record<string, T>;

// vininfo: описание одной позиции VIN у марки
export interface FieldSpec {
  label: string;
  /** срез символов [от, до) */
  src: [number, number];
  defs?: Dict<string | string[]>;
  /** значения зависят от кода модели */
  by?: 'model';
  maps?: Dict<Dict<string | string[]>>;
}
export type BrandSpec = {
  model: FieldSpec;
  /** поля, которые не показываются в таблице */
  _hide?: string[];
  /** 9-й символ у марки не контрольная цифра */
  _noSaeCheck?: boolean;
  /** позиция символа года (с нуля), если не 10-я */
  _yearPos?: number;
} & { [field: string]: FieldSpec | string[] | boolean | number | undefined };

/** [название, год с, год по] */
export type YearSpanEntry = [string, number, number];
/** [описание, годы] */
export type DescYears = [string, string];

// Mitchell 1: американские таблицы 1974–1980
export interface LegacyYear { s: Dict; e: Dict; b: Dict }
export interface UsLegacy {
  gm: Dict<Dict<LegacyYear>>;
  ford: Dict<{ s: Dict; e: Dict }>;
  amc: Dict<{ t: Dict; s: Dict; b: Dict; m: Dict; e: Dict }>;
}
/** [серийный от, серийный до, год, модель] */
export type FordSerialRange = [string, string, number, string];
export interface UsTrucks {
  ford: Dict<{ s: Dict; e: Dict }>;
  ford_serial: FordSerialRange[];
  chevrolet: Dict<{ c: Dict; e: Dict; s: Dict; b: Dict }>;
  gmc: Dict<{ c: Dict; e: Dict; s: Dict; b: Dict }>;
  dodge: Dict<{ m: Dict; b: Dict; g: Dict; e: Dict }>;
  plymouth: Dict<{ m: Dict; b: Dict; g: Dict; e: Dict }>;
  jeep: Dict<{ t: Dict; s: Dict; b?: Dict; g?: Dict; e: Dict }>;
}

/** Volvo: [год с, год по, код модели, описание, номер с, номер по | null] */
export type VolvoRange = [number, number, string, string, number, number | null];
/** Subaru: [год, код модели, номер с, номер по | null, описание] */
export type SubaruRange = [number, string, number, number | null, string];
/** Toyota: [модель, кузов, двигатель, годы] */
export type ToyotaCode = [string, string, string, string];
