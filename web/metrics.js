/* PSG Executive Dashboard — ฟังก์ชันคำนวณ (ไม่มี DOM) ใช้ร่วมกันระหว่างหน้าเว็บและชุดทดสอบ
   เงินทุกตัวเป็นสตางค์ (จำนวนเต็ม) · ไม่มีข้อมูล = null (แสดง N/A) ห้ามแทนด้วยศูนย์ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PSGM = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const sum = (a, f) => a.reduce((s, x) => s + (f ? f(x) : x), 0);
  const sumN = (a, f) => { const v = a.map(f).filter(x => x !== null && x !== undefined); return v.length ? sum(v) : null; };
  const pct = (a, b) => (a === null || b === null || b === 0 || b === undefined) ? null : a / b * 100;
  const chg = (a, b) => (a === null || b === null || !b) ? null : (a - b) / Math.abs(b) * 100;
  const daysBetween = (a, b) => Math.round((Date.parse(b.slice(0, 10) + 'T00:00:00Z') - Date.parse(a.slice(0, 10) + 'T00:00:00Z')) / 864e5);
  const countBy = (a, f) => { const m = {}; a.forEach(x => { const k = f(x); m[k] = (m[k] || 0) + 1; }); return Object.entries(m).sort((x, y) => y[1] - x[1]); };

  /* ---------- P&L จาก Ledger ---------- */
  const LINES = [
    ['rev_sales', 'รายได้จากการขายไฟฟ้า', 1], ['rev_other', 'รายได้อื่น', 1], ['cos', 'ต้นทุนขาย/ต้นทุนการผลิต', -1], ['gp', 'กำไรขั้นต้น', 0],
    ['sell', 'ค่าใช้จ่ายในการขาย', -1], ['admin', 'ค่าใช้จ่ายบริหาร (ไม่รวมค่าเสื่อม)', -1], ['ebitda', 'EBITDA', 0], ['dep', 'ค่าเสื่อมราคา/ตัดจำหน่าย', -1],
    ['int', 'ดอกเบี้ยจ่าย', -1], ['ebt', 'กำไร(ขาดทุน)ก่อนภาษี', 0], ['tax', 'ภาษีเงินได้', -1], ['np', 'กำไร(ขาดทุน)สุทธิ', 0]];
  function pnlSel(S, months) { const L = S.pnl.lines, o = {}; Object.keys(L).forEach(k => { o[k] = sum(months, m => L[k][m] || 0); }); return o; }
  function monthStatus(S, ym) {
    const r = S.revenue[ym] || {}, flags = ['ผลเบื้องต้นจาก Ledger — ยังไม่มีข้อมูลยืนยันการปิดบัญชี'];
    if (r.actual === null || r.actual === undefined) flags.unshift('รายได้เดือนนี้เป็นประมาณการ (ยังไม่มีรายได้จริง/BL)');
    return { prelim: true, estRevenue: r.actual === null || r.actual === undefined, flags };
  }

  /* ---------- การผลิต/การขาย (ฐานเดือนผลิต) ---------- */
  const prodRow = (S, pm) => S.prod.find(p => p.pm === pm) || null;
  function latestKwh(S) { const a = S.prod.filter(p => p.kwh !== null); return a.length ? a[a.length - 1] : null; }
  function cosPerKwh(S, pm) {                 // ต้นทุนขาย (Ledger เดือนเดียวกับเดือนผลิต — Ledger บันทึกแบบค้างจ่ายตามเดือน) ÷ kWh ขายของเดือนผลิตนั้น
    const p = prodRow(S, pm); if (!p || !p.kwh) return null;
    const c = S.pnl.lines.cos[pm]; if (c === undefined) return null;
    return c / 100 / p.kwh;
  }
  function estAccuracy(S) {                   // ความต่างประมาณการรายได้กับรายได้จริงต่อเดือนผลิต
    const a = S.prod.filter(p => p.est !== null && p.actual !== null);
    if (!a.length) return null;
    return { n: a.length, mape: sum(a, p => Math.abs(p.actual - p.est) / p.actual) / a.length * 100, rows: a };
  }

  /* ---------- เจ้าหนี้: อายุหนี้ (ไม่รวมกับ PO/Ledger) ---------- */
  const AP_BUCKETS = [['notdue', 'ยังไม่ถึงกำหนด'], ['d30', 'เกิน 1–30 วัน'], ['d90', 'เกิน 31–90 วัน'], ['d365', 'เกิน 91–365 วัน'], ['old', 'เกิน 1 ปี']];
  function apBucket(r, asof) { const d = daysBetween(r.due, asof); return d <= 0 ? 'notdue' : d <= 30 ? 'd30' : d <= 90 ? 'd90' : d <= 365 ? 'd365' : 'old'; }
  function apAging(pay, asof) { const o = {}; AP_BUCKETS.forEach(([k]) => { o[k] = { n: 0, amt: 0 }; }); pay.forEach(r => { const b = o[apBucket(r, asof)]; b.n++; b.amt += r.amount; }); return o; }

  /* ---------- ใบงานซ่อมบำรุง ---------- */
  const FLAG = { done_gap: 'วันเสร็จช่างต่างจากวันเสร็จในระบบเกิน 7 วัน', start_before_report: 'เวลาเริ่มก่อนเวลาแจ้ง', done_before_report: 'เวลาเสร็จก่อนเวลาแจ้ง',
    stop_text_conflict: 'ข้อความบอกว่าเดินไม่ได้ แต่สถานะระบุใช้งานได้', maybe_repeat: 'เครื่องเดียวกันแจ้งซ้ำภายใน 30 วัน (อาจซ้ำ/ต่อเนื่อง)' };
  const AGE = [['a7', 'ไม่เกิน 7 วัน', 7], ['a30', '8–30 วัน', 30], ['a90', '31–90 วัน', 90], ['a90p', 'เกิน 90 วัน', 1e9]];
  function woStats(rows, asof) {
    const open = rows.filter(r => r.state === 'open'), done = rows.filter(r => r.state === 'done');
    const age = {}; AGE.forEach(([k]) => { age[k] = 0; });
    open.forEach(r => { const d = daysBetween(r.reported, asof); age[AGE.find(a => d <= a[2])[0]]++; });
    const withSla = done.filter(r => r.sla_h && r.min_done !== null);
    return {
      total: rows.length, open: open.length, done: done.length, rejected: rows.filter(r => r.state === 'rejected').length,
      qr: new Set(rows.map(r => r.qr).filter(Boolean)).size, age,
      flags: Object.keys(FLAG).map(k => [k, rows.filter(r => r.flags.indexOf(k) >= 0).length]),
      slaMet: withSla.length ? withSla.filter(r => r.min_done <= r.sla_h * 60).length : null, slaN: withSla.length,
      external: rows.filter(r => r.external).length, safety: rows.filter(r => r.safety).length
    };
  }

  /* ---------- ตัวจัดรูปแบบตัวเลขสำหรับ count-up (ทศนิยม ติดลบ บาท ล้านบาท %) ---------- */
  function splitNum(txt) {
    const m = String(txt).match(/[−-]?[\d,]+(\.\d+)?/); if (!m) return null;
    const raw = m[0].replace('−', '-').replace(/,/g, ''), v = parseFloat(raw);
    if (!isFinite(v)) return null;
    return { pre: txt.slice(0, m.index), post: txt.slice(m.index + m[0].length), v, dec: m[1] ? m[1].length - 1 : 0, minus: m[0][0] === '−' };
  }
  function fmtNum(v, dec, minusSign) {
    const s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
    return (v < 0 ? (minusSign || '-') : '') + s;
  }
  return { sum, sumN, pct, chg, daysBetween, countBy, LINES, pnlSel, monthStatus, prodRow, latestKwh, cosPerKwh, estAccuracy, AP_BUCKETS, apBucket, apAging, FLAG, AGE, woStats, splitNum, fmtNum };
});
