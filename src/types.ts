// Общие типы результатов расшифровки.
import type { CertInfo } from './jdm-cert';

/** Строка таблицы: [подпись, значение, пояснение] */
export type Row = [label: string, value: string, hint?: string | null];

export type SegClass = 'wmi' | 'vds' | 'chk' | 'year' | 'plant' | 'serial';
/** Сегмент номера для окраски: [класс, начало, конец (не включая), подпись] */
export type Segment = [cls: SegClass, start: number, end: number, label: string];

export interface YearInfo {
  value: number;
  alt: number | null;
  /** год взят по правилам NHTSA (выставляет попап) */
  src?: 'NHTSA';
}
export interface CheckInfo { actual: string; expected: string; ok: boolean }
export interface PlantInfo { name: string | null; known: boolean; maker?: string }
export interface PlantWb { text: string; brand: string }

interface DecodeBase {
  vin: string;
  errors: string[];
}

/** Номер с ошибкой: неверная длина или недопустимые символы */
export interface ErrorDecode extends DecodeBase {
  partial?: undefined; jdm?: undefined; legacy?: undefined; check?: undefined;
}

/** Частичный VIN (8–16 символов, «*» = неизвестный) */
export interface PartialDecode extends DecodeBase {
  partial: true;
  jdm?: undefined; legacy?: undefined; check?: undefined;
  wmi?: string;
  region?: string | null;
  country?: string | null;
  maker?: string | null;
  year?: YearInfo | null;
}

/** Полный 17-значный VIN по ISO 3779 */
export interface IsoDecode extends DecodeBase {
  partial?: undefined; jdm?: undefined; legacy?: undefined;
  wmi: string;
  region: string | null;
  country: string | null;
  maker: string | null;
  makerSrc: string | null;
  /** другие словари называют этот WMI иначе: [название, словарь] */
  makerAlt?: [name: string, src: string][];
  brandKey: string | null;
  brandDetails: Row[] | null;
  brandSource: string | null;
  noCheck: boolean;
  smallMaker: boolean;
  plantWb: PlantWb | null;
  smallMakerCode: string | null;
  year: YearInfo | null;
  check: CheckInfo;
  plant: string;
  plantInfo: PlantInfo;
  serial: string;
  /** выставляет попап: год по локальному расчёту до замены на год NHTSA */
  localYear?: number | null;
  /** выставляет попап: номер есть в списке исключений NHTSA */
  checkException?: boolean;
}

/** Старый номер (до 1981) или номер шасси с собственной схемой */
export interface LegacyDecode extends DecodeBase {
  legacy: true;
  partial?: undefined; jdm?: undefined; check?: undefined;
  format: string;
  segments: Segment[];
  rows: Row[];
}

/** Номер кузова JDM: [префикс-]код модели-серийный номер */
export interface JdmDecode extends DecodeBase {
  jdm: true;
  partial?: undefined; legacy?: undefined; check?: undefined;
  cert: string | null;
  code: string;
  serial: string;
  toyota: string | null;
  toyotaRef: [string, string, string, string][] | null;
  subaruRef: [number, string, number, number | null, string][] | null;
  match: { brand: string; model: string; years: string } | null;
  /** модели с этим кодом по японской Википедии: марка, модель, поколение (0 = не указано), годы продаж, статья */
  wiki: { brand: string; model: string; gen: number; years: string; article: string }[] | null;
  /** расшифровка префикса сертификации (нормы выбросов, топливо, тип машины) */
  certInfo: CertInfo | null;
}

/** Пакет справочника Mitchell 1 (src/mitchell.ts): подключается отдельно, см. useMitchell в decode.ts */
export interface MitchellPack {
  usLegacy: import('./data/types').UsLegacy;
  hyundaiBody: Record<string, string>;
  details: Record<'mercedes' | 'audi' | 'porsche' | 'vwYear' | 'vwType' | 'jaguar' | 'saab' | 'colt', (vin: string) => Row[] | null>;
  legacy: Record<'amc' | 'colt' | 'jeep' | 'gmTruck' | 'moparTruck' | 'fordTruck' | 'vw' | 'volvo' | 'jaguar' | 'porscheEngine' | 'vwEngine' | 'mazda', (vin: string) => LegacyDecode | null>;
  mbType: (key: string) => string | null;
  /** первые 6 цифр номера двигателя Mercedes-Benz → модели и годы */
  mbEngine: (key: string) => string | null;
  porscheRef: (key: string) => string | null;
  toyotaRef: (code: string) => JdmDecode['toyotaRef'];
  subaruRef: (code: string, serial: number) => JdmDecode['subaruRef'];
}

export type LocalDecode = ErrorDecode | PartialDecode | IsoDecode | LegacyDecode | JdmDecode;

/** Объяснение одной позиции VIN */
export interface PositionExplain {
  pos: number;
  ch: string;
  group: string;
  what: string;
  rule: string;
  result: string[];
}
