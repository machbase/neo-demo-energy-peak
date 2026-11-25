'use strict';
const fs = require('fs');
const { ROOT, TABLE, using, query } = require('/energy/server/db');
const profile = JSON.parse(fs.readFile(ROOT + '/reports/source-profile.json'));
const fields = ['POWER','REACTIVE','VOLTAGE','INTENSITY','SUB1','SUB2','SUB3'];
function assert(ok, message) { if (!ok) throw new Error(message); }
function close(a, b) { return Math.abs(a-b) <= Math.max(1e-7, Math.abs(b)*1e-10); }
const report = using(conn => {
    const months = [];
    for (const key of Object.keys(profile.months)) {
        const from = Date.parse(key+'-01T00:00:00Z'), d = new Date(from);
        const to = Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1), ref = profile.months[key];
        const a = conn.queryRow('SELECT COUNT(*) AS N, COUNT(POWER) AS VALID, SUM(POWER) AS S, MAX(POWER) AS PEAK FROM '+TABLE+' WHERE NAME = ? AND TIME >= ? AND TIME < ?', 'household', new Date(from), new Date(to));
        assert(a.N===ref.rows && a.VALID===ref.valid, key+' count mismatch');
        assert(close(a.S,ref.sum_kw) && a.PEAK===ref.max_kw,key+' aggregate mismatch');
        const peak = conn.queryRow('SELECT MIN(STAMP) AS T, COUNT(*) AS N FROM '+TABLE+' WHERE NAME = ? AND TIME >= ? AND TIME < ? AND POWER = ?', 'household', new Date(from), new Date(to),ref.max_kw);
        assert(Number(peak.T)===Date.parse(ref.max_time+'Z') && peak.N===ref.ties,key+' peak time mismatch');
        months.push({month:key,rows:a.N,valid:a.VALID,energy_kwh:a.S/60,peak:a.PEAK,peak_time:ref.max_time,ties:peak.N});
    }
    const counts = conn.queryRow('SELECT COUNT(*) AS N, '+fields.map((f,i)=>'COUNT('+f+') AS C'+i).join(',')+' FROM '+TABLE+' WHERE NAME = ?', 'household');
    assert(counts.N===profile.rows,'Total count mismatch');
    const names=['power','reactive','voltage','intensity','sub1','sub2','sub3'];
    names.forEach((n,i)=>assert(counts.N-counts['C'+i]===profile.missing[n],n+' missing count mismatch'));
    for (const sample of profile.samples) {
        const t = Date.parse(sample.time+'Z');
        const rows = query(conn,'SELECT STAMP, SOURCE_ROW, '+fields.join(',')+' FROM '+TABLE+' WHERE NAME = ? AND TIME = ?', 'household',new Date(t));
        assert(rows.length===1 && rows[0].SOURCE_ROW===sample.row && Number(rows[0].STAMP)===t,'Sample identity mismatch');
        fields.forEach((f,i)=>assert(sample.values[i]===null ? rows[0][f]===null : close(rows[0][f],sample.values[i]),'Sample '+sample.row+' '+f+' mismatch'));
    }
    return {checkedAt:new Date().toISOString(),status:'passed',rows:counts.N,monthly_checks:months.length,samples:profile.samples.length,missing:profile.missing,months};
});
fs.writeFile(ROOT+'/reports/db-verification.json',JSON.stringify(report,null,2));
console.println('PASS', report.rows,'rows,',report.monthly_checks,'months,',report.samples,'samples; all 7 missing counts match');
