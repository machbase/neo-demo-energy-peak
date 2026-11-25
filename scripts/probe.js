'use strict';
const { using, query } = require('/energy/server/db');
using(conn => {
    const name = 'EPX_COMPAT_V2';
    const exists = conn.queryRow('SELECT COUNT(*) AS N FROM M$SYS_TABLES WHERE NAME = ?', name).N;
    if (!exists) {
        conn.exec('CREATE TAG TABLE ' + name + ' (NAME VARCHAR(40) PRIMARY KEY, TIME DATETIME BASETIME, SOURCE_ROW DOUBLE SUMMARIZED, POWER DOUBLE, REACTIVE DOUBLE, QUALITY INTEGER)');
        const app = conn.append(name);
        try {
            app.append('probe', new Date('2008-04-01T00:00:00Z'), 1, 1.5, 0.1, 0);
            app.append('probe', new Date('2008-04-01T00:01:00Z'), 2, null, null, 3);
            console.println('FLUSH', JSON.stringify(app.flush()));
        } finally { console.println('CLOSE', JSON.stringify(app.close())); }
    }
    console.println(JSON.stringify(query(conn, 'SELECT TIME, POWER, REACTIVE, SOURCE_ROW, QUALITY FROM ' + name + ' WHERE NAME = ? ORDER BY TIME', 'probe')));
    console.println(JSON.stringify(conn.queryRow('SELECT COUNT(*) AS N, COUNT(POWER) AS VALID, SUM(POWER) AS TOTAL FROM ' + name + ' WHERE TIME >= ? AND TIME < ?', new Date('2008-04-01T00:00:00Z'), new Date('2008-04-02T00:00:00Z'))));
});
