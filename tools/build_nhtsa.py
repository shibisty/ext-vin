"""Сборка офлайн-данных NHTSA из дампа vPICList_lite_*.sql (PostgreSQL).
Использование: python3 build_nhtsa.py дамп.sql ../public/nhtsa

Что попадает в данные (правила те же, что в vpic.spvindecode_core из самого дампа):
  * шаблоны VIN (pattern) по всем публичным элементам, кроме служебных (26, 27, 29, 39);
  * формульные шаблоны: ключи с «#», значение берётся из самих символов VIN (длина прицепа, оси и т. п.);
  * свойства двигателя по имени модели двигателя (enginemodelpattern);
  * Vehicle Specs: оснащение по марке, модели, году и типу ТС (ABS, ESC, подушки, размеры…);
  * значения по умолчанию для типа ТС (defaultvalue).
Разбор дампа занимает около минуты; с VPIC_CACHE=файл.pickle первый запуск только сохраняет разобранные таблицы,
второй (с тем же VPIC_CACHE) собирает данные из них. VPIC_NOW=ГГГГ-ММ-ДД фиксирует дату публикации WMI.
Выход детерминирован: при одном и том же дампе файлы совпадают побайтно.
"""
import sys, collections, json, os, re, shutil, datetime
SRC = sys.argv[1] if len(sys.argv) > 1 else 'vPICList_lite.sql'
OUT = sys.argv[2] if len(sys.argv) > 2 else '../public/nhtsa'
# дата «сегодня» для publicavailabilitydate; можно зафиксировать для воспроизводимой сборки
NOW = os.environ.get('VPIC_NOW') or datetime.date.today().isoformat()
WANT = {'pattern', 'element', 'wmi', 'wmi_vinschema', 'vinschema', 'make', 'model', 'make_model', 'manufacturer', 'country', 'vehicletype', 'enginemodel',
        'enginemodelpattern', 'vindescriptor', 'vinexception', 'wmi_make', 'vehiclespecschema', 'vehiclespecschema_model', 'vehiclespecschema_year',
        'vspecschemapattern', 'vehiclespecpattern', 'grossvehicleweightrating', 'defaultvalue'}
def parse(src):
    T = {}; COLS = {}; cur = None
    for line in open(src, encoding='utf-8', errors='replace'):
        if cur is None:
            if line.startswith('COPY vpic.'):
                nm = line.split('(')[0].replace('COPY vpic.', '').strip()
                cols = [c.strip().strip('"') for c in line[line.index('(') + 1:line.index(')')].split(',')]
                cur = nm if nm in WANT or cols == ['id', 'name'] else '__skip__'   # плюс все справочники «id — название»
                if cur != '__skip__': T[cur] = []; COLS[cur] = cols
        elif line.startswith('\\.'): cur = None
        elif cur != '__skip__': T[cur].append([unesc(x) for x in line.rstrip('\n').split('\t')])
    return T, COLS
# текстовый формат COPY экранирует спецсимволы обратной косой (\r, \n, \t, \\); \N — это NULL, его не трогаем
ESC = {'b': '\b', 'f': '\f', 'n': '\n', 'r': '\r', 't': '\t', 'v': '\v', '\\': '\\'}
def unesc(x):
    if '\\' not in x or x == '\\N': return x
    return re.sub(r'\\([bfnrtv\\]|[0-7]{1,3}|x[0-9A-Fa-f]{1,2})', lambda m: ESC.get(m.group(1)) or (chr(int(m.group(1)[1:], 16)) if m.group(1)[0] == 'x' else chr(int(m.group(1), 8))), x)
# VPIC_CACHE=файл.pickle: разобранные таблицы сохраняются и при повторной сборке читаются оттуда (разбор дампа — самая долгая часть)
CACHE = os.environ.get('VPIC_CACHE')
if CACHE and os.path.exists(CACHE):
    import pickle
    with open(CACHE, 'rb') as f: T, COLS = pickle.load(f)
else:
    T, COLS = parse(SRC)
    if CACHE:
        import pickle
        with open(CACHE, 'wb') as f: pickle.dump((T, COLS), f, protocol=pickle.HIGHEST_PROTOCOL)
        print('таблицы сохранены в', CACHE); sys.exit(0)
NA = '\\N'
def d(x): return None if x == NA else x
def days(ts):
    if not ts or ts == NA: return 0
    y, m, dd = int(ts[:4]), int(ts[5:7]), int(ts[8:10]); return (datetime.date(y, m, dd) - datetime.date(2015, 1, 1)).days
shutil.rmtree(OUT, ignore_errors=True); os.makedirs(OUT + '/shards'); os.makedirs(OUT + '/specs')
def dump(path, obj):
    with open(f'{OUT}/{path}', 'w', encoding='utf-8') as f: f.write(json.dumps(obj, ensure_ascii=False, separators=(',', ':')))
    return os.path.getsize(f'{OUT}/{path}')
dump('exceptions.json', sorted(r[1] for r in T['vinexception'] if r[2] == 't'))

# --- элементы
ELEM = {int(r[0]): r for r in T['element']}
EC = COLS['element']
def ecol(r, name): return r[EC.index(name)]
# исходный набор (до расширения): порядок и метки шаблонов строятся по нему, чтобы старые расшифровки не менялись
CORE = {28, 34, 38, 5, 14, 15, 9, 13, 11, 12, 71, 125, 21, 18, 24, 66, 64, 37, 63, 25, 75, 77, 31, 76, 10, 135, 126, 67, 62, 17, 146}
# все публичные элементы с декодированием, кроме служебных (26 марка, 27 производитель, 29 год, 39 тип ТС считаются отдельно)
used_el = {int(r[3]) for r in T['pattern']} | {int(r[3]) for r in T['vehiclespecpattern']} | {int(r[2]) for r in T['enginemodelpattern']}
KEEP = {i for i, r in ELEM.items() if d(ecol(r, 'decode')) and ecol(r, 'isprivate') != 't' and i not in (26, 27, 29, 39) and i in used_el}
print('элементов:', len(KEEP), '| из них новых:', len(KEEP - CORE))

# --- WMI
W = {}   # id -> row
for r in T['wmi']:
    pub = d(r[8])
    if pub and pub[:10] <= NOW: W[r[0]] = r
vs_ok = {r[0] for r in T['vinschema'] if r[5] != 't'}
wvs = collections.defaultdict(list)
for r in T['wmi_vinschema']:
    if r[1] in W and r[2] in vs_ok: wvs[r[1]].append((int(r[3]) if d(r[3]) else 0, int(r[4]) if d(r[4]) else 0, r[2]))

# --- шаблоны по схемам: schema -> key -> [(el, attr, ts, core_order)]
groups = collections.defaultdict(lambda: collections.defaultdict(list))
used_schema = {s for v in wvs.values() for _, _, s in v}
n_formula = 0
for n, r in enumerate(T['pattern']):   # порядок дампа: от него зависит порядок ключей в шардах
    el = int(r[3])
    if r[1] in used_schema and el in KEEP:
        if '#' in r[2]: n_formula += 1
        groups[r[1]][r[2].upper()].append((el, r[4].strip(), max(days(r[5]), days(r[6])), n))
print('схем с шаблонами:', len(groups), 'из', len(used_schema), '| формульных шаблонов:', n_formula)

# --- порядок схем и шарды: по WMI в алфавитном порядке
wmi_order = sorted(W.values(), key=lambda r: r[1])
schema_pos = {}; order = []
for r in wmi_order:
    for _, _, s in sorted(wvs.get(r[0], [])):
        if s not in schema_pos and s in groups: schema_pos[s] = len(order); order.append(s)

def shard_rows(s):
    """Строки шаблонов схемы. Ключи с исходными элементами идут первыми и в прежнем порядке,
    отметка времени ключа считается по ним же: так расшифровка исходных полей не меняется."""
    rows = []
    for key, pairs in groups[s].items():
        core = [p for p in pairs if p[0] in CORE]
        extra = [p for p in pairs if p[0] not in CORE]
        ts = max(p[2] for p in (core or extra))
        rows.append(((0, core[0][3]) if core else (1, extra[0][3]), key, ts, core + extra))
    rows.sort(key=lambda x: x[0])   # ключи с исходными элементами — по первому их появлению в дампе, как раньше
    return rows

def shard_json(schemas):
    strs = {}; S = []
    def si(a):
        if a not in strs: strs[a] = len(S); S.append(a)
        return strs[a]
    G = []
    for s in schemas:
        items = []
        for _, key, ts, pairs in shard_rows(s):
            row = [key, ts]
            for e, a, _, _ in pairs: row += [e, si(a)]
            items.append(row)
        G.append([schema_pos[s], items])
    return {'s': S, 'g': G}
shards = []; cur = []; cursz = 0
for s in order:
    sz = sum(len(k) + 12 * len(p) for k, p in groups[s].items())
    if cur and cursz + sz > 220000: shards.append(cur); cur = []; cursz = 0
    cur.append(s); cursz += sz
if cur: shards.append(cur)
shard_of = {}
total = 0
for i, sch in enumerate(shards):
    total += dump(f'shards/{i:03d}.json', shard_json(sch))
    for s in sch: shard_of[s] = i
print('шардов:', len(shards), '| байт:', total)

# --- индекс WMI
def has_core(s): return any(p[0] in CORE and '#' not in k for k, ps in groups[s].items() for p in ps)
IDX = {}
for r in wmi_order:
    sc = []
    for yf, yt, s in sorted(wvs.get(r[0], [])):
        # пятый элемент 0: в схеме нет шаблонов исходных элементов (только прицепы, оси…); генератор номеров такие пропускает
        if s in shard_of: sc.append([yf, yt, shard_of[s], schema_pos[s]] + ([] if has_core(s) else [0]))
    IDX[r[1]] = [int(r[2]), int(r[3]) if d(r[3]) else 0, int(r[4]) if d(r[4]) else 0, int(r[9]) if d(r[9]) else 0, int(r[7]) if d(r[7]) else 0, sc]
print('index.json', dump('index.json', IDX), 'WMI:', len(IDX))

# --- Vehicle Specs: схема -> шаблоны [[ключевые el, attr…], [el, attr, ts…]]
vss = {r[0]: r for r in T['vehiclespecschema'] if r[6] != 't'}
vss_models = collections.defaultdict(set)
for r in T['vehiclespecschema_model']:
    if r[1] in vss: vss_models[r[1]].add(int(r[2]))
vss_years = collections.defaultdict(set)
for r in T['vehiclespecschema_year']:
    if r[1] in vss: vss_years[r[1]].add(int(r[2]))
vsp_schema = {r[0]: r[1] for r in T['vspecschemapattern'] if r[1] in vss}
spat = collections.defaultdict(lambda: ([], []))
for r in sorted(T['vehiclespecpattern'], key=lambda r: int(r[0])):
    p = r[1]
    if p not in vsp_schema: continue
    el = int(r[3])
    if el not in KEEP: continue   # приватные элементы (NCSA) публичный декодер не видит
    if r[2] == 't': spat[p][0].append((el, r[4].strip()))
    else: spat[p][1].append((el, r[4].strip(), max(days(r[5]), days(r[6]))))
# шаблон без ключей процедура не применяет (выборка идёт через IsKey = true); ключ с приватным элементом не совпадёт никогда
priv_key = {r[1] for r in T['vehiclespecpattern'] if r[2] == 't' and int(r[3]) not in KEEP}
by_schema = collections.defaultdict(list)
for p in sorted(spat, key=int):
    keys, vals = spat[p]
    if keys and vals and p not in priv_key: by_schema[vsp_schema[p]].append((keys, vals))
spec_order = sorted(by_schema, key=int)
spec_shards = []; cur = []; cursz = 0
for s in spec_order:
    sz = sum(20 * (len(k) + len(v)) for k, v in by_schema[s])
    if cur and cursz + sz > 220000: spec_shards.append(cur); cur = []; cursz = 0
    cur.append(s); cursz += sz
if cur: spec_shards.append(cur)
SPEC_IDX = collections.defaultdict(list)   # модель -> [[марка, тип ТС, [годы], шард, индекс схемы]]
stotal = 0
for i, sch in enumerate(spec_shards):
    strs = {}; S = []
    def si(a):
        if a not in strs: strs[a] = len(S); S.append(a)
        return strs[a]
    G = []
    for j, s in enumerate(sch):
        pats = []
        for keys, vals in by_schema[s]:
            kr = []; vr = []
            for e, a in keys: kr += [e, si(a)]
            for e, a, ts in vals: vr += [e, si(a), ts]
            pats.append([kr, vr])
        G.append(pats)
        r = vss[s]
        for m in sorted(vss_models[s]): SPEC_IDX[str(m)].append([int(r[1]), int(r[4]), sorted(vss_years[s]), i, j])
    stotal += dump(f'specs/{i:03d}.json', {'s': S, 'g': G})
stotal += dump('specs/index.json', dict(sorted(SPEC_IDX.items(), key=lambda x: int(x[0]))))
print('Vehicle Specs: схем', len(spec_order), '| шаблонов', sum(len(v) for v in by_schema.values()), '| шардов', len(spec_shards), '| байт', stotal)

# --- справочники
mm = {}
for r in T['make_model']: mm.setdefault(r[2], r[1])   # modelid -> makeid
make = {r[0]: r[1] for r in T['make']}; model = {r[0]: r[1] for r in T['model']}
need_models = {a for s in groups.values() for pairs in s.values() for e, a, _, _ in pairs if e == 28}
need_make = {mm[m] for m in need_models if m in mm} | {r[3] for r in W.values() if d(r[3])} | {r[1] for r in T['wmi_make'] if r[0] in W} | {r[3] for r in W.values()} \
    | {vss[s][1] for s in spec_order}
mfr = {r[0]: r[1] for r in T['manufacturer']}
need_mfr = {r[2] for r in W.values()}
wmi_make = collections.defaultdict(list)
for r in T['wmi_make']:
    if r[0] in W: wmi_make[W[r[0]][1]].append(int(r[1]))
def simple(t): return {r[0]: r[1] for r in T[t]}
def ordered(dct): return dict(sorted(dct.items(), key=lambda x: (len(x[0]), x[0])))
L = {'make': ordered({k: make[k] for k in need_make if k in make}), 'mfr': ordered({k: mfr[k] for k in need_mfr if k in mfr}),
     'model': ordered({m: [model[m], int(mm[m]) if m in mm else 0] for m in need_models if m in model}),
     'wmiMake': dict(sorted(wmi_make.items())),
     'country': simple('country'), 'vtype': {r[0]: r[1] for r in T['vehicletype']}}
# справочник значений для каждого элемента с lookup-таблицей (кузов, привод, подушки, ABS…)
for el in sorted(KEEP):
    lt = d(ecol(ELEM[el], 'lookuptable'))
    if not lt or el == 28: continue
    tab = lt.lower()
    if tab in T and tab not in ('make', 'model'): L[str(el)] = simple(tab)
    else: print('нет таблицы', lt, 'для элемента', el)
# элементы: [имя, группа, тип данных]
L['el'] = {str(el): [ecol(ELEM[el], 'name'), d(ecol(ELEM[el], 'groupname')) or '', ecol(ELEM[el], 'datatype')] for el in sorted(KEEP)}
# двигатели: имя -> дополнительные пары (исходные элементы первыми, как раньше)
em = {r[0]: r[1] for r in T['enginemodel']}
EM = collections.defaultdict(list)
for r in sorted(T['enginemodelpattern'], key=lambda r: int(r[2]) not in CORE):   # стабильно: порядок дампа внутри групп
    if int(r[2]) in KEEP: EM[em[r[1]].strip().lower()].append([int(r[2]), r[3].strip()])
L['engmodel'] = dict(sorted(EM.items()))
L['desc'] = {r[1]: int(r[2]) for r in T['vindescriptor']}
# значения по умолчанию для типа ТС (их vPIC добавляет последними, если элемент не расшифрован); «0» у справочников = Not Applicable, такие не берём
DEF = collections.defaultdict(list)
for r in sorted(T['defaultvalue'], key=lambda r: int(r[0])):
    if d(r[3]) and r[3] != '0' and int(r[1]) in KEEP: DEF[r[2]].append([int(r[1]), r[3]])
L['defaults'] = dict(sorted(DEF.items(), key=lambda x: int(x[0])))
print('lookup.json', dump('lookup.json', L), '| моделей', len(L['model']), 'марок', len(L['make']), 'производителей', len(L['mfr']))
tot = sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(OUT) for f in fs)
print('ИТОГО байт:', tot)
