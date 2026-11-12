#!/usr/bin/env python3
"""Сборка src/data/legacy-tp.ts из выгрузки таблиц tpocr.com (tools/sources/tpocr-vin-*.json).

Берутся только значения кодов (код → модель / кузов / двигатель), текст страниц не переносится.
Страницы устроены как таблицы в две колонки: заголовок «Fifth Digit: Engine», строка «Code | …»,
затем пары «код | значение»; одиночная ячейка — подзаголовок группы (модель), одиночный год — смена года.

Сейчас собирается:
  * TP_FORD — Ford и Mercury/Lincoln, 1965–1975, 11 символов: 3–4-й символы (кузов), 5-й (двигатель);
  * TP_MOPAR — Plymouth, Dodge, Chrysler/Imperial 1966–1975: модельный ряд, серия, кузов, двигатель;
  * TP_AMC — American Motors 1966–1975 (13 символов, раскладка 1966–1967 и с 1968 разная);
  * TP_GM — Chevrolet, Pontiac, Oldsmobile, Buick, Cadillac 1965–1975: серия, кузов, двигатель (с 1972), Cadillac 1965–1970.

Запуск: python3 tools/build_tpocr.py tools/sources/tpocr-vin-2026-11-12.json > src/data/legacy-tp.ts
Выход детерминирован (ключи отсортированы).
"""
import json
import re
import sys

ORD = {'first': 1, 'second': 2, 'third': 3, 'fourth': 4, 'fifth': 5, 'sixth': 6, 'seventh': 7, 'eighth': 8, 'ninth': 9, 'tenth': 10}


def pos_of(h):
    h = h.lower()
    m = re.findall(r'(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)', h)
    if 'next four' in h: return 'next4'
    if 'last six' in h: return None
    if 'next three' in h: return 'next3'
    if 'next two' in h: return 'next2'
    if m: return (ORD[m[0]], ORD[m[-1]])
    return None


def parse(page):
    """Таблицы страницы → записи {year, pos, field, group, code, val}. Ячейка таблицы: [x, colspan, text]."""
    title = page['title']
    recs = []
    year = int(title[:4])
    for t in page['tables']:
        head = {'L': None, 'R': None}; field = {'L': None, 'R': None}; grp = {'L': None, 'R': None}
        for row in t:
            texts = [c[2] for c in row if c[2]]
            if len(texts) == 1 and re.fullmatch(r'\d{4}', texts[0]) and 1955 <= int(texts[0]) <= 1981:
                year = int(texts[0]); head = {'L': None, 'R': None}; continue
            if any(re.search(r'Digits?\s*:?$', c[2]) or re.search(r'Digit', c[2]) and c[2].endswith(':') for c in row if c[2]):
                for x, cs, tx in row:
                    sides = ['L', 'R'] if cs >= 4 else (['L'] if x < 2 else ['R'])
                    p = pos_of(tx) if tx else None
                    for s in sides:
                        head[s] = p; field[s] = None; grp[s] = None
                continue
            if row and row[0][2] == 'Code':
                for x, cs, tx in row:
                    if tx != 'Code': field['L' if x < 2 else 'R'] = tx
                continue
            k = 0
            while k < len(row):
                x, cs, tx = row[k]; s = 'L' if x < 2 else 'R'
                if not tx: k += 1; continue
                nxt = row[k + 1] if k + 1 < len(row) else None
                if head[s] and nxt and nxt[0] == x + 1 and re.fullmatch(r'[A-Z0-9]{1,5}(?:,\s?[A-Z0-9]{1,5})*', tx):
                    recs.append(dict(year=year, pos=head[s], field=field[s], group=grp[s], code=tx, val=nxt[2])); k += 2; continue
                if head[s] and cs <= 2 and not nxt or (nxt and nxt[0] != x + 1):
                    grp[s] = tx
                k += 1
    return recs


def by_make(pages):
    out = {}
    for k in sorted(pages):
        m = re.match(r'([a-z]+)vin\d*\.html', k)
        if m: out.setdefault(m.group(1), []).extend(parse(pages[k]))
    return out


# ---------- нормализация значений к сокращениям справочника Mitchell (их переводит ruBody) ----------
FOOT = re.compile(r'(?:,\s*|\s+)\d(?:,\s*\d)*(?=$|,)')  # сноски «…, 2, 3» / «… 1»


def clean(s):
    s = re.sub(r'\s+', ' ', s).strip()
    s = re.sub(r'^\d+[A-Z], ', '', s)  # «22C, 2 dr. …»
    s = re.sub(r',(?=\S)', ', ', s)
    prev = None
    while prev != s:
        prev = s; s = FOOT.sub('', s).strip()
    return s.strip(' ,')


def body(group, val):
    v = clean(val)
    v = v.replace('Sedn', 'Sedan').replace('Sports Coupe', 'Sport Coupe')
    v = re.sub(r'\b(\d) (?:dr\.|Door)', r'\1 Dr', v)
    v = re.sub(r'\b(?:Sta\. Wagon|Station Wagon)\b', 'S/W', v)
    v = re.sub(r'(?<!Ranch )\bWagon\b', 'S/W', v)
    v = re.sub(r'\bHardtop\b', 'HT', v, flags=re.I)
    v = re.sub(r'\bConvertible\b', 'Conv', v)
    v = re.sub(r'(?<!Country )\bSedan\b', 'Sed', v)
    v = re.sub(r'\bCoupe\b', 'Cpe', v)
    v = re.sub(r'\b(?:Std\. )?[Bb]ucket seats?\b', 'Bucket seat', v)
    v = re.sub(r'\bBench seats?\b', 'Bench seat', v)
    v = re.sub(r'(\d)[ -][Pp]ass\b\.?', r'\1 Pass.', v)
    v = re.sub(r'\b(\d)[ -][Ss]eat\b', r'\1-Seat', v)
    v = re.sub(r'\s+', ' ', v).strip(' ,')
    g = clean(group or '').replace('Falon', 'Falcon').replace('CougarXR-7', 'Cougar XR-7')
    if g in ('Ford', 'Mercury'): g = ''  # общий подзаголовок таблиц 1970-х, марку decode.ts пишет сам
    return f'{g}: {v}' if g else v


def engine(val):
    v = clean(val)
    v = re.sub(r'(\d)\s*-\s*(\d)\s*[Bb]ar', r'\1-\2 bar', v)
    v = re.sub(r'([\d-]+)\s*(?:[Bb]ar|[Bb]rl)\.?\s*[Cc]arb\.?,?\s*', r'\1BC, ', v)
    v = re.sub(r'\bLo\. Comp\.', 'Low Comp.', v)
    v = re.sub(r'\b(?:Prem\. fuel|Premium fuel|Premium)\b\.?', 'Premium fuel', v)
    v = re.sub(r'\bHi\. perf\.', 'Hi-Perf', v)
    v = re.sub(r'\bH\.O\.|\bHO\b', 'HO', v)
    v = re.sub(r'R\.A\.I, CJ', 'CJ Ram Air', v)
    v = re.sub(r'^L(\d-)', r'\1', v)
    v = re.sub(r'\b(?:Daul|Dual) (?:exh\.|Exh\.|Exhaust)', 'Dual Exh.', v)
    v = re.sub(r'\bSingle (?:exh\.|Exh\.|Exhaust)', 'Single Exh.', v)
    v = re.sub(r'(?:\s*,)+\s*', ', ', v)
    v = re.sub(r'^(\d-\d+) ', r'\1, ', v)  # «8-302, Low Comp.»
    v = re.sub(r'^(\d-\d+), (\d-?\d?BC)', r'\1 \2', v)
    v = re.sub(r'\s+', ' ', v).strip(' ,')
    return v


def split_engine(e):
    m = re.match(r'^(\d-\d+)(?: ([\d-]+BC))?(?:, (.*))?$', e)
    return (m.group(1), m.group(2), [x for x in (m.group(3) or '').split(', ') if x]) if m else (e, None, [])


def merge_engines(vals):
    """Одинаковые коды двигателя Ford и Mercury: если объём совпадает и карбюраторы не спорят, записи объединяются."""
    out = []
    for v in vals:
        h, c, x = split_engine(v)
        for i, o in enumerate(out):
            oh, oc, ox = split_engine(o)
            if oh == h and (not c or not oc or c == oc):
                ex = ox + [t for t in x if t not in ox]
                out[i] = oh + (' ' + (oc or c) if oc or c else '') + (', ' + ', '.join(ex) if ex else '')
                break
        else:
            out.append(v)
    return ' | '.join(out)


def ford(recs):
    out = {}
    for mk, key in (('ford', 'f'), ('lincoln', 'm')):
        for r in recs[mk]:
            y = r['year']
            if not 1965 <= y <= 1975: continue
            p = tuple(r['pos']) if isinstance(r['pos'], list) else r['pos']
            if p == (3, 4) and re.fullmatch(r'\d\d', r['code']):
                d = out.setdefault(str(y), {}).setdefault(key, {})
                v = body(r['group'], r['val'])
                d[r['code']] = d[r['code']] + ' | ' + v if r['code'] in d and v not in d[r['code']].split(' | ') else d.get(r['code'], v)
            elif p == (5, 5) and re.fullmatch(r'[A-Z0-9]', r['code']):
                out.setdefault(str(y), {}).setdefault('e', {}).setdefault(r['code'], []).append(engine(r['val']))
    for y in out:
        # опечатки источника: у Ford не было V8 240 и V8 350, это 6-240 и 8-351 (такие же коды на соседней странице)
        out[y]['e'] = {k: merge_engines([e for e in v if not re.match(r'8-240|8-350\b', e)] or v) for k, v in out[y].get('e', {}).items()}
    return out


GM_MAKES = (('chevr', 'Chevrolet'), ('pontiac', 'Pontiac'), ('olds', 'Oldsmobile'), ('buick', 'Buick'), ('cadillac', 'Cadillac'))


def gm(recs):
    """GM 1965–1975 по маркам и годам. s — серия: ключ длиной 1 (Chevrolet: модель по 2-му символу), 2 (2–3-й символы
    до 1971 года; 2-й символ с 1972 — тоже длиной 1) или 4 (2–5-й символы: серия и кузов вместе, Oldsmobile до 1969 и Cadillac 1971);
    b — кузов (4–5-й символы до 1971, 3–4-й с 1972); e — двигатель (5-й символ, с 1972).
    c — Cadillac 1965–1970 (8 символов: буква кузова, цифра года, серийный номер)."""
    out = {}
    for mk, name in GM_MAKES:
        for r in recs[mk]:
            y = r['year']
            if not 1965 <= y <= 1975: continue
            p = tuple(r['pos']) if isinstance(r['pos'], list) else r['pos']
            code, val = r['code'], r['val']
            d = out.setdefault(name, {}).setdefault(str(y), {})
            if name == 'Cadillac' and y <= 1970:
                if p == (1, 1) and re.fullmatch(r'[A-Z]', code): d.setdefault('c', {})[code] = clean(val)
                continue
            if p == 'next4' and re.fullmatch(r'\d000', code): key, kind = code[0], 's'
            elif p in ((2, 2), (2, 3), (2, 5)) and r['field'] != 'GM Division': key, kind = code, 's'
            elif p in ((4, 5), (3, 4)): key, kind = code, 'b'
            elif p == (5, 5): key, kind = code, 'e'
            else: continue
            if not re.fullmatch(r'[A-Z0-9]{1,4}', key): continue
            if kind == 'e': v = engine(val)
            elif kind == 'b': v = body(None, val)
            elif len(key) == 4: v = body(re.sub(r'\s*\d\d=V-\d.*$|V-8$', '', r['group'] or '').strip(), val)
            else: v = clean(val)
            t = d.setdefault(kind, {})
            t[key] = t[key] + ' | ' + v if key in t and v not in t[key].split(' | ') else t.get(key, v)
    return out


AMC_TRANS = {  # коробки AMC: строк мало, переводятся здесь целиком
    'Auto column shift 3 Spd.': 'автомат, 3-ст., рычаг на рулевой колонке', 'Auto floor shift 3 Spd.': 'автомат, 3-ст., рычаг на полу',
    'Auto column shift': 'автомат, рычаг на рулевой колонке', 'Auto floor shift': 'автомат, рычаг на полу',
    'Auto console shift': 'автомат, рычаг на консоли', 'Auto floor shift console': 'автомат, рычаг на полу, с консолью',
    'Floor shift 4 Spd.': 'механика, 4-ст., рычаг на полу', 'Floor shift 4 Spd., w/console': 'механика, 4-ст., рычаг на полу, с консолью',
    'Floor shift 4 Spd., Floor mount': 'механика, 4-ст., рычаг на полу, без консоли', 'Floor shift 3 Spd.': 'механика, 3-ст., рычаг на полу',
    'Floor shift 3 Spd. (2-3 Synchromesh)': 'механика, 3-ст., синхронизаторы на 2-й и 3-й передачах, рычаг на полу',
    'Standard column shift 3 Spd.': 'механика, 3-ст., рычаг на рулевой колонке', 'Column shift 3 Spd.': 'механика, 3-ст., рычаг на рулевой колонке',
    'Overdrive column shift 3 Spd.': 'механика, 3-ст. с овердрайвом, рычаг на рулевой колонке',
    'Column shift 3 Spd. Overdrive': 'механика, 3-ст. с овердрайвом, рычаг на рулевой колонке',
}


def amc(recs):
    """AMC 1966–1975. 1966–1967: 3-й символ — завод (p), 4-й — коробка (t), 5-й — кузов (b), 6-й — модель (m), 7-й — двигатель (e).
    С 1968: 3-й — коробка (t), 4-й — серия (s), 5-й — кузов (b), 6-й — модель/класс (m), 7-й — двигатель (e)."""
    out = {}
    for r in recs['amc']:
        y = r['year']
        if not 1966 <= y <= 1975: continue
        p = tuple(r['pos']) if isinstance(r['pos'], list) else r['pos']
        f = (r['field'] or '').lower()
        kind = {'assembly plant': 'p', 'transmission': 't', 'series': 's', 'body type': 'b', 'model': 'm', 'body class': 'm', 'engine': 'e'}.get(f)
        if not kind or not re.fullmatch(r'[A-Z0-9]', r['code']): continue
        if kind == 'e':
            v = engine(re.sub(r'\bOHV\b', '', r['val']))  # у AMC все моторы OHV
            if r['group']: v += ' (' + r['group'].replace(' Series', '').title() + ')'
        elif kind in ('b', 's', 'm'): v = body(None, r['val']).replace('Javlin', 'Javelin')
        elif kind == 't': v = AMC_TRANS[clean(r['val'])]
        else: v = clean(r['val'])
        t = out.setdefault(str(y), {}).setdefault(kind, {})
        t[r['code']] = t[r['code']] + ' | ' + v if r['code'] in t and v not in t[r['code']].split(' | ') else t.get(r['code'], v)
    return out


MOPAR_MAKES = (('plymouth', 'Plymouth'), ('dodge', 'Dodge'), ('chry', 'Chrysler'))


def mopar_engine(val):
    v = clean(val).replace('Carbs', 'Carb').replace('carbs', 'carb')
    v = re.sub(r'^440 ?[+-] ?6 cu\.,? in\.?$', '440 3-2 Bar. Carb.', v)        # 1969: «440 + 6» — Six Pack
    v = re.sub(r'^237\b', '273', v)                                             # опечатка источника (Plymouth 1969, D)
    v = re.sub(r'(\d{3}) cu\.,? in\.?,?', r'\1', v)                            # «383 cu. in., Hi perf» → «383 Hi perf»
    v = re.sub(r'^(\d{3})\b', lambda m: ('6-' if m.group(1) in ('170', '198', '225') else '8-') + m.group(1), v)
    v = re.sub(r'\bH(?:i|igh)\.? ?[Pp]erf\.?', 'Hi-Perf', v)
    v = re.sub(r'\b4 bar carb\.,?', '4 Bar. Carb.,', v)
    v = re.sub(r'^Special [Oo]rder(?: (\d) [Cc]yl\.?| 8)?$', lambda m: 'Special order, ' + (m.group(1) or '8') + ' cyl.', v)
    return engine(v) if v[:1].isdigit() else v


def mopar(recs):
    """Chrysler Corporation 1966–1975 по маркам: l — модельный ряд (1-й символ), s — серия/класс (2-й), b — кузов (3–4-й), e — двигатель (5-й)."""
    out = {}
    for mk, name in MOPAR_MAKES:
        for r in recs[mk]:
            y = r['year']
            if not 1966 <= y <= 1975: continue
            p = tuple(r['pos']) if isinstance(r['pos'], list) else r['pos']
            kind = {(1, 1): 'l', (2, 2): 's', (3, 4): 'b', (5, 5): 'e'}.get(p)
            if not kind or not re.fullmatch(r'[A-Z0-9]{1,2}', r['code']): continue
            if kind == 's' and r['code'] == '0': r = dict(r, code='O')  # Super Stock: буква O набрана нулём
            v = mopar_engine(r['val']) if kind == 'e' else body(None, r['val']) if kind == 'b' else clean(r['val']).replace('Charge 500', 'Charger 500')
            t = out.setdefault(name, {}).setdefault(str(y), {}).setdefault(kind, {})
            t[r['code']] = t[r['code']] + ' | ' + v if r['code'] in t and v not in t[r['code']].split(' | ') else t.get(r['code'], v)
    return out


def main():
    d = json.load(open(sys.argv[1], encoding='utf-8'))
    recs = by_make(d['pages'])
    data = {'ford': ford(recs), 'gm': gm(recs), 'amc': amc(recs), 'mopar': mopar(recs)}
    print('// Таблицы VIN 1965–1975 по сайту tpocr.com (выгрузка ' + d['fetched'][:10] + '), только значения кодов.')
    print('// Собрано tools/build_tpocr.py, не править вручную. См. NOTICE.txt')
    print('// TP_FORD[год]: f — кузов Ford (3–4-й символы), m — кузов Mercury/Lincoln, e — двигатель (5-й символ).')
    print('export const TP_FORD: Record<string, { f: Record<string, string>; m: Record<string, string>; e: Record<string, string> }> = '
          + json.dumps(data['ford'], ensure_ascii=False, sort_keys=True, separators=(',', ':')) + ';')
    print('// TP_GM[марка][год]: s — серия (ключ 1, 2 или 4 символа), b — кузов, e — двигатель (с 1972), c — Cadillac 1965–1970 по 1-му символу.')
    print('export const TP_GM: Record<string, Record<string, { s?: Record<string, string>; b?: Record<string, string>; e?: Record<string, string>; c?: Record<string, string> }>> = '
          + json.dumps(data['gm'], ensure_ascii=False, sort_keys=True, separators=(',', ':')) + ';')
    print('// TP_MOPAR[марка][год]: l — модельный ряд (1-й символ), s — серия/класс (2-й), b — кузов (3–4-й), e — двигатель (5-й).')
    print('export const TP_MOPAR: Record<string, Record<string, Partial<Record<"l" | "s" | "b" | "e", Record<string, string>>>>> = '
          + json.dumps(data['mopar'], ensure_ascii=False, sort_keys=True, separators=(',', ':')) + ';')
    print('// TP_AMC[год]: p — завод, t — коробка, s — серия, b — кузов, m — модель/класс, e — двигатель (позиции см. build_tpocr.py).')
    print('export const TP_AMC: Record<string, Partial<Record<"p" | "t" | "s" | "b" | "m" | "e", Record<string, string>>>> = '
          + json.dumps(data['amc'], ensure_ascii=False, sort_keys=True, separators=(',', ':')) + ';')


if __name__ == '__main__':
    main()
