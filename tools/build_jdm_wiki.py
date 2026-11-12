"""Коды кузова японских моделей (型式) по японской Википедии (CC BY-SA 4.0).
Использование: python3 build_jdm_wiki.py sources/jawiki-models-<дата>.json ../src/data/jdm-wiki.ts

Источник — JSON, собранный через API MediaWiki из статей категорий «トヨタの車種», «日産の車種» и т. д.:
{fetched, pages: {заголовок: {maker, revid, ts, en, boxes: [{head, name, sub, sale, prod, code}]}}},
где boxes — поля карточек «Infobox 自動車のスペック表» (車名, 車名補, 販売期間, 製造期間, 型式) и заголовок раздела над карточкой.
Из каждой карточки берутся коды кузова (BNR34, ZZT231, JB64W…) и годы продаж; модель — английское название статьи
(межъязыковая ссылка), иначе японское; поколение — по заголовку раздела («5代目»).
"""
import json, re, sys
SRC, OUT = sys.argv[1], (sys.argv[2] if len(sys.argv) > 2 else None)
d = json.load(open(SRC, encoding='utf-8'))
BRAND = {'トヨタの車種': 'Toyota', '日産の車種': 'Nissan', 'ホンダの車種': 'Honda', 'マツダの車種': 'Mazda', 'スバルの車種': 'Subaru',
         '三菱の車種': 'Mitsubishi', 'スズキの車種': 'Suzuki', 'ダイハツの車種': 'Daihatsu', 'レクサスの車種': 'Lexus'}
KANJI_NUM = {'初': 1, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10}

def clean(s):
    s = re.sub(r'<!--.*?-->', '', s, flags=re.S)
    s = re.sub(r'<ref[^>/]*/>', '', s)
    s = re.sub(r'<ref[^>]*>.*?</ref>', '', s, flags=re.S)
    s = re.sub(r'\[\[(?:[^\]|]*\|)?([^\]]*)\]\]', r'\1', s)
    s = re.sub(r'\{\{[^{}]*\}\}', ' ', s)
    s = re.sub(r'<[^>]+>', ' ', s)
    s = s.translate(str.maketrans('ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺ０１２３４５６７８９－／', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-/'))
    return s

# Код кузова: 1–5 латинских букв, 1–3 цифры, до 3 букв в конце (BNR34, ZZT231, JB64W, NA6CE, CT9A, R35).
# «#» в Википедии — любая цифра: «NCP6#» = NCP60, NCP61, NCP65; такие коды сохраняются как есть, декодер сравнивает по шаблону.
# «*» в начале — серия Toyota («*X10#» из «X100系»): перед буквой серии 1–3 буквы двигателя.
# Префикс сертификации («GF-», «DBA-», «E-») отрезается. Сокращения «ZZT230/231», «AE85/86» разворачиваются.
TOKEN = re.compile(r'(?<![A-Za-z0-9])(?:[A-Z0-9]{1,4}-)?([A-Z]{1,5})(\d{1,3}#{0,2}|\d?#{1,2})([A-Z]{0,3})(?![a-z0-9])')
SLASH = re.compile(r'/([A-Z]{0,5})(\d{1,3}#{0,2})([A-Z]{0,3})(?![a-z0-9])')
def codes_in(text, need_kata=False):
    """Коды из текста. need_kata: только с «型» после кода (для заголовков и свободного текста)."""
    out = []
    t = clean(text)
    # «SCP/NCP/NLP1#型» — общий числовой хвост у нескольких буквенных частей: SCP1#, NCP1#, NLP1#
    t = re.sub(r'(?<![A-Z0-9])((?:[A-Z]{2,5}/)+)([A-Z]{2,5})(\d{1,3}#{0,2}[A-Z]{0,3})',
               lambda m: '/'.join(x + m.group(3) for x in m.group(1).rstrip('/').split('/') + [m.group(2)]), t)
    for m in TOKEN.finditer(t):
        code = m.group(1) + m.group(2) + m.group(3)
        tail = t[m.end():m.end() + 12]
        if need_kata and not re.match(r'(?:/[A-Z0-9]+)*型', tail): continue
        # «E30系», «X100系» — серия (у Toyota это семейство кодов), а не код кузова; серии разбираются отдельно
        if len(m.group(1)) == 1 and re.match(r'(?:/[A-Z]?\d+)*系', tail): continue
        if len(code) < 3: continue
        out.append(code)
        # «/231» или «/KPGC10» после кода
        pos = m.end()
        while (s := SLASH.match(t, pos)):
            out.append((s.group(1) or m.group(1)) + s.group(2) + s.group(3))
            pos = s.end()
    # буквенные коды Subaru и др. («GDB型», «VAB型») — только перед «型»
    for m in re.finditer(r'(?<![A-Za-z0-9-])([A-Z]{3,4})型', t):
        out.append(m.group(1))
    return out

NOT_CODE = {'MT', 'AT', 'CVT', 'DOHC', 'SOHC', 'SUV', 'FF', 'FR', 'MR', 'RR', 'AWD', 'PS', 'RPM', 'GT', 'JPN', 'USA', 'EV', 'HV', 'PHEV'}
def years(*texts):
    ys = []
    for t in texts:
        for y in re.findall(r'(?<!\d)((?:19|20)\d\d)年', t or ''): ys.append(int(y))
    if not ys: return ''
    open_end = any(re.search(r'(現在|販売中|-\s*$|－\s*$|–\s*$)', clean(t or '')) for t in texts if t)
    a, b = min(ys), max(ys)
    if open_end and a == b: return f'{a}–'
    return f'{a}' if a == b else f'{a}–{b}'
def generation(head, sub):
    t = clean(head) + ' ' + clean(sub)
    if re.search(r'初代', t): return 1
    m = re.search(r'(\d+|[一二三四五六七八九十]+)代目', t)
    if not m: return None
    g = m.group(1)
    if g.isdigit(): return int(g)
    if g == '初': return 1
    if g.startswith('十'): return 10 + (KANJI_NUM.get(g[1:], 0) if len(g) > 1 else 0)
    return KANJI_NUM.get(g)

# Марка по английскому названию статьи, если это другая марка (Mitsuoka Viewt в категории Nissan — это Mitsuoka)
MAKES = ['Toyota', 'Lexus', 'Nissan', 'Datsun', 'Infiniti', 'Prince', 'Honda', 'Acura', 'Mazda', 'Subaru', 'Mitsubishi', 'Suzuki', 'Daihatsu',
         'Mitsuoka', 'Isuzu', 'Hino', 'Scion', 'Eunos', 'Autozam', 'Efini']
def english_name(title, pages):
    """Английское название: своё, иначе статьи-«родителя» («日産・マーチ K12» -> «日産・マーチ» -> Nissan March) с уточнением в скобках"""
    p = pages[title]
    if p.get('en'): return re.sub(r'\s*\((car|automobile|vehicle)\)$', '', p['en'])
    best = None
    for t, q in pages.items():
        if q.get('en') and t != title and title.startswith(t) and (best is None or len(t) > len(best)): best = t
    if not best: return None
    rest = title[len(best):].strip(' ・()（）')
    rest = re.sub(r'\(?\d+代目\)?', '', rest).strip()   # поколение берётся отдельно (из заголовка статьи)
    base = re.sub(r'\s*\((car|automobile|vehicle)\)$', '', pages[best]['en'])
    return f'{base} ({rest})' if rest and not re.search(r'[\u3040-\u30ff\u4e00-\u9fff]', rest) else base

def merge_years(a, b):
    ys = [int(x) for x in re.findall(r'\d{4}', a + ' ' + b)]
    open_end = a.endswith('–') or b.endswith('–')
    lo, hi = min(ys), max(ys)
    return f'{lo}–' if open_end else (f'{lo}' if lo == hi else f'{lo}–{hi}')

M = {}
stats = {'pages': 0, 'boxes': 0, 'codes': 0, 'ja_names': 0}
for title, p in sorted(d['pages'].items()):
    brand = BRAND.get(p['maker'] or '')
    if not brand: continue
    stats['pages'] += 1
    name = english_name(title, d['pages'])
    if name:
        first = name.split(' ')[0]
        if first in MAKES: brand = first
    else:
        name = title; stats['ja_names'] += 1
    tgen = re.search(r'(\d+)代目', title)
    base = re.split(r'[ （(]', title.split('・', 1)[-1])[0]
    for b in p['boxes']:
        # карточка другой машины внутри статьи (тюнинг-версия «トムス・T020» в статье о MR2) — пропускаем
        nm = clean(b['name']).strip()
        if nm and base and base not in nm and b['head'].startswith('==='): stats['skipped'] = stats.get('skipped', 0) + 1; continue
        found = []
        for f in ('code', 'sub'): found += codes_in(b[f])
        found += codes_in(b['head'], need_kata=True)
        found = [c for c in dict.fromkeys(found) if c not in NOT_CODE and not re.fullmatch(r'[A-Z]+\d{4}', c)]
        # «E5#», «R3#» (одна буква и «#») — тоже серия: перед буквой в настоящем коде стоят буквы двигателя (TE51, YR30)
        found = [('*' + c) if re.fullmatch(r'[A-Z]\d+#', c) else c for c in found]
        # Toyota часто пишет не код, а серию: «X100系» = все коды на X10x (JZX100, GX100…), «E100系» = AE101, CE100…
        # Только трёхзначные серии: двузначные («H10系» — первый HiAce) совпали бы с современными кодами вроде ANH10.
        if brand in ('Toyota', 'Lexus'):
            for sm in re.finditer(r'(?<![A-Z0-9])([A-Z])(\d{2})0系', clean(b['sub']) + ' ' + clean(b['head'])):
                found.append(f'*{sm.group(1)}{sm.group(2)}#')
            found = list(dict.fromkeys(found))
        if not found: continue
        stats['boxes'] += 1
        y = years(b['sale'], b['prod']) or years(b['head'])
        g = generation(b['head'], b['sub']) or (int(tgen.group(1)) if tgen else None)
        for c in found:
            e = [brand, name, g or 0, y, title, p['revid']]
            lst = M.setdefault(c, [])
            same = next((x for x in lst if x[1] == e[1] and x[2] == e[2]), None)
            if not same: lst.append(e)
            elif y and same[3] != y: same[3] = merge_years(same[3], y)   # несколько карточек одной модели (Evolution VII, VIII, IX)
            stats['codes'] += 1
# общая карточка статьи (поколение не указано, годы — за всю историю модели) не нужна, если тот же код есть в карточке поколения
for c, lst in M.items():
    with_gen = {e[4] for e in lst if e[2]}
    M[c] = [e for e in lst if e[2] or e[4] not in with_gen]
print(stats, 'кодов:', len(M), file=sys.stderr)
if OUT:
    rev = {t: p['revid'] for t, p in d['pages'].items()}
    head = ("// Коды кузова японских моделей (型式) по японской Википедии (CC BY-SA 4.0): карточки «Infobox 自動車のスペック表»\n"
            f"// в статьях категорий марок, данные на {d['fetched'][:10]}. Собрано tools/build_jdm_wiki.py; исходник — tools/sources. См. NOTICE.txt\n"
            "import type { Dict } from './types';\n"
            "/** код -> [марка, модель (название статьи в английской Википедии или японское), поколение (0 = нет), годы продаж, статья ja.wikipedia] */\n")
    out = {c: [e[:5] for e in v] for c, v in sorted(M.items())}
    open(OUT, 'w', encoding='utf-8').write(head + 'export const JDM_WIKI: Dict<[string, string, number, string, string][]> = ' +
                                            json.dumps(out, ensure_ascii=False, separators=(',', ':')) + ';\n')
else:
    json.dump(M, sys.stdout, ensure_ascii=False)
