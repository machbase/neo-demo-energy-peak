'use strict';
const DAY = 86400000, HOUR = 3600000, MINUTE = 60000;
function bad(message) { const e = new Error(message); e.status = 400; throw e; }
function date(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) bad('날짜를 YYYY-MM-DD 형식으로 입력해 주세요.');
    const n = Date.parse(value + 'T00:00:00Z');
    if (!Number.isFinite(n) || new Date(n).toISOString().slice(0, 10) !== value || value < '1900-01-01' || value > '2200-12-31') bad('유효한 날짜를 입력해 주세요.');
    return n;
}
function label(ms) { return new Date(ms).toISOString().slice(0, 19); }
function monthAfter(ms) {
    const d = new Date(ms), y = d.getUTCFullYear(), m = d.getUTCMonth();
    const last = new Date(Date.UTC(y, m + 2, 0)).getUTCDate();
    return Date.UTC(y, m + 1, Math.min(d.getUTCDate(), last));
}
function range(start, end, unit) {
    if (unit !== 'hour' && unit !== 'day') bad('집계 단위는 hour 또는 day를 사용해 주세요.');
    const from = date(start), requestedTo = date(end) + DAY;
    if (requestedTo <= from) bad('종료일은 시작일보다 빠를 수 없습니다.');
    const to = Math.min(requestedTo, monthAfter(from));
    return { from, to, start, end: label(to - DAY).slice(0, 10), adjusted: to < requestedTo, unit };
}
function hourPoints(raw, from, to) {
    const map = {};
    raw.forEach(r => { map[Number(r.T)] = r; });
    const out = [];
    for (let t = from; t < to; t += HOUR) {
        const r = map[t], valid = r ? Number(r.VALID) : 0;
        out.push({ t, time: label(t), rows: r ? Number(r.N) : 0, valid, expected: 60,
            sum: valid ? Number(r.S) : 0, energy: valid ? Number(r.S) / 60 : null,
            average: valid ? Number(r.S) / valid : null, peak: valid ? Number(r.PEAK) : null,
            baseline: null, ratio: null, high: false, baselineDays: 0 });
    }
    return out;
}
function anomalies(all, from) {
    const map = {};
    all.forEach(p => { map[p.t] = p; });
    const points = all.filter(p => p.t >= from);
    points.forEach(p => {
        p.baseline = null; p.ratio = null; p.high = false;
        const history = [];
        for (let d = 1; d <= 28; d++) {
            const old = map[p.t - d * DAY];
            if (old && old.valid / old.expected >= 0.9) history.push(old.average);
        }
        p.baselineDays = history.length;
        if (history.length >= 14 && p.valid / p.expected >= 0.9) {
            const b = history.reduce((s, x) => s + x, 0) / history.length;
            p.baseline = b;
            if (b > 0) { p.ratio = p.average / b; p.high = p.average > b * 1.7; }
        }
    });
    const spans = [];
    points.filter(p => p.high).forEach(p => {
        let last = spans[spans.length - 1];
        if (!last || last.end !== p.t) {
            last = { start: p.t, end: p.t, peak: 0, ratio: 0, hours: 0 };
            spans.push(last);
        }
        last.end = p.t + HOUR; last.hours++;
        last.peak = Math.max(last.peak, p.peak); last.ratio = Math.max(last.ratio, p.ratio);
    });
    return { points, spans };
}
function daily(points) {
    const map = {}, out = [];
    points.forEach(p => {
        const t = Math.floor(p.t / DAY) * DAY;
        let a = map[t];
        if (!a) { a = { t, time: label(t), rows: 0, valid: 0, expected: 0, sum: 0, peak: null, highHours: 0 }; map[t] = a; out.push(a); }
        a.rows += p.rows; a.valid += p.valid; a.expected += p.expected; a.sum += p.sum;
        if (p.peak !== null) a.peak = a.peak === null ? p.peak : Math.max(a.peak, p.peak);
        a.highHours += p.high ? 1 : 0;
    });
    out.forEach(a => { a.energy = a.valid ? a.sum / 60 : null; a.average = a.valid ? a.sum / a.valid : null; a.high = a.highHours > 0; });
    return out;
}
module.exports = { DAY, HOUR, MINUTE, bad, date, label, monthAfter, range, hourPoints, anomalies, daily };
