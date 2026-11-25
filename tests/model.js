'use strict';
const m = require('/energy/server/model');
let n = 0;
function check(ok,msg) { if (!ok) throw new Error(msg); n++; }
const r = m.range('2008-04-01','2008-06-20','hour');
check(r.end==='2008-04-30' && r.adjusted,'Month clamp');
check(m.range('2008-01-31','2008-03-15','day').end==='2008-02-28','Leap month end, exclusive boundary');
check(m.range('2009-01-31','2009-03-15','day').end==='2009-02-27','Nonleap month end, exclusive boundary');
check(m.range('2008-12-01','2009-02-01','day').end==='2008-12-31','Year crossing');
for (const pair of [['2008-02-30','2008-03-01'],['2008-04-05','2008-04-01'],['bad','2008-04-01']]) {
    let bad=false;try{m.range(pair[0],pair[1],'hour');}catch(e){bad=e.status===400;}check(bad,'Invalid input rejected');
}
const t = m.date('2008-04-01'), history = [];
for(let d=28;d>=1;d--) history.push({t:t-d*m.DAY,average:1,valid:60,expected:60,peak:1});
let a=m.anomalies(history.concat([{t,average:1.7,valid:60,expected:60,peak:2}]),t);
check(a.points[0].high===false,'Exactly 1.7 is not above threshold');
a=m.anomalies(history.concat([{t,average:1.70001,valid:60,expected:60,peak:2}]),t);
check(a.points[0].high===true,'Above 1.7 flagged');
a=m.anomalies(history.slice(0,13).concat([{t,average:3,valid:60,expected:60,peak:4}]),t);
check(a.points[0].ratio===null,'Insufficient history withheld');
a=m.anomalies(history.concat([{t,average:3,valid:53,expected:60,peak:4}]),t);
check(a.points[0].ratio===null,'Below 90 percent withheld');
const empty=m.hourPoints([],t,t+m.HOUR)[0];
check(empty.average===null && empty.energy===null && empty.rows===0,'Missing is not zero');
const daily=m.daily([{t,rows:60,valid:60,expected:60,sum:60,peak:2,high:true},{t:t+m.HOUR,rows:60,valid:0,expected:60,sum:0,peak:null,high:false}])[0];
check(daily.energy===1 && daily.average===1 && daily.valid===60 && daily.expected===120 && daily.highHours===1,'Daily aggregation excludes missing');
console.println('PASS',n,'model checks in JSH');
