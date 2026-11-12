#!/usr/bin/env python3
"""Номера двигателей и ранние номера шасси из справочника Mitchell 1 «2009 VIN Decoding» → src/data/mitchell-engines.ts.

Справочник коммерческий и в репозиторий не кладётся: путь к PDF передаётся аргументом.
Нужен pdftotext (poppler-utils). Берутся только значения кодов:
  * Porsche: стартовые номера двигателей 1973–1999 (стр. G-129…G-130);
  * Volkswagen: начальные символы номеров двигателей 1974–2002 (стр. G-190), коды двигателей 2003–2009 (G-187…G-189),
    диапазоны номеров двигателей Beetle 1973–1980 (G-184);
  * Mercedes-Benz: типы двигателей 2004–2009 из таблиц «Model Reference» (первые шесть цифр номера двигателя);
  * Mazda: номера шасси 1979–1980 (RX-7 SA22C, пикап PE2) и диапазоны серийных номеров по моделям (G-87, G-94).

Запуск: python3 tools/build_mitchell_engines.py путь/к/VIN.pdf > src/data/mitchell-engines.ts
"""
import json
import re
import subprocess
import sys

PDF = sys.argv[1]
LAY = subprocess.run(['pdftotext', '-layout', PDF, '-'], capture_output=True, text=True, check=True).stdout.split('\n')
RAW = subprocess.run(['pdftotext', PDF, '-'], capture_output=True, text=True, check=True).stdout.split('\n')


def year_of(m):
    a = int(m.group(1))
    return [a, int(m.group(1)[:2] + m.group(2)) if m.group(2) else a]


# ---------- Porsche: стартовые номера двигателей ----------
def porsche():
    s = next(i for i, l in enumerate(LAY) if 'STARTING ENGINE NUMBER' in l)
    e = next(i for i, l in enumerate(LAY) if 'ENGINE VIN CODE' in l)
    rows, year, stack = [], None, []
    for l in LAY[s + 1:e]:
        if not l.strip() or 'IDENTIFICATION' in l or 'PORSCHE' in l or 'Cont.' in l or re.match(r'\s*G-\d+', l) or 'YEAR & MODEL' in l:
            continue
        ind = len(l) - len(l.lstrip())
        m = re.match(r'\s*(\d{4})(?:-(\d\d))?\s*(?:\(([^)]*?)(?:\)|\s{2,}|$))?\s*(.*)$', l)
        if m and ind < 14:
            year = year_of(m)
            stack = [(ind + 1, m.group(3).strip())] if m.group(3) else []
            rest = m.group(4)
            if not rest.strip():
                continue
            ind += 20
            l = ' ' * ind + rest
        m = re.match(r'\s*(.*?)\s{2,}((?:Six|Four)\s[\d.]+ Litre)\s+(\S+)\s*$', l)
        label, eng, num = (m.group(1).strip(), m.group(2), m.group(3)) if m else (l.strip(), None, None)
        if label:
            stack = [x for x in stack if x[0] < ind] + [(ind, label)]
        elif eng:
            stack = stack[:1]
        if eng and num != 'N.A.':
            rows.append([num, year[0], year[1], [x[1] for x in stack], eng])
    return rows


# ---------- Volkswagen ----------
def vw_prefix():
    s = next(i for i, l in enumerate(RAW) if 'Codes listed are first characters of engine serial number' in l)
    e = next(i for i in range(s, len(RAW)) if RAW[i].strip() == 'VOLVO')
    codes, cur = {}, None
    for l in RAW[s + 1:e]:
        l = l.strip()
        if not l or l == 'Cont.' or re.match(r'^G-\d+$', l) or l in ('VOLKSWAGEN', 'IDENTIFICATION') or 'VW WATER COOLED' in l \
                or l.startswith('ENGINE IDENTIFICATION') or l.startswith('NOTE:'):
            continue
        m = re.match(r'^([A-Z0-9]{2,4})\s*\.{2,}\s*(.*)$', l)
        if m:
            cur = m.group(1)
            codes.setdefault(cur, []).append(m.group(2))
            continue
        if cur is None:
            continue
        if re.match(r'^[A-Z][A-Za-z]+(?: [A-Z][A-Za-z]+)?(?: \([A-Za-z]+\))? (?:19|20)?\d{2}(?:[-,]\s?(?:19|20)?\d{2})*\b', l):
            codes[cur].append(l)
        else:
            codes[cur][-1] += ' ' + l
    return codes


def vw_codes():
    s = next(i for i, l in enumerate(LAY) if 'ENGINE CODE' in l and 'FUEL TYPE' in l)
    e = next(i for i in range(s, len(LAY)) if 'Codes listed are first characters' in LAY[i])
    out, year, model = {}, None, None
    for l in LAY[s:e]:
        if 'YEAR & MODEL' in l or not l.strip() or 'IDENTIFICATION' in l or 'Cont.' in l or 'VW WATER' in l \
                or re.match(r'\s*G-\d+', l) or l.strip().startswith('VOLKSWAGEN'):
            continue
        m = re.match(r'\s*(\d{4})(?:-(\d\d))?(?: \(Cont\.\))?\s*$', l)
        if m:
            year, model = year_of(m), None
            continue
        m = re.match(r'^\s*(\S.*?)?\s{2,}(\d\.\d ?L?\s?[A-Za-z0-9-]+(?: \([^)]*\))?|\d\.\d Four)\s{2,}([A-Z0-9][A-Z0-9 ,/]*?)\s{2,}(Gas|Diesel)(?: \(([\d-]+)\))?\s*$', l)
        if not m:
            raise SystemExit(f'VW: не разобрана строка: {l!r}')
        if m.group(1):
            model = m.group(1).strip()
        yrs = year
        if m.group(5):
            a = m.group(5).split('-')
            yrs = [2000 + int(a[0]), 2000 + int(a[-1])]
        for c in re.split(r'[ ,/]+', m.group(3).strip()):
            out.setdefault(c, []).append([yrs[0], yrs[1], model, re.sub(r'\s+', ' ', m.group(2)), m.group(4)])
    return out


def vw_beetle():
    s = next(i for i, l in enumerate(LAY) if 'ENGINE SERIAL NUMBER LISTING' in l)
    rows, year = [], None
    for l in LAY[s:s + 25]:
        m = re.match(r'\s*(?:(\d{4})\s+)?([A-Z]{2}\d+)\s+thru\s+([A-Z]{2}\d+)\s+(\d+)\s*$', l)
        if m:
            year = int(m.group(1)) if m.group(1) else year
            rows.append([m.group(2), m.group(3), year, int(m.group(4))])
    return rows


# ---------- Mercedes: типы двигателей ----------
def mercedes():
    a = next(i for i, l in enumerate(LAY) if l.startswith('MERCEDES') and 'IDENTIFICATION' in l)
    b = next(i for i in range(a, len(LAY)) if LAY[i].startswith('MITSUBISHI') or LAY[i].startswith('NISSAN'))
    idx = [i for i in range(a, b) if 'TRANS TYPE' in LAY[i] and 'YEAR & MODEL' in LAY[i]]
    out = {}
    for s in idx:
        year = model = None
        for l in LAY[s + 1:s + 90]:
            if 'IDENTIFICATION' in l:
                break
            if not l.strip() or l.strip().startswith('Cont.') or re.match(r'\s*G-\d+', l):
                continue
            m = re.match(r'\s*(\d{4})(?:-(\d\d))?(?: \(Cont\.\))?\s*$', l)
            if m:
                year = year_of(m)
                continue
            m = re.match(r'^\s*(\S+(?: \S+)*)?\s{2,}((?:I|V|H)\d+ [\d.]+ ?L|Inline \d [\d.]+ ?L)(?: L)?/(\d{3}\.\d{3})(?:/\d+)?(?: \(([^)]*)\))?\s+(.*?)\s*$', l)
            if not m:
                raise SystemExit(f'Mercedes: не разобрана строка: {l!r}')
            if m.group(1):
                model = m.group(1)
            yr = list(year)
            t = re.search(r'\((\d\d)(?:-(\d\d))?\)\s*$', m.group(5))
            if t:
                yr = [2000 + int(t.group(1)), 2000 + int(t.group(2) or t.group(1))]
            name = model + (f' ({m.group(4)})' if m.group(4) else '')
            ent = [yr[0], yr[1], name, m.group(2).strip()]
            lst = out.setdefault(m.group(3).replace('.', ''), [])
            if ent not in lst:
                lst.append(ent)
    return out


# ---------- Mazda 1979–1980 ----------
def mazda():
    s = next(i for i, l in enumerate(LAY) if 'CHASSIS NUMBERS' in l and 'YEAR' in l)
    rows, year, model = [], None, None
    for l in LAY[s + 1:s + 40]:
        m = re.match(r'\s*(19(?:79|80))\s+(\S.*)$', l)
        if m:
            year, l = int(m.group(1)), ' ' * 18 + m.group(2)
        if year is None or re.match(r'\s*1981', l):
            break
        m = re.match(r'^\s*(.*?)\s{2,}(\d{4}cc \([\d.]+ Litre\)|Rotary)\s+(\d{6})(?:-(\d{6})| & Up)\s*$', l)
        if m:
            label = m.group(1).strip()
            if label in ('Sed', 'S/W', '6 Ft Bed', '7 Ft Bed'):
                name = f'{model} {label}'
            else:
                model = label
                name = label
            rows.append([name, year, m.group(2), int(m.group(3)), int(m.group(4)) if m.group(4) else None])
        elif l.strip():
            model = l.strip()
    return rows


def js(o):
    return json.dumps(o, ensure_ascii=False, separators=(',', ':'), sort_keys=True)


po, vwp, vwc, vwb, mb, mz = porsche(), vw_prefix(), vw_codes(), vw_beetle(), mercedes(), mazda()
out = ['// Номера двигателей и ранние номера шасси по справочнику Mitchell 1 «2009 VIN Decoding» (только значения кодов, см. NOTICE.txt).',
       '// Собрано tools/build_mitchell_engines.py из PDF справочника; часть пакета src/mitchell.ts. Не править вручную.',
       '',
       '/** Porsche 1973–1999: [стартовый номер, год с, год по, [модель, исполнение…], двигатель] */',
       f'export const PO_ENGINES: [string, number, number, string[], string][] = {js(po)};',
       '/** VW 1974–2002: начальные символы номера двигателя → строки справочника «модель годы объём мощность» */',
       f'export const VW_ENGINE_PREFIX: Record<string, string[]> = {js(vwp)};',
       '/** VW 2003–2009: код двигателя → [год с, год по, модель, двигатель, топливо] */',
       f'export const VW_ENGINE_CODES: Record<string, [number, number, string, string, string][]> = {js(vwc)};',
       '/** VW Beetle 1973–1980: [первый номер, последний номер, модельный год, л.с. DIN] */',
       f'export const VW_BEETLE_ENGINES: [string, string, number, number][] = {js(vwb)};',
       '/** Mercedes-Benz 2004–2009: тип двигателя (6 цифр) → [год с, год по, модель, двигатель] */',
       f'export const MB_ENGINE_TYPES: Record<string, [number, number, string, string][]> = {js(mb)};',
       '/** Mazda 1979–1980: [модель, год, двигатель, номер с, номер по (null — и выше)] */',
       f'export const MAZDA_7980: [string, number, string, number, number | null][] = {js(mz)};',
       '']
sys.stdout.write('\n'.join(out))
print(f'Porsche {len(po)}, VW префиксов {len(vwp)}, VW кодов {len(vwc)}, Beetle {len(vwb)}, Mercedes {len(mb)}, Mazda {len(mz)}', file=sys.stderr)
