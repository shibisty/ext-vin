#!/usr/bin/env python3
"""Сборка src/data/p356.ts — диапазоны номеров шасси Porsche 356 из официальных каталогов запчастей Porsche Classic
(KAT071 «356/356A 1950–1959» и KAT072 «356B/356C 1960–1965», страницы V-Pages / ORDER-INFO, раздел VEHICLE IDENT.NR.).

PDF в проект не кладутся. Текст получается командой `pdftotext -layout файл.pdf файл.txt`.
Запуск: python3 tools/build_p356.py kat071.txt kat072.txt > src/data/p356.ts

Берутся строки «модель, кузов, модельный год, номер>номер» из сводок до таблиц номеров двигателей. В KAT071 две сводки
(по типам двигателей и итоговая «VEHICLE IDENT.-NOS.-SUMMARY»), они местами расходятся в годах — сохраняются обе,
декодер показывает все совпадения. Диапазон «номер>» без конца ограничивается следующим известным началом блока.
"""
import json
import re
import sys

LINE = re.compile(r'^\s*\*?\s*(356(?: [ABC])?)\s{1,}(.+?)\s{2,}(\d\d)\s+(\d{4,6})(?:(>)(\d{4,6})?)?(?:\s|$)')


def body(s):
    s = re.sub(r'\s+', ' ', s.strip()).replace('SPEDDSTER', 'SPEEDSTER').replace('540.1/T.2)', '540.1(T.2)')
    t = re.search(r'\(T\.?(\d)\)', s)
    base = re.sub(r'\s*540(?:\.1)?\s*', ' ', re.sub(r'\(T\.?\d\)', '', s)).strip()
    base = {'COUPE': 'Coupe', 'CABRIO': 'Cabrio', 'SPEEDSTER': 'Speedster', 'ROADSTER': 'Roadster', 'HARDTOP': 'Hardtop',
            'CONVERTIBLE D': 'Convertible D', 'COUPE -KARMANN-': 'Coupe (Karmann)', 'HARDTOP -KARMANN-': 'Hardtop (Karmann)',
            'CABRIO (GLAESER-HEUER)': 'Cabrio (Gläser-Heuer)', 'COUPE/CABRIO': 'Coupe / Cabrio'}[base]
    return base + (f' T{t.group(1)}' if t else '')


def read(path):
    out, src = [], path.rsplit('/', 1)[-1][:6].upper()
    for line in open(path, encoding='utf-8', errors='replace'):
        if 'ENGINE NO.' in line: break  # дальше — номера двигателей и коробок
        m = LINE.match(line)
        if not m: continue
        model, b, my, a, gt, z = m.groups()
        if '/' in b and b.split()[0] not in ('COUPE/CABRIO',): continue
        out.append([int(a), int(z) if z else None if gt else int(a), model, body(b), 1900 + int(my), src])
    return out


rows = []
for p in sys.argv[1:]:
    for r in read(p):
        if r not in rows: rows.append(r)
# продолжения строк («05411>05600» под предыдущей строкой) pdftotext даёт отдельно — читаем их здесь
for p in sys.argv[1:]:
    prev = None
    for line in open(p, encoding='utf-8', errors='replace'):
        if 'ENGINE NO.' in line: break
        m = LINE.match(line)
        if m: prev = m.groups(); continue
        c = re.match(r'^\s{30,}(\d{5,6})>(\d{5,6})\s*$', line)
        if c and prev:
            model, b, my = prev[:3]
            r = [int(c.group(1)), int(c.group(2)), model, body(b), 1900 + int(my), p.rsplit('/', 1)[-1][:6].upper()]
            if r not in rows: rows.append(r)
starts = sorted({r[0] for r in rows})
for r in rows:
    if r[1] is None:
        nxt = [s for s in starts if s > r[0]]
        r[1] = min(nxt[0] - 1, r[0] + 9999) if nxt else r[0] + 9999
rows.sort(key=lambda r: (r[0], r[1], r[4], r[3]))
print('// Диапазоны номеров шасси Porsche 356 (1950–1965) по каталогам запчастей Porsche Classic KAT071 и KAT072 (страницы V-Pages).')
print('// Собрано tools/build_p356.py, см. NOTICE.txt. [начало, конец, модель, кузов, модельный год, каталог]')
print('export const P356: [number, number, string, string, number, string][] = ' + json.dumps(rows, ensure_ascii=False, separators=(',', ':')) + ';')
