"""Integration checks against the running JSH HTTP server and source references."""
import datetime as dt
import json
import math
from pathlib import Path
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
BASE = 'http://127.0.0.1:5680'
profile = json.loads((ROOT/'reports/source-profile.json').read_text(encoding='utf-8'))
checks = []
timings = []
def check(condition, name):
    assert condition, name
    checks.append(name)
def request(path, expected=200):
    try:
        started = time.perf_counter()
        with urllib.request.urlopen(BASE+path, timeout=15) as response:
            status, raw = response.status, response.read()
        timings.append(round((time.perf_counter()-started)*1000, 1))
    except urllib.error.HTTPError as e:
        status, raw = e.code, e.read()
    assert status == expected, (path, status, raw[:200])
    return json.loads(raw) if raw.startswith(b'{') else raw.decode('utf-8')
def overview(start, end, unit='hour'):
    return request('/api/overview?'+urllib.parse.urlencode(dict(start=start,end=end,unit=unit)))

for month in ['2008-04','2007-04','2010-08','2006-12','2010-11']:
    y,m = map(int,month.split('-'))
    last = (dt.date(y+1,1,1) if m==12 else dt.date(y,m+1,1))-dt.timedelta(days=1)
    data=overview(month+'-01',last.isoformat())
    s=data['summary']; ref=profile['months'][month]
    check(s['rows']==ref['rows'] and s['valid']==ref['valid'],month+' counts')
    check(math.isclose(s['energy'],ref['energy_kwh'],rel_tol=1e-10),month+' energy')
    check(s['peak']==ref['max_kw'] and s['peakTime']==ref['max_time'] and s['peakTies']==ref['ties'],month+' peak and time')

hour=overview('2008-04-01','2008-04-30')
day=overview('2008-04-01','2008-04-30','day')
check(len(hour['points'])==720 and len(day['points'])==30,'hour/day point counts')
check(hour['summary']==day['summary'],'hour/day summary invariant')
check(math.isclose(sum(p['energy'] or 0 for p in day['points']),day['summary']['energy'],rel_tol=1e-10),'daily sum invariant')
check(all(p['high']==(p['average']>p['baseline']*1.7) for p in hour['points'] if p['ratio'] is not None),'1.7 threshold consistency')

# Independent raw-file calculation of the rolling baseline (no application code).
raw_hours={}
with (ROOT/'data/household_power_consumption.txt').open(encoding='utf-8') as f:
    next(f)
    for line in f:
        c=line.rstrip().split(';'); d,m,y=map(int,c[0].split('/'))
        if not (y==2008 and m in (3,4)):
            continue
        h=int(c[1].split(':')[0]); stamp=dt.datetime(y,m,d,h,tzinfo=dt.timezone.utc)
        epoch=int(stamp.timestamp()*1000)
        if c[2] not in ('','?'):
            a=raw_hours.setdefault(epoch,[]);a.append(float(c[2]))
expected_flags=[]
for p in hour['points']:
    hist=[raw_hours.get(p['t']-i*86400000,[]) for i in range(1,29)]
    hist=[sum(v)/len(v) for v in hist if len(v)>=54]
    current=raw_hours.get(p['t'],[])
    base=sum(hist)/len(hist) if len(hist)>=14 else None
    high=base is not None and base>0 and len(current)>=54 and sum(current)/len(current)>base*1.7
    expected_flags.append(high)
check(expected_flags==[p['high'] for p in hour['points']],'720 hourly flags match independent source calculation')
check(sum(expected_flags)==hour['summary']['highHours']==80,'demo high hours 80')

clamped=overview('2008-04-01','2008-10-01')
check(clamped['range']['end']=='2008-04-30' and clamped['range']['adjusted'],'server month clamp')
check(not overview('2008-04-01','2008-04-30')['range']['adjusted'],'cached clamp state not leaked')
check(overview('2008-01-31','2008-03-10')['range']['end']=='2008-02-28','leap month clamp')
empty=overview('2000-01-01','2000-01-31')
check(empty['summary']['energy'] is None and empty['summary']['peak'] is None and not empty['summary']['rows'],'empty is not zero')
missing_sample=next(s for s in profile['samples'] if s['values'][0] is None)
missing_date=missing_sample['time'][:10]
missing_t=int(dt.datetime.fromisoformat(missing_sample['time']).replace(tzinfo=dt.timezone.utc).timestamp()*1000)
for unit,step in [('hour',3600000),('day',86400000)]:
    at=missing_t//step*step
    q=urllib.parse.urlencode(dict(start=missing_date,end=missing_date,unit=unit,at=at))
    detail=request('/api/detail?'+q)
    row=next(r for r in detail['rows'] if r['t']==missing_t)
    check(row['values']==missing_sample['values'] and row['quality']==127,'missing detail '+unit)
    check(len(detail['rows'])<=(1440 if unit=='day' else 60),'bounded detail '+unit)
for path in [
    '/api/overview?start=bad&end=2008-04-30',
    '/api/overview?start=2008-02-30&end=2008-04-30',
    '/api/overview?start=2008-04-30&end=2008-04-01',
    '/api/overview?start=2008-04-01&end=2008-04-30&unit=DROP',
    '/api/detail?start=2008-04-01&end=2008-04-30&unit=hour&at=0000000000000']:
    check('error' in request(path,400),'reject '+path)
for path in ['/config/local.json','/data/household_power_consumption.txt','/runtime/import.json']:
    request(path,404);check(True,'private path blocked '+path)
check('Energy Peak Explorer' in request('/'),'HTML served')
report={'status':'passed','checks':len(checks),'items':checks,'http_timings_ms':timings,'max_http_ms':max(timings)}
(ROOT/'reports/api-verification.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps({'status':'passed','checks':len(checks),'max_http_ms':max(timings)}))
