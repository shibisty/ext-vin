#!/usr/bin/env python3
"""Сборка src/data/ussr.ts из выгрузки русской Википедии (tools/sources/ruwiki-vin-ussr-*.json).

Что берётся:
  * статья «Идентификационный номер транспортного средства», разделы «WMI заводов бывшего СССР» и
    «WMI мелких заводов бывшего СССР» → словарь WMI (3 символа или 6 для мелких: WMI + символы 12–14);
  * названия статей о моделях с индексом («ВАЗ-21099», «ГАЗ-3302», …) и перенаправления → индекс модели → статья;
  * межъязыковые ссылки на английскую Википедию → английские названия (иначе транслитерация).

Запуск: python3 tools/build_ussr.py tools/sources/ruwiki-vin-ussr-2026-11-12.json > src/data/ussr.ts
Выход детерминирован (ключи отсортированы).
"""
import json
import re
import sys

SRC = sys.argv[1]
d = json.load(open(SRC, encoding='utf-8'))
ART = d['articles']['Идентификационный номер транспортного средства']
REDIR = d['redirects']
PAGES = d['pages']
LL = d['langlinks_en']
WL_RED = d['wmi_links']['redirects']
WL_LL = d['wmi_links']['langlinks_en']

# ---------- транслитерация (упрощённая BGN/PCGN) ----------
TR = dict(zip('абвгдезийклмнопрстуфыэ', 'abvgdeziyklmnoprstufye'))
TR.update({'ё': 'yo', 'ж': 'zh', 'х': 'kh', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'shch', 'ъ': '', 'ь': '', 'ю': 'yu', 'я': 'ya',
           'і': 'i', 'ї': 'yi', 'є': 'ye', 'ґ': 'g'})
ORG = [('ФГУП', 'FSUE'), ('ГУП', 'SUE'), ('ООО', 'LLC'), ('ОАО', 'OJSC'), ('ЗАО', 'CJSC'), ('ПАО', 'PJSC'), ('АООТ', 'OJSC'),
       ('АО', 'JSC'), ('ТОО', 'LLP'), ('ЧП', 'PE'), ('ГП', 'SE'), ('НПК', 'SPC'), ('НПФ', 'SPF'), ('НПО', 'SPA'), ('ПК', 'PC'), ('ПП', 'PE')]
COUNTRY = {'Россия': 'Russia', 'Украина': 'Ukraine', 'Беларусь': 'Belarus', 'Казахстан': 'Kazakhstan', 'Узбекистан': 'Uzbekistan',
           'Латвия': 'Latvia', 'Литва': 'Lithuania', 'Эстония': 'Estonia', 'Киргизия': 'Kyrgyzstan', 'Таджикистан': 'Tajikistan',
           'Армения': 'Armenia', 'Грузия': 'Georgia', 'Азербайджан': 'Azerbaijan', 'Молдавия': 'Moldova', 'Туркмения': 'Turkmenistan',
           'СССР': 'USSR'}


def translit(s: str) -> str:
    for ru, en in ORG:
        s = re.sub(r'(?<![А-Яа-яЁё])' + ru + r'(?![А-Яа-яЁё])', en, s)
    out = []
    for i, ch in enumerate(s):
        low = ch.lower()
        if low in TR:
            t = TR[low]
            if ch != low and t:
                nxt = s[i + 1] if i + 1 < len(s) else ''
                t = t.upper() if (nxt.isupper() and len(t) > 1) else t[0].upper() + t[1:]
            out.append(t)
        elif ch in '«»„“':
            out.append('"')
        elif ch == '№':
            out.append('No.')
        else:
            out.append(ch)
    return ''.join(out)


def has_cyr(s: str) -> bool:
    return bool(re.search(r'[А-Яа-яЁёІіЇїЄєҐґ]', s))


# ---------- разбор вики-разметки ----------
def clean(s: str) -> str:
    s = re.sub(r'<ref[^>]*/>|<ref[^>]*>.*?</ref>', '', s, flags=re.S)
    s = re.sub(r'\{\{iw\|[^|}]*\|([^|}]*)\|[^}]*\}\}', r'\1', s)
    s = re.sub(r'\{\{[^{}]*\}\}', '', s)
    s = re.sub(r'\[\[(?:[^|\]]*\|)?([^\]]*)\]\]', r'\1', s)
    s = re.sub(r'\[https?://\S+ ([^\]]*)\]', r'\1', s)
    s = re.sub(r'<br\s*/?>', ' / ', s)
    s = re.sub(r'<[^>]+>', '', s)
    s = s.replace(' ', ' ')
    return re.sub(r'\s+', ' ', s).strip(' |')


def first_link(s: str):
    m = re.search(r'\[\[([^|\]#]+)', s) or re.search(r'\{\{iw\|([^|}]*)', s)
    return m.group(1).strip() if m else None


def cells(row: str):
    parts = re.split(r'\|\||\n\|', '\n' + row)
    out = []
    for p in parts:
        p = p.strip()
        if not p or p.startswith('-'):
            continue
        p = re.sub(r'^(?:rowspan|colspan|style|class)\s*=\s*"[^"]*"\s*\|', '', p).strip()
        out.append(p)
    return out


LOOK = str.maketrans({'А': 'A', 'В': 'B', 'Е': 'E', 'К': 'K', 'М': 'M', 'Н': 'H', 'О': 'O', 'Р': 'P', 'С': 'C', 'Т': 'T', 'У': 'Y', 'Х': 'X'})

t = ART['text']
sec = t[t.index('WMI заводов бывшего СССР'):t.index('== VDS')]
wmi_ru, wmi_link = {}, {}
last_country = None
for tbl in re.findall(r'\{\|.*?\n\|\}', sec, flags=re.S):
    for row in re.split(r'\n\|-+', tbl)[1:]:
        c = cells(row)
        if len(c) < 2:
            continue
        code = clean(c[0]).translate(LOOK).replace(' ', '')
        m = re.match(r'^([A-Z0-9]{3})$', code) or re.match(r'^([A-Z0-9]{2}9)[.…]+([A-Z0-9]{3})[.…]*$', code)
        if not m:
            continue
        key = m.group(1) + (m.group(2) if m.lastindex == 2 else '')
        name = clean(c[1])
        city = clean(c[2]) if len(c) > 2 else ''
        country = clean(c[3]) if len(c) > 3 else ''
        if country:
            last_country = country
        elif city in COUNTRY:          # ячейка города объединена: страна сдвинулась
            country, city = city, ''
        else:
            country = last_country or ''
        name = re.sub(r'\s*\(позднее[^)]*\)', '', name)
        name = re.sub(r' / [^/]*\bкод\b.*$', '', name)   # примечание о прежнем коде в той же ячейке
        if not name:
            continue
        place = ', '.join(x for x in (city, country) if x)
        wmi_ru[key] = f'{name} ({place})' if place else name
        wmi_link[key] = (first_link(c[1]), name, city, country)

# ---------- бренды и индексы моделей ----------
BRAND = {  # префикс в названиях статей → ключ марки
    'ВАЗ': 'ВАЗ', 'ГАЗ': 'ГАЗ', 'УАЗ': 'УАЗ', 'ЗАЗ': 'ЗАЗ', 'Москвич': 'Москвич', 'АЗЛК': 'Москвич', 'ИЖ': 'ИЖ', 'Иж': 'ИЖ',
    'ЛуАЗ': 'ЛуАЗ', 'КамАЗ': 'КамАЗ', 'МАЗ': 'МАЗ', 'ЗИЛ': 'ЗИЛ', 'ЗиЛ': 'ЗИЛ', 'ПАЗ': 'ПАЗ', 'КАвЗ': 'КАвЗ', 'ЛиАЗ': 'ЛиАЗ',
    'ЛАЗ': 'ЛАЗ', 'РАФ': 'РАФ', 'КрАЗ': 'КрАЗ', 'Урал': 'Урал', 'СеАЗ': 'СеАЗ', 'БелАЗ': 'БелАЗ', 'МоАЗ': 'МоАЗ', 'НефАЗ': 'НефАЗ',
    'ГолАЗ': 'ГолАЗ', 'Богдан': 'Богдан', 'ЕрАЗ': 'ЕрАЗ'}
BRAND_EN = {'ВАЗ': 'VAZ', 'ГАЗ': 'GAZ', 'УАЗ': 'UAZ', 'ЗАЗ': 'ZAZ', 'Москвич': 'Moskvitch', 'ИЖ': 'IZh', 'ЛуАЗ': 'LuAZ', 'КамАЗ': 'KamAZ',
            'МАЗ': 'MAZ', 'ЗИЛ': 'ZIL', 'ПАЗ': 'PAZ', 'КАвЗ': 'KAvZ', 'ЛиАЗ': 'LiAZ', 'ЛАЗ': 'LAZ', 'РАФ': 'RAF', 'КрАЗ': 'KrAZ', 'Урал': 'Ural',
            'СеАЗ': 'SeAZ', 'БелАЗ': 'BelAZ', 'МоАЗ': 'MoAZ', 'НефАЗ': 'NefAZ', 'ГолАЗ': 'GolAZ', 'Богдан': 'Bogdan', 'ЕрАЗ': 'ErAZ'}
# Название предприятия в таблице WMI → марка (ключ из BRAND)
MAKER = [(r'АвтоВАЗ', 'ВАЗ'), (r'^ГАЗ$', 'ГАЗ'), (r'\(УАЗ\)', 'УАЗ'), (r'^ЗАЗ$', 'ЗАЗ'), (r'^Москвич$', 'Москвич'), (r'^ИжАвто$', 'ИЖ'),
         (r'^ЛуАЗ', 'ЛуАЗ'), (r'\(КамАЗ\)', 'КамАЗ'), (r'^МАЗ$', 'МАЗ'), (r'^ЗИЛ$', 'ЗИЛ'), (r'\(ПАЗ\)', 'ПАЗ'), (r'\(КАвЗ\)', 'КАвЗ'),
         (r'^ЛиАЗ$', 'ЛиАЗ'), (r'^ЛАЗ$', 'ЛАЗ'), (r'\(РАФ\)', 'РАФ'), (r'^КрАЗ$|\(КрАЗ\)', 'КрАЗ'), (r'\(Урал\)', 'Урал'), (r'^СеАЗ$', 'СеАЗ'),
         (r'\(БелАЗ\)', 'БелАЗ'), (r'^МоАЗ$', 'МоАЗ'), (r'^НЕФАЗ$', 'НефАЗ'), (r'^ГолАЗ$', 'ГолАЗ')]
wmi_brand = {}
for k, (_, name, _, _) in wmi_link.items():
    for rx, b in MAKER:
        if re.search(rx, name):
            wmi_brand.setdefault(k, [])
            if b not in wmi_brand[k]:
                wmi_brand[k].append(b)
# ПАЗ в 1986–1997 годах ставил код XTM (в таблице — МАЗ); Y6L — ЛуАЗ, где собирали и «Богдан»
wmi_brand.setdefault('XTM', []).append('ПАЗ')
if 'Y6L' in wmi_brand:
    wmi_brand['Y6L'].append('Богдан')


def target_of(title):
    tg = REDIR.get(title, title)
    page = tg.split('#')[0]
    return tg, page


# статьи о двигателях, названные по индексу без пометки «двигатель»
ENGINE_PAGES = {'ВАЗ-21129', 'ВАЗ-21179'}
models = {}
for title in sorted(d['titles']):
    m = re.match(r'^([А-ЯЁA-Za-zа-яё]+)[- ](\d{4,6})(?:\s+(?:«[^»]*»|"[^"]*"|\([^)]*\)|[А-ЯЁA-Z][\w-]*))?$', title)
    if not m or m.group(1) not in BRAND:
        continue
    b, idx = BRAND[m.group(1)], m.group(2)
    tg, page = target_of(title)
    info = PAGES.get(page)
    if not info or info.get('missing') or info.get('disamb'):
        continue
    if re.search(r'\((?:двигатель|футбольный клуб|значения)\)', page) or 'автомобильный завод' in page or page.startswith('Список'):
        continue
    if re.search(r'двигател', page, re.I) or re.search(r'\bengine\b', LL.get(page, ''), re.I):
        continue   # индексы двигателей (ВАЗ-21126) — не модели машин
    if page in ENGINE_PAGES:
        continue
    cur = models.setdefault(b, {}).get(idx)
    # одна и та же модель под несколькими написаниями: берём точное «Марка-индекс» (без названия в кавычках)
    if cur is None or (title == f'{m.group(1)}-{idx}' and cur[0] != title):
        models[b][idx] = (title, page)

# ---------- английские подписи ----------
en = {}
for b, e in BRAND_EN.items():
    en[b] = e
for prefix, b in BRAND.items():
    if prefix != b:
        en[prefix] = BRAND_EN[b]
for b, idx_map in models.items():
    for idx, (title, page) in idx_map.items():
        if has_cyr(page) and page not in en:
            en[page] = LL.get(page) or translit(page)
for k, (link, name, city, country) in wmi_link.items():
    ru = wmi_ru[k]
    if not has_cyr(ru):
        continue
    page = WL_RED.get(link, link) if link else None
    nm = WL_LL.get(page) if page else None
    nm = re.sub(r' \((?:company|manufacturer|automobile manufacturer|plant|factory)\)$', '', nm) if nm else translit(name)
    place = ', '.join(x for x in (translit(city) if city else '', COUNTRY.get(country, translit(country)) if country else '') if x)
    en[ru] = f'{nm} ({place})' if place else nm


def js(o):
    return json.dumps(o, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


out = ['// Заводы бывшего СССР: WMI и индексы моделей. Собрано tools/build_ussr.py из русской Википедии (CC BY-SA 4.0):',
       f"// статья «Идентификационный номер транспортного средства», ревизия {ART['revid']}, и названия статей о моделях (выгрузка {d['fetched'][:10]}).",
       '// Английские названия — по межъязыковым ссылкам на английскую Википедию, иначе транслитерация. Не править вручную.',
       "import type { Dict } from './types';",
       '',
       '/** WMI (3 символа; у мелких заводов 6: WMI + символы 12–14) → «предприятие (город, страна)» */',
       f'export const USSR_WMI: Dict = {js(wmi_ru)};',
       '/** WMI → марки, под которыми искать индекс модели */',
       f'export const USSR_BRAND: Record<string, string[]> = {js(wmi_brand)};',
       '/** Марка → индекс модели (4–6 цифр) → статья русской Википедии */',
       f'export const USSR_MODELS: Record<string, Dict> = {js({b: {i: p for i, (_, p) in v.items()} for b, v in models.items()})};',
       '/** Английские подписи для всего выше (подставляются целиком) */',
       f'export const USSR_EN: Dict = {js(en)};',
       '']
sys.stdout.write('\n'.join(out))
print(f'WMI {len(wmi_ru)}, с марками {len(wmi_brand)}, моделей {sum(len(v) for v in models.values())}, EN {len(en)}', file=sys.stderr)
