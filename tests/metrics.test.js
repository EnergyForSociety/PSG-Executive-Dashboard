// ทดสอบฟังก์ชันคำนวณ — รัน: node tests/metrics.test.js
const assert = require('assert'), M = require('../web/metrics.js');
let n = 0; const t = (name, f) => { f(); n++; };
t('pct ฐานศูนย์ = null', () => { assert.strictEqual(M.pct(5, 0), null); assert.strictEqual(M.pct(null, 4), null); assert.strictEqual(M.pct(1, 4), 25); });
t('chg ฐานศูนย์ = null', () => assert.strictEqual(M.chg(5, 0), null));
t('splitNum ติดลบ ทศนิยม หน่วย', () => { const p = M.splitNum('−1.70 ล้านบาท'); assert.strictEqual(p.v, -1.7); assert.strictEqual(p.dec, 2); assert.strictEqual(p.minus, true); assert.strictEqual(p.post, ' ล้านบาท'); });
t('splitNum เปอร์เซ็นต์', () => { const p = M.splitNum('54.3%'); assert.strictEqual(p.v, 54.3); assert.strictEqual(p.post, '%'); });
t('splitNum ไม่มีตัวเลข = null', () => assert.strictEqual(M.splitNum('N/A'), null));
t('fmtNum จบตรงค่าจริง', () => { assert.strictEqual(M.fmtNum(-1.7, 2, '−'), '−1.70'); assert.strictEqual(M.fmtNum(468269, 0), '468,269'); });
t('apAging แบ่งช่วง', () => { const a = M.apAging([{ due: '2026-11-20', amount: 100 }, { due: '2026-11-01', amount: 200 }, { due: '2024-01-01', amount: 300 }], '2026-11-15');
  assert.strictEqual(a.notdue.amt, 100); assert.strictEqual(a.d30.amt, 200); assert.strictEqual(a.old.amt, 300); });
t('woStats ไม่นับใบงานถูกปฏิเสธเป็นค้าง', () => { const w = M.woStats([{ state: 'open', reported: '2026-11-10', flags: [], qr: 'A' }, { state: 'rejected', reported: '2026-01-01', flags: [], qr: 'A' }, { state: 'done', reported: '2026-01-01', flags: ['done_gap'], qr: 'B', sla_h: 72, min_done: 100 }], '2026-11-15');
  assert.strictEqual(w.open, 1); assert.strictEqual(w.rejected, 1); assert.strictEqual(w.qr, 2); assert.strictEqual(w.age.a7, 1); assert.strictEqual(w.slaMet, 1); });
const S = { prod: [{ pm: '2026-02', kwh: 1000, est: 90, actual: 100 }, { pm: '2026-01', kwh: null, est: 50, actual: null }], pnl: { lines: { cos: { '2026-02': 50000, '2026-01': 1 } } }, revenue: { '2026-01': { actual: null }, '2026-02': { actual: 100 } } };
t('cosPerKwh ไม่มี kWh = null', () => { assert.strictEqual(M.cosPerKwh(S, '2026-01'), null); assert.strictEqual(M.cosPerKwh(S, '2026-02'), 0.5); });
t('estAccuracy ใช้เฉพาะเดือนที่มีทั้งสองค่า', () => { const e = M.estAccuracy(S); assert.strictEqual(e.n, 1); assert.strictEqual(e.mape, 10); });
t('monthStatus รายได้ประมาณการ', () => { assert.strictEqual(M.monthStatus(S, '2026-01').estRevenue, true); assert.strictEqual(M.monthStatus(S, '2026-02').estRevenue, false); });
console.log('ผ่าน', n, 'ข้อ');
