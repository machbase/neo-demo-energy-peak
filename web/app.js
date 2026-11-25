'use strict';
const $ = id => document.getElementById(id);
const fmt = (v, digits = 2) => v === null || v === undefined ? '—' : Number(v).toLocaleString('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const stamp = (t, full = false) => new Date(t).toISOString().slice(full ? 0 : 5, 16).replace('T', ' ');
const fields = [['유효전력','kW'],['무효전력','kvar'],['전압','V'],['전류','A'],['주방 사용량','Wh'],['세탁실 사용량','Wh'],['온수·냉난방 사용량','Wh']];
let unit = 'hour', result = null, selected = 0, minutes = [], minuteIndex = 0;
let generation = 0, detailGeneration = 0, request = null, detailRequest = null, dateTimer;
async function get(url, signal) {
    const res = await fetch(url, { signal });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '조회에 실패했습니다. 다시 시도해 주세요.');
    return data;
}
function args(r = result.range) { return new URLSearchParams({ start: r.start, end: r.end, unit: r.unit }); }
function error(message) { $('error').textContent = message; $('error').hidden = false; }
async function load() {
    clearTimeout(dateTimer);
    const gen = ++generation; detailGeneration++;
    if (request) request.abort(); if (detailRequest) detailRequest.abort();
    request = new AbortController();
    document.body.classList.add('loading'); document.body.classList.remove('failed');
    $('apply').disabled = true; $('error').hidden = true; $('notice').textContent = '';
    $('detail-content').hidden = true; $('detail-status').hidden = false;
    $('detail-status').textContent = '기간의 데이터를 읽고 있습니다.';
    $('point').disabled = true;
    try {
        const query = new URLSearchParams({ start: $('start').value, end: $('end').value, unit });
        const data = await get('/api/overview?' + query, request.signal);
        if (gen !== generation) return;
        result = data; $('start').value = data.range.start; $('end').value = data.range.end;
        const s = data.summary;
        $('energy').textContent = fmt(s.energy);
        $('energy-note').textContent = s.valid ? '확보된 분의 전력을 사용량으로 환산' : '자료 없음';
        $('peak').textContent = fmt(s.peak, 3);
        $('peak-time').textContent = s.peakTime ? s.peakTime.replace('T', ' ').slice(0, 16) + (s.peakTies > 1 ? ` · 동률 ${s.peakTies}건` : '') : '유효한 측정값 없음';
        $('high-count').textContent = fmt(s.highHours, 0);
        $('high-note').textContent = `${s.judgedHours.toLocaleString()}시간 비교 가능 · 기준 1.7배 초과`;
        $('coverage').textContent = fmt(s.coverage * 100, 2);
        $('coverage-note').textContent = `${s.valid.toLocaleString()} / ${s.expected.toLocaleString()}분 유효`;
        $('range-caption').textContent = `${data.range.start} — ${data.range.end}`;
        const notes = [];
        if (data.range.adjusted) notes.push(`한 달을 초과하여 종료일을 ${data.range.end}로 조정했습니다.`);
        if (s.coverage < 1) notes.push(`누락 또는 범위 밖 ${fmt(s.expected - s.valid, 0)}분. 총 사용량은 확보된 자료만 합산합니다.`);
        if (!notes.length) notes.push('데이터가 준비되었습니다. 그래프에서 자세히 살펴볼 시점을 선택하세요.');
        $('notice').textContent = notes.join(' ');
        selected = Math.max(0, data.points.findIndex(p => p.peak === s.peak));
        $('point').max = Math.max(0, data.points.length - 1); $('point').value = selected;
        $('point').disabled = !data.points.length;
        drawChart(); drawSpans(); selectPoint(selected);
    } catch (e) {
        if (e.name !== 'AbortError' && gen === generation) { error(e.message); document.body.classList.add('failed'); result = null; }
    } finally {
        if (gen === generation) { document.body.classList.remove('loading'); $('apply').disabled = false; }
    }
}
function path(points, value, x, y) {
    let pen = false, d = '';
    points.forEach((p, i) => {
        const v = value(p);
        if (v === null || !Number.isFinite(v)) { pen = false; return; }
        d += `${pen ? 'L' : 'M'}${x(i).toFixed(2)},${y(v).toFixed(2)} `; pen = true;
    });
    return d;
}
function drawChart() {
    if (!result) return;
    const pts = result.points, W = 1100, H = 290, left = 52, right = 18, top = 18, bottom = 38;
    const w = W - left - right, h = H - top - bottom, n = pts.length;
    const max = Math.max(1, ...pts.map(p => p.average === null ? 0 : p.average)) * 1.12;
    const x = i => left + (i + .5) / n * w, y = v => top + h * (1 - v / max);
    let svg = '<defs><linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f78c40" stop-opacity=".18"/><stop offset="1" stop-color="#f78c40" stop-opacity="0"/></linearGradient></defs>';
    for (let i = 0; i <= 4; i++) {
        const v = max * i / 4, yy = y(v);
        svg += `<line x1="${left}" y1="${yy}" x2="${W-right}" y2="${yy}" stroke="#303336" stroke-dasharray="3 5"/><text x="${left-12}" y="${yy+4}" text-anchor="end">${v.toFixed(1)}</text>`;
    }
    pts.forEach((p, i) => { if (p.high) svg += `<rect x="${left+i/n*w}" y="${top}" width="${Math.max(1,w/n)}" height="${h}" fill="#ec8b3d" opacity=".13"/>`; });
    const d = path(pts, p => p.average, x, y);
    svg += `<path d="${d}" fill="none" stroke="#ff913f" stroke-width="2" stroke-linejoin="round"/>`;
    if (n === 1 && pts[0].average !== null) svg += `<circle cx="${x(0)}" cy="${y(pts[0].average)}" r="4" fill="#ff913f"/>`;
    const seen = new Set();
    for (let j = 0; j <= 5; j++) {
        const i = Math.round((n-1)*j/5); if (seen.has(i)) continue; seen.add(i);
        if (pts[i]) svg += `<text x="${x(i)}" y="${H-10}" text-anchor="middle">${stamp(pts[i].t).slice(0,5)}${result.range.unit === 'hour' && n < 72 ? ' '+stamp(pts[i].t).slice(6) : ''}</text>`;
    }
    if (!result.summary.valid) svg += '<text x="550" y="130" text-anchor="middle">선택한 기간에 유효한 측정값이 없습니다.</text>';
    svg += '<g id="selection"></g>';
    $('chart').innerHTML = svg;
    drawSelection();
}
function drawSelection() {
    if (!result || !$('selection')) return;
    const p = result.points[selected], x = 52 + (selected+.5)/result.points.length*1030;
    $('selection').innerHTML = `<line x1="${x}" y1="18" x2="${x}" y2="252" stroke="#e3d2bd" stroke-width="1" stroke-dasharray="4 4"/>`;
    $('point-label').textContent = `${stamp(p.t, true)} · ${fmt(p.average)} kW`;
    $('point').setAttribute('aria-valuetext', $('point-label').textContent);
}
function chartIndex(event) {
    const rect = $('chart').getBoundingClientRect(), x = (event.clientX-rect.left)/rect.width*1100;
    return Math.max(0, Math.min(result.points.length-1, Math.floor((x-52)/1030*result.points.length)));
}
function drawSpans() {
    const spans = result.spans;
    $('spans').replaceChildren();
    if (!spans.length) {
        const p = document.createElement('p'); p.className = 'empty';
        p.textContent = !result.summary.judgedHours ? '비교 자료가 충분한 시간이 없습니다.' : '1.7배를 초과한 구간이 없습니다.';
        $('spans').append(p); return;
    }
    spans.forEach(s => {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'span-row';
        button.innerHTML = `<span><strong>${stamp(s.start)} — ${stamp(s.end)}</strong><small>${s.hours}시간 연속 · 최대 ${fmt(s.peak,3)} kW</small></span><span class="span-ratio">${fmt(s.ratio,2)}×</span>`;
        button.setAttribute('aria-label', `${stamp(s.start)}부터 ${s.hours}시간, 최대 기준 대비 ${fmt(s.ratio,2)}배, 상세 보기`);
        button.addEventListener('click', () => {
            const step = unit === 'day' ? 86400000 : 3600000;
            selectPoint(result.points.findIndex(p => p.t === Math.floor(s.start/step)*step));
        });
        $('spans').append(button);
    });
}
async function selectPoint(index) {
    if (!result || index < 0) return;
    selected = Math.min(index,result.points.length-1); $('point').value = selected; drawSelection();
    const gen = ++detailGeneration, parent = generation, p = result.points[selected];
    if (detailRequest) detailRequest.abort(); detailRequest = new AbortController();
    $('detail-content').hidden = true; $('detail-status').hidden = false; $('detail-status').textContent = '상세값을 불러오고 있습니다.';
    $('detail-badge').textContent = unit === 'day' ? '일별 구간' : '시간별 구간';
    try {
        const query = args(); query.set('at', p.t);
        const data = await get('/api/detail?' + query, detailRequest.signal);
        if (gen !== detailGeneration || parent !== generation) return;
        minutes = data.rows;
        if (!minutes.length) { $('detail-status').textContent = '선택한 구간에는 원본 자료가 없습니다.'; return; }
        $('detail-status').hidden = true; $('detail-content').hidden = false;
        $('detail-time').textContent = stamp(p.t,true) + (unit === 'day' ? ' · 하루' : ' · 1시간');
        $('detail-summary').textContent = `${fmt(p.energy)} kWh · 평균 ${fmt(p.average)} kW`;
        minuteIndex = Math.max(0, minutes.findIndex(v => v.values[0] === p.peak));
        $('minute').max = minutes.length-1; $('minute').value = minuteIndex;
        drawMinuteChart(); showMinute(minuteIndex);
    } catch(e) { if (e.name !== 'AbortError' && gen === detailGeneration && parent === generation) $('detail-status').textContent = e.message; }
}
function drawMinuteChart() {
    const max = Math.max(1,...minutes.map(r => r.values[0]||0))*1.12;
    const first = minutes[0].t, last = minutes[minutes.length-1].t;
    const x = i => 5+(minutes[i].t-first)/Math.max(60000,last-first)*590;
    const y = v => 85-v/max*75;
    $('minute-chart').innerHTML = `<line x1="5" y1="85" x2="595" y2="85" stroke="#3a3c3e"/><path d="${path(minutes,p=>p.values[0],x,y)}" fill="none" stroke="#ed984f" stroke-width="1.5"/><g id="minute-marker"></g>`;
}
function showMinute(i) {
    if (!minutes.length) return;
    minuteIndex = i; $('minute').value = i;
    const row = minutes[i]; $('minute-time').textContent = stamp(row.t,true);
    $('minute').setAttribute('aria-valuetext', stamp(row.t,true));
    $('values').innerHTML = fields.map(([name,u],k) => `<div><dt>${name}</dt><dd>${row.values[k] === null ? '결측' : fmt(row.values[k],k<2?3:1)} <span>${u}</span></dd></div>`).join('');
    $('row-note').textContent = `원본 ${row.row.toLocaleString()}번째 자료 · ${row.quality ? '일부 측정값이 결측입니다.' : '모든 측정값 유효'} · 위 값은 선택한 1분의 측정값입니다.`;
    const x = 5+(row.t-minutes[0].t)/Math.max(60000,minutes[minutes.length-1].t-minutes[0].t)*590;
    $('minute-marker').innerHTML = `<line x1="${x}" y1="5" x2="${x}" y2="89" stroke="#eee0c9" stroke-dasharray="3 3"/>`;
}
$('period').addEventListener('submit', e => { e.preventDefault(); load(); });
['start','end'].forEach(id => $(id).addEventListener('change', () => { clearTimeout(dateTimer); dateTimer = setTimeout(load,300); }));
$('demo').addEventListener('click', () => { $('start').value='2008-04-01'; $('end').value='2008-04-30'; load(); });
document.querySelectorAll('[data-unit]').forEach(button => button.addEventListener('click', () => {
    if (unit === button.dataset.unit) return; unit = button.dataset.unit;
    document.querySelectorAll('[data-unit]').forEach(b => b.setAttribute('aria-pressed',String(b.dataset.unit===unit))); load();
}));
$('chart').addEventListener('click', e => { if (result && !document.body.classList.contains('loading')) selectPoint(chartIndex(e)); });
$('chart').addEventListener('mousemove', e => {
    if (!result || document.body.classList.contains('loading')) return;
    const p = result.points[chartIndex(e)]; $('chart-tip').hidden = false;
    $('chart-tip').textContent = `${stamp(p.t,true)}\n평균 ${fmt(p.average)} kW · ${fmt(p.energy)} kWh${p.high ? '\n높은 사용량 포함' : ''}`;
});
$('chart').addEventListener('mouseleave', () => { $('chart-tip').hidden = true; });
$('point').addEventListener('input', () => { selected=Number($('point').value); drawSelection(); });
$('point').addEventListener('change', () => selectPoint(Number($('point').value)));
$('minute').addEventListener('input', () => showMinute(Number($('minute').value)));
$('minute-chart').addEventListener('click', e => {
    if (!minutes.length) return;
    const rect=$('minute-chart').getBoundingClientRect(), ratio=Math.max(0,Math.min(1,((e.clientX-rect.left)/rect.width*600-5)/590));
    const at=minutes[0].t+ratio*(minutes[minutes.length-1].t-minutes[0].t);
    let best=0; minutes.forEach((p,i)=>{if(Math.abs(p.t-at)<Math.abs(minutes[best].t-at))best=i;}); showMinute(best);
});
get('/api/meta').then(() => { $('connection').textContent='DB 연결됨'; $('connection').classList.add('ready'); }).catch(() => { $('connection').textContent='연결 확인 실패'; });
load();
