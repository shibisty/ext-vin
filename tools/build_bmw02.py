#!/usr/bin/env python3
"""Сборка src/data/bmw02.ts из tools/sources/bmw02-us-vin-*.tsv (диапазоны номеров BMW 02 для рынка США).

Запуск: python3 tools/build_bmw02.py tools/sources/bmw02-us-vin-2026-11-12.tsv > src/data/bmw02.ts
"""
import json
import sys

MON = {'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04', 'May': '05', 'Jun': '06', 'Jul': '07', 'Aug': '08', 'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12'}


def month(s):
    m, y = s.split('-')
    return ('19' + y + '-' + MON[m]) if m in MON else '19' + y


rows = []
for line in open(sys.argv[1], encoding='utf-8'):
    if not line.strip() or line.startswith('#'): continue
    model, series, my, a, b, start, end, built = line.rstrip('\n').split('\t')
    rows.append([int(start), int(end), model, series, int(my), month(a), month(b)])
rows.sort()
print('// Диапазоны номеров BMW 02 (1600, 2002, 2002 автомат, 2002tii) для рынка США, 1967–1976.')
print('// Источник: таблица Dean Cain (2005), см. tools/sources/bmw02-us-vin-2026-11-12.tsv и NOTICE.txt. Собрано tools/build_bmw02.py.')
print('// [начало, конец, модель, серия (Pre 71 / Mod 71 / Mod 74 / Mod 75 / Mod 76), модельный год, выпуск с, выпуск по]')
print('export const BMW02_US: [number, number, string, string, number, string, string][] = ' + json.dumps(rows, separators=(',', ':')) + ';')
