"""Словарь WMI из статьи Wikipedia «Vehicle identification number» (раздел «List of common WMI», CC BY-SA 4.0).
Использование: python3 build_wmi_wiki.py sources/wikipedia-vin-<revid>.json ../src/data/wmi-wiki.ts
Файл-источник — JSON {title, revid, timestamp, source, text} с вики-разметкой статьи (скачивается через API MediaWiki).
Если у кода несколько строк (например, SAD: Daimler до 1987 и Jaguar SUV), значения объединяются через «; ».
Мелкосерийные производители («SA9 048») записываются шестью символами: WMI + символы 12–14 VIN.
"""
import json, re, sys
SRC = sys.argv[1]; OUT = sys.argv[2] if len(sys.argv) > 2 else None
d = json.load(open(SRC, encoding='utf-8'))
t = d['text']
t = t[t.index('==List of common WMI=='):t.index('==See also==')]

def strip_templates(s):
    while True:
        n = re.sub(r'\{\{[^{}]*\}\}', '', s)
        if n == s: return n
        s = n
def clean(s):
    s = re.sub(r'<ref[^>/]*/>', '', s)
    s = re.sub(r'<ref[^>]*>.*?</ref>', '', s, flags=re.S)
    s = strip_templates(s)
    s = re.sub(r'\[\[(?:[^\]|]*\|)?([^\]]*)\]\]', r'\1', s)          # [[ссылка|текст]] -> текст
    s = re.sub(r'\[https?://\S+ ([^\]]*)\]', r'\1', s)                # [url текст] -> текст
    s = re.sub(r"'{2,}", '', s)
    s = re.sub(r'<br\s*/?>', ' ', s)
    s = re.sub(r'<[^>]+>', '', s)
    s = s.replace('&nbsp;', ' ').replace('&ndash;', '–')
    s = re.sub(r',?\s*see also:.*$', '', s)                          # «Porsche car, see also: …» — ссылка на статью, не название
    return re.sub(r'\s+', ' ', s).strip()

M = {}
for row in re.split(r'\n\|-[^\n]*', t):
    row = row.strip('\n')
    if not row.startswith('|') or row.startswith('|}'): continue
    # ячейки через «||» в одной строке или по одной на строку («|ячейка»)
    cells = [c.strip() for c in (row[1:].split('||') if '||' in row else re.split(r'\n\|', row[1:]))]
    if len(cells) < 2: continue
    head = clean(cells[0])
    small = re.fullmatch(r'([A-Z0-9]{2}9) (\d{3})', head)       # мелкосерийный: «SA9 048» -> ключ SA9048 (символы 1–3 и 12–14)
    if small: codes = [small.group(1) + small.group(2)]
    else:
        codes = re.findall(r'\b[A-Z0-9]{2,3}\b', head)
        if not codes or re.sub(r'[\s,/]', '', head) != ''.join(codes): continue
    rest = cells[1:]
    if len(rest) >= 2: rest = rest[1:]                                   # колонка страны (с rowspan или без)
    last = rest[-1]
    name = clean(last.split('|', 1)[1] if re.match(r'\s*(rowspan|colspan|style)\s*=', last) else last)
    if not name: continue
    for c in codes:
        if c in M:
            if name not in M[c].split('; '): M[c] += '; ' + name
        else: M[c] = name
print('кодов:', len(M), file=sys.stderr)
if OUT:
    head = (f"// Словарь WMI из статьи Wikipedia «Vehicle identification number», раздел «List of common WMI» (CC BY-SA 4.0),\n"
            f"// ревизия {d['revid']} от {d['timestamp'][:10]}: {d['source']}. Собран tools/build_wmi_wiki.py; при нескольких строках на код значения объединены через «; ».\n"
            f"// Названия оставлены на английском: это имена производителей. См. NOTICE.txt\n"
            f"import type {{ Dict }} from './types';\n")
    open(OUT, 'w', encoding='utf-8').write(head + 'export const WMI_WIKI: Dict = ' + json.dumps(dict(sorted(M.items())), ensure_ascii=False, separators=(',', ':')) + ';\n')
else:
    json.dump(M, sys.stdout, ensure_ascii=False)
