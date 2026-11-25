'use strict';
const fs = require('fs');
const { Client } = require('machcli');
const ROOT = '/energy';
const TABLE = 'EPX_HOUSEHOLD_MINUTE_V1';
function config() {
    const conf = JSON.parse(fs.readFile(ROOT + '/config/local.json', 'utf8'));
    if (!conf.password || conf.password === '<DB_PASSWORD>') throw new Error('Private DB configuration required');
    if (!/^127\.0\.0\.1:\d{4,5}$/.test(conf.address)) throw new Error('Local HTTP address required');
    return conf;
}
function connect() { return new Client(config()); }
function query(conn, sql, ...params) {
    const rows = conn.query(sql, ...params);
    const out = [];
    try {
        for (const row of rows) {
            const obj = {};
            for (const key of row.names) obj[key] = row[key];
            out.push(obj);
        }
    } finally { rows.close(); }
    return out;
}
function using(fn) {
    const db = connect(); let conn;
    try { conn = db.connect(); return fn(conn); }
    finally { if (conn) conn.close(); db.close(); }
}
module.exports = { ROOT, TABLE, config, connect, query, using };
