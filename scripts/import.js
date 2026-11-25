'use strict';
const fs = require('fs');
const process = require('process');
const { ROOT, TABLE, connect } = require('/energy/server/db');
const profile = JSON.parse(fs.readFile(ROOT + '/reports/source-profile.json'));
const statePath = ROOT + '/runtime/import.json';
const source = ROOT + '/data/household_power_consumption.txt';
fs.mkdir(ROOT + '/runtime', { recursive: true });
if (process.argv[2] !== profile.sha256 || fs.stat(source).size !== 132960755) throw new Error('Run scripts/load.ps1 to verify the source hash first');
const lock = fs.open(ROOT + '/runtime/import.lock', 'wx');
let db, conn, app, fd, closed = false, count = 0, ownsManifest = false, cleaned = false;
let state = { table: TABLE, schema: 1, sha256: profile.sha256, status: 'starting', sent: 0, expected: profile.rows, startedAt: new Date().toISOString() };
function save() { fs.writeFile(statePath, JSON.stringify(state, null, 2)); }
function exitResources() {
    if (cleaned) return;
    cleaned = true;
    let failure;
    function clean(fn) { try { fn(); } catch (e) { if (!failure) failure = e; } }
    if (fd !== undefined) clean(() => { fs.close(fd); fd = undefined; });
    if (app && !closed) clean(() => { closed = true; state.closeResult = app.close(); });
    if (conn) clean(() => { conn.close(); conn = null; });
    if (db) clean(() => { db.close(); db = null; });
    clean(() => fs.close(lock)); clean(() => fs.unlink(ROOT + '/runtime/import.lock'));
    if (failure) throw failure;
}
process.addShutdownHook(() => { if (!cleaned) exitResources(); });
function verify(attempt) {
    try {
        const n = conn.queryRow('SELECT COUNT(*) AS N FROM ' + TABLE + ' WHERE NAME = ?', 'household').N;
        state.visible = n;
        if (n !== profile.rows) {
            if (attempt >= 60) { state.status = 'pending_visibility'; save(); exitResources(); process.exit(2); return; }
            setTimeout(() => verify(attempt + 1), 1000); return;
        }
        state.status = 'complete'; state.completedAt = new Date().toISOString(); save();
        console.println('VERIFIED', n, 'rows'); exitResources();
    } catch (e) { state.status = 'verification_failed'; save(); exitResources(); throw e; }
}
try {
    db = connect(); conn = db.connect();
    const exists = conn.queryRow('SELECT COUNT(*) AS N FROM M$SYS_TABLES WHERE NAME = ?', TABLE).N;
    if (exists) {
        if (!fs.exists(statePath)) throw new Error('Existing table without import manifest; no automatic append');
        const old = JSON.parse(fs.readFile(statePath));
        if (!['complete', 'pending_visibility'].includes(old.status) || old.sha256 !== profile.sha256 || old.sent !== profile.rows || !old.closeResult || old.closeResult[1] !== 0) throw new Error('Incomplete or unknown import; no automatic replay or deletion');
        state = old; console.println('EXISTING_IMPORT: verify only, no append'); verify(0);
    } else {
        if (fs.exists(statePath)) throw new Error('Manifest exists but table is absent; investigate before import');
        ownsManifest = true; save();
        conn.exec('CREATE TAG TABLE ' + TABLE + ' (NAME VARCHAR(40) PRIMARY KEY, TIME DATETIME BASETIME, SOURCE_ROW DOUBLE SUMMARIZED, STAMP LONG, POWER DOUBLE, REACTIVE DOUBLE, VOLTAGE DOUBLE, INTENSITY DOUBLE, SUB1 DOUBLE, SUB2 DOUBLE, SUB3 DOUBLE, QUALITY INTEGER)');
        state.status = 'loading'; save();
        app = conn.append(TABLE); fd = fs.open(source, 'r');
        const buffer = Buffer.alloc(65536); let carry = '', header = true, previous = null;
        function line(raw) {
            if (header) { header = false; return; }
            const c = raw.replace(/\r$/, '').split(';');
            if (c.length !== 9) throw new Error('Invalid source row ' + (count + 1));
            const d = c[0].split('/').map(Number), tm = c[1].split(':').map(Number);
            const stamp = Date.UTC(d[2], d[1] - 1, d[0], tm[0], tm[1], tm[2]);
            if (!Number.isFinite(stamp) || (previous !== null && stamp <= previous)) throw new Error('Non-increasing source time');
            previous = stamp;
            let quality = 0;
            const nums = c.slice(2).map((v, i) => {
                if (v === '?' || v === '') { quality |= (1 << i); return null; }
                const n = Number(v); if (!Number.isFinite(n)) throw new Error('Invalid source number'); return n;
            });
            count++; app.append('household', new Date(stamp), count, stamp, ...nums, quality);
            state.sent = count;
            if (count % 10000 === 0) app.flush();
            if (count % 100000 === 0) { save(); console.println('SENT', count); }
        }
        let size;
        while ((size = fs.read(fd, buffer, 0, buffer.length)) > 0) {
            const lines = (carry + buffer.subarray(0, size).toString('utf8')).split('\n');
            carry = lines.pop(); lines.forEach(line);
        }
        if (carry) line(carry);
        fs.close(fd); fd = undefined;
        app.flush(); closed = true; state.closeResult = app.close();
        console.println('APPEND_CLOSE', JSON.stringify(state.closeResult));
        if (count !== profile.rows || state.closeResult[0] !== count || state.closeResult[1] !== 0) throw new Error('Append counts mismatch');
        state.status = 'pending_visibility'; save(); verify(0);
    }
} catch (e) {
    if (ownsManifest && (state.status === 'loading' || state.status === 'starting')) { state.status = 'failed'; state.sent = count; save(); }
    exitResources(); throw e;
}
