"""Коды заводов GM, Ford и Chrysler из Wikibooks (CC BY-SA 4.0) для старых американских номеров.
Использование: python3 build_plants_us.py sources/wikibooks-vin-us-2026-11-11.json ../src/data/plants-us-wb.ts
GM: таблица «GM North American Factories» страницы «GM/VIN Code History» — у каждой строки годы, по ним выбирается завод.
Ford, Chrysler: таблицы заводов (символ 11 VIN с 1981 года) — для проверки старых таблиц 1965–1980.
"""
import json, re, sys
SRC, OUT = sys.argv[1], sys.argv[2]
d = json.load(open(SRC, encoding='utf-8'))
pages = {p['title'].split('(VIN codes)/')[1]: p for p in d['pages']}

def clean(s):
    s = re.sub(r'<br\s*/?>', ' ', s)
    s = re.sub(r'\[\[(?:[^\]|]*\|)?([^\]]*)\]\]', r'\1', s)
    s = re.sub(r"'{2,}", '', s)
    return re.sub(r'\s+', ' ', s).strip()
def table_after(text, head):
    i = text.index(head); j = text.index('|}', i)
    rows = []
    for r in re.split(r'\n\|-[^\n]*', text[i:j]):
        cells = [clean(c) for c in re.split(r'\n[|!]', '\n' + r.strip()) if c.strip()]
        cells = [c for c in cells if not c.startswith('{|') and not c.startswith('=')]
        if len(cells) >= 2 and re.fullmatch(r'[A-Z0-9]', cells[0]): rows.append(cells)
    return rows
def ranges(s):
    out = []
    for a, b, plus in re.findall(r'(?<!\d)((?:19|20)\d\d)(?:\s*[-–]\s*((?:19|20)\d\d))?(\+)?(?!\d)', s):
        out.append([int(a), int(b) if b else (9999 if plus else int(a))])
    return out

gm_page = pages['GM/VIN Code History']
GM = {}
for code, name, *_ in table_after(gm_page['text'], '===GM North American Factories==='):
    GM.setdefault(code, []).append([name, ranges(name)])
def simple(page, head):
    M = {}
    for cells in table_after(pages[page]['text'], head):
        M.setdefault(cells[0], []).append(' — '.join(c for c in cells[1:] if c))
    return M
FORD = simple('Ford/VIN Codes', '===North American Ford factories===')
CHRYSLER = simple('Chrysler/VIN Codes', '===Assembly Plant===')
revs = {k: pages[k]['revid'] for k in ('GM/VIN Code History', 'Ford/VIN Codes', 'Chrysler/VIN Codes')}
head = ("// Коды заводов GM, Ford, Chrysler по Wikibooks «Vehicle Identification Numbers (VIN codes)» (CC BY-SA 4.0). См. NOTICE.txt\n"
        f"// Ревизии: {', '.join(f'{k} {v}' for k, v in revs.items())}. Собрано tools/build_plants_us.py.\n"
        "import type { Dict } from './types';\n"
        "/** GM: код -> [завод, годы [[с, по]], 9999 = по сей день] */\n")
js = lambda o: json.dumps(o, ensure_ascii=False, separators=(',', ':'))
open(OUT, 'w', encoding='utf-8').write(head +
    f"export const GM_PLANTS_WB: Dict<[string, [number, number][]][]> = {js(GM)};\n"
    "/** Ford и Chrysler: код (символ 11 с 1981 года) -> заводы с примечаниями */\n"
    f"export const FORD_PLANTS_WB: Dict<string[]> = {js(FORD)};\n"
    f"export const CHRYSLER_PLANTS_WB: Dict<string[]> = {js(CHRYSLER)};\n")
print('GM', len(GM), 'Ford', len(FORD), 'Chrysler', len(CHRYSLER), file=sys.stderr)
