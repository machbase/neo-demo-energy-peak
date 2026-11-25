"""Read-only source audit and independent Decimal reference aggregates."""
import collections
import datetime as dt
from decimal import Decimal
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'data/household_power_consumption.txt'
names = ['power', 'reactive', 'voltage', 'intensity', 'sub1', 'sub2', 'sub3']
months = {}
missing = collections.Counter()
minimum = {}
maximum = {}
previous = None
count = duplicates = gaps = backwards = 0
samples = []
with SOURCE.open(encoding='utf-8') as f:
    header = next(f).strip()
    for line in f:
        count += 1
        c = line.strip().split(';')
        if len(c) != 9:
            raise ValueError(f'Invalid column count at row {count}')
        d, m, y = map(int, c[0].split('/'))
        h, mi, s = map(int, c[1].split(':'))
        stamp = dt.datetime(y, m, d, h, mi, s)
        if previous:
            delta = (stamp - previous).total_seconds()
            duplicates += delta == 0
            backwards += delta < 0
            gaps += max(0, int(delta / 60) - 1)
        if count == 1:
            first = stamp.isoformat()
        previous = stamp
        key = f'{y:04}-{m:02}'
        a = months.setdefault(key, {'rows': 0, 'valid': 0, 'sum_kw': Decimal(0), 'max_kw': None, 'max_time': None, 'ties': 0, 'missing': [0]*7})
        a['rows'] += 1
        values = []
        for i, (name, raw) in enumerate(zip(names, c[2:])):
            if raw in ('', '?'):
                missing[name] += 1
                a['missing'][i] += 1
                values.append(None)
                continue
            v = Decimal(raw)
            if not v.is_finite():
                raise ValueError(f'Nonfinite number at row {count}')
            minimum[name] = min(minimum.get(name, v), v)
            maximum[name] = max(maximum.get(name, v), v)
            values.append(float(v))
            if i == 0:
                a['valid'] += 1
                a['sum_kw'] += v
                if a['max_kw'] is None or v > a['max_kw']:
                    a['max_kw'], a['max_time'], a['ties'] = v, stamp.isoformat(), 1
                elif v == a['max_kw']:
                    a['ties'] += 1
        if count in (1, 2, 10000, 2075259) or (None in values and len(samples) < 12):
            samples.append({'row': count, 'time': stamp.isoformat(), 'values': values})
for a in months.values():
    a['energy_kwh'] = float(a['sum_kw'] / 60)
    a['sum_kw'] = float(a['sum_kw'])
    a['max_kw'] = None if a['max_kw'] is None else float(a['max_kw'])
with SOURCE.open('rb') as source_stream:
    sha = hashlib.file_digest(source_stream, 'sha256').hexdigest()
result = {'sha256': sha, 'rows': count, 'first': first, 'last': previous.isoformat(), 'duplicates': duplicates, 'backwards': backwards, 'missing_timestamps': gaps, 'missing': dict(missing), 'minimum': {k: float(v) for k, v in minimum.items()}, 'maximum': {k: float(v) for k, v in maximum.items()}, 'months': months, 'samples': samples}
(ROOT / 'reports').mkdir(exist_ok=True)
(ROOT / 'reports/source-profile.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
print(json.dumps({k: result[k] for k in ('sha256', 'rows', 'duplicates', 'backwards', 'missing_timestamps', 'missing')}))
