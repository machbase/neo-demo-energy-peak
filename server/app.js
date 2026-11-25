'use strict';
const http = require('http');
const fs = require('fs');
const process = require('process');
const db = require('/energy/server/db');
const m = require('/energy/server/model');
const conf = db.config();
const manifest = JSON.parse(fs.readFile(db.ROOT + '/runtime/import.json'));
if (manifest.status !== 'complete' || manifest.table !== db.TABLE) throw new Error('Verified import required');
db.using(c => {
    if (c.queryRow('SELECT COUNT(*) AS N FROM ' + db.TABLE + ' WHERE NAME = ?', 'household').N !== manifest.expected) throw new Error('Imported row count mismatch');
});
const server = new http.Server({ network: 'tcp', address: conf.address, env: process.env });
const cache = new Map();
const prefix = ' FROM ' + db.TABLE + ' WHERE NAME = ? AND TIME >= ? AND TIME < ?';
function safe(handler) {
    return ctx => {
        ctx.setHeader('Cache-Control', 'no-store');
        ctx.setHeader('X-Content-Type-Options', 'nosniff');
        try { ctx.json(200, handler(ctx)); }
        catch (e) {
            if (e.status === 400) ctx.json(400, { error: e.message });
            else { console.println('REQUEST_FAILED'); ctx.json(503, { error: '데이터를 조회하지 못했습니다. DB 연결 상태를 확인하고 다시 시도해 주세요.' }); }
        }
    };
}
server.get('/api/health', safe(() => {
    db.using(c => c.queryRow('SELECT COUNT(*) AS N FROM M$SYS_TABLES WHERE NAME = ?', db.TABLE));
    return { app: 'Energy Peak Explorer', status: 'ok', rows: manifest.expected, pid: process.pid };
}));
server.get('/api/meta', safe(() => ({
    name: 'Energy Peak Explorer', rows: manifest.expected, first: '2006-12-16T17:24:00', last: '2010-11-26T21:02:00',
    demo: { start: '2008-04-01', end: '2008-04-30' }, threshold: 1.7,
    missing: 25979, clock: '원본 시각 · 시간대 오프셋 미제공', source: 'UCI · Individual Household Electric Power Consumption'
})));
function overview(r) {
    const key = r.from + '/' + r.to + '/' + r.unit;
    if (cache.has(key)) return { ...cache.get(key), range: r };
    const result = db.using(conn => {
        const hist = r.from - 28 * m.DAY;
        const raw = db.query(conn, 'SELECT FLOOR(STAMP / 3600000) * 3600000 AS T, COUNT(*) AS N, COUNT(POWER) AS VALID, SUM(POWER) AS S, MAX(POWER) AS PEAK' + prefix + ' GROUP BY FLOOR(STAMP / 3600000) * 3600000 ORDER BY T', 'household', new Date(hist), new Date(r.to));
        const a = m.anomalies(m.hourPoints(raw, hist, r.to), r.from);
        const summary = { rows: 0, valid: 0, expected: (r.to - r.from) / m.MINUTE, energy: null, peak: null, peakTime: null, peakTies: 0, highHours: 0, judgedHours: 0 };
        let sum = 0;
        a.points.forEach(p => {
            summary.rows += p.rows; summary.valid += p.valid; sum += p.sum;
            if (p.peak !== null) summary.peak = summary.peak === null ? p.peak : Math.max(summary.peak, p.peak);
            summary.highHours += p.high ? 1 : 0; summary.judgedHours += p.ratio !== null ? 1 : 0;
        });
        summary.energy = summary.valid ? sum / 60 : null;
        summary.coverage = summary.valid / summary.expected;
        if (summary.peak !== null) {
            const peak = conn.queryRow('SELECT MIN(STAMP) AS T, COUNT(*) AS N' + prefix + ' AND POWER = ?', 'household', new Date(r.from), new Date(r.to), summary.peak);
            summary.peakTime = m.label(Number(peak.T)); summary.peakTies = Number(peak.N);
        }
        return { range: r, summary, points: r.unit === 'day' ? m.daily(a.points) : a.points, spans: a.spans, threshold: 1.7 };
    });
    if (cache.size >= 8) cache.delete(cache.keys().next().value);
    cache.set(key, result); return result;
}
server.get('/api/overview', safe(ctx => overview(m.range(ctx.query('start'), ctx.query('end'), ctx.query('unit') || 'hour'))));
server.get('/api/detail', safe(ctx => {
    const r = m.range(ctx.query('start'), ctx.query('end'), ctx.query('unit') || 'hour');
    const raw = ctx.query('at');
    if (typeof raw !== 'string' || !/^\d{13}$/.test(raw)) m.bad('상세 조회 시각이 올바르지 않습니다.');
    const at = Number(raw), step = r.unit === 'day' ? m.DAY : m.HOUR;
    if (at < r.from || at >= r.to || at % step !== 0) m.bad('선택한 조회 범위 안의 시점을 선택해 주세요.');
    const end = Math.min(at + step, r.to);
    const rows = db.using(conn => db.query(conn, 'SELECT STAMP, SOURCE_ROW, POWER, REACTIVE, VOLTAGE, INTENSITY, SUB1, SUB2, SUB3, QUALITY' + prefix + ' ORDER BY TIME', 'household', new Date(at), new Date(end)));
    return { start: at, end, rows: rows.map(v => ({ t: Number(v.STAMP), time: m.label(Number(v.STAMP)), row: v.SOURCE_ROW, values: [v.POWER, v.REACTIVE, v.VOLTAGE, v.INTENSITY, v.SUB1, v.SUB2, v.SUB3], quality: v.QUALITY })) };
}));
server.staticFile('/', db.ROOT + '/web/index.html');
server.staticFile('/app.js', db.ROOT + '/web/app.js');
server.staticFile('/style.css', db.ROOT + '/web/style.css');
process.addShutdownHook(() => { server.close(); });
server.serve(() => {
    fs.writeFile(db.ROOT + '/runtime/server.json', JSON.stringify({ pid: process.pid, address: conf.address, startedAt: new Date().toISOString() }));
    console.println('Energy Peak Explorer http://' + conf.address);
});
