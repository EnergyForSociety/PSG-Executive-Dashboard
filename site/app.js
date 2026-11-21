/* PSG Executive Dashboard — ส่วนแสดงผล (อ่าน snapshot ที่สร้างจาก scripts/build_snapshot.py)
   ตัวเลขทุกตัวคำนวณจาก web/metrics.js · ไม่มีการเรียกบริการภายนอก · ไม่มีข้อมูล = N/A (ไม่ใช่ศูนย์) */
(function () {
  'use strict';
  const M = window.PSGM, $ = (s, r) => (r || document).querySelector(s);
  let S = null, DR = [], TB = [], GEN = 0;
  const st = { page: 'exec', period: 'ytd', pm: null, sub: 'prod', pv: 'all' };
  const TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const PAGES = [['exec', 'Executive'], ['sales', 'การขาย'], ['fin', 'การเงิน'], ['proj', 'โครงการ'], ['strat', 'กลยุทธ์'], ['ops', 'ปฏิบัติการ'], ['data', 'สถานะข้อมูล']];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = (n, d) => M.fmtNum(Number(n), d || 0, '−');
  const B = s => s === null || s === undefined ? '–' : nf(s / 100, 2);
  const MBv = s => Math.abs(s) >= 1e8 ? [nf(s / 1e8, 2), 'ล้านบาท'] : [nf(s / 100, 0), 'บาท'];
  const MB = s => s === null || s === undefined ? 'N/A' : MBv(s).join(' ');
  const thM = ym => ym ? TH[+ym.slice(5, 7) - 1] + ' ' + String(+ym.slice(0, 4) + 543).slice(2) : '–';
  const thML = ym => ym ? TH[+ym.slice(5, 7) - 1] + ' ' + (+ym.slice(0, 4) + 543) : '–';
  const thD = iso => iso ? +iso.slice(8, 10) + ' ' + TH[+iso.slice(5, 7) - 1] + ' ' + String(+iso.slice(0, 4) + 543).slice(2) : '–';
  const NA = t => `<span class="na">${esc(t || 'N/A')}</span>`;
  const tag = (t, k) => `<span class="tag ${k || ''}">${esc(t)}</span>`;
  const drill = fn => { DR.push(fn); return `data-drill="${DR.length - 1}"`; };
  const slot = spec => { TB.push(spec); return `<div data-table="${TB.length - 1}"></div>`; };
  const months = () => S.meta.pnl_months;
  const selMonths = () => st.period === 'ytd' ? months() : [st.period];
  const periodTxt = () => st.period === 'ytd' ? `ม.ค.–${thM(months()[months().length - 1])} (YTD งวดบัญชี)` : 'งวดบัญชี ' + thML(st.period);

  /* ---------- ตาราง: ค้นหา เรียง แบ่งหน้า ส่งออก CSV ---------- */
  const csvCell = v => { const s = v == null ? '' : String(v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  function exportCsv(spec, rows) {
    const out = [spec.cols.map(c => csvCell(c.label)).join(',')];
    rows.forEach(r => out.push(spec.cols.map(c => csvCell(c.csv ? c.csv(r) : c.money ? (r[c.k] == null ? '' : r[c.k] / 100) : r[c.k])).join(',')));
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + out.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    a.download = (spec.file || 'PSG_export') + '_' + S.meta.asof + '.csv'; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function mountTable(el, spec) {
    const v = { q: '', sort: spec.sort || null, dir: spec.dir || -1, page: 0, size: spec.size || 12, filt: {} };
    const val = (r, c) => c.sortv ? c.sortv(r) : r[c.k];
    function rows() {
      let a = spec.rows;
      (spec.filters || []).forEach(f => { const x = v.filt[f.k]; if (x) a = a.filter(r => String(f.get ? f.get(r) : r[f.k]) === x); });
      if (v.q) { const q = v.q.toLowerCase(); a = a.filter(r => spec.cols.some(c => String(c.csv ? c.csv(r) : r[c.k] == null ? '' : r[c.k]).toLowerCase().indexOf(q) >= 0)); }
      if (v.sort) { const c = spec.cols.find(x => x.k === v.sort); a = a.slice().sort((x, y) => { const p = val(x, c), q2 = val(y, c); return (p < q2 ? -1 : p > q2 ? 1 : 0) * v.dir; }); }
      return a;
    }
    function draw() {
      const a = rows(), pages = Math.max(1, Math.ceil(a.length / v.size)); if (v.page >= pages) v.page = pages - 1;
      const pg = a.slice(v.page * v.size, (v.page + 1) * v.size), tot = spec.total ? spec.total(a) : null;
      el.innerHTML = `<div class="tools no-print" style="margin-bottom:10px;justify-content:space-between">
        <div class="tools"><input type="search" placeholder="ค้นหาในตาราง" value="${esc(v.q)}" aria-label="ค้นหาในตาราง">
        ${(spec.filters || []).map(f => `<select data-f="${f.k}" aria-label="${esc(f.label)}"><option value="">${esc(f.label)}: ทั้งหมด</option>${[...new Set(spec.rows.map(r => String(f.get ? f.get(r) : r[f.k])))].sort().map(o => `<option ${v.filt[f.k] === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`).join('')}</div>
        <div class="tools"><span class="note">${nf(a.length)} รายการ</span><button class="btn" data-x="csv" type="button">ส่งออก CSV</button></div></div>
        <div class="tbl-wrap"><table ${spec.minw ? `style="min-width:${spec.minw}px"` : ''}><thead><tr>${spec.cols.map(c => `<th class="sortable ${c.r ? 'r' : ''}" data-s="${c.k}" scope="col">${esc(c.label)}${v.sort === c.k ? (v.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead>
        <tbody>${pg.length ? pg.map(r => `<tr>${spec.cols.map(c => `<td class="${c.r ? 'r num' : ''}">${c.fmt ? c.fmt(r) : c.money ? B(r[c.k]) : esc(r[c.k])}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${spec.cols.length}"><div class="empty">${esc(spec.empty || 'ไม่พบรายการตามเงื่อนไข')}</div></td></tr>`}</tbody>
        ${tot ? `<tfoot><tr>${spec.cols.map((c, i) => `<td class="${c.r ? 'r num' : ''}">${i === 0 ? 'รวม ' + nf(a.length) + ' รายการ' : tot[c.k] != null ? B(tot[c.k]) : ''}</td>`).join('')}</tr></tfoot>` : ''}</table></div>
        ${pages > 1 ? `<div class="pager no-print"><span>หน้า ${v.page + 1} / ${pages}</span><button class="btn" type="button" data-x="prev" ${v.page ? '' : 'disabled'}>ก่อนหน้า</button><button class="btn" type="button" data-x="next" ${v.page < pages - 1 ? '' : 'disabled'}>ถัดไป</button></div>` : ''}`;
      const inp = $('input[type=search]', el);
      inp.oninput = () => { v.q = inp.value; v.page = 0; const p = inp.selectionStart; draw(); const n = $('input[type=search]', el); n.focus(); n.setSelectionRange(p, p); };
      el.querySelectorAll('select[data-f]').forEach(s => s.onchange = () => { v.filt[s.dataset.f] = s.value; v.page = 0; draw(); });
      el.querySelectorAll('th[data-s]').forEach(h => h.onclick = () => { if (v.sort === h.dataset.s) v.dir = -v.dir; else { v.sort = h.dataset.s; v.dir = 1; } draw(); });
      el.querySelectorAll('button[data-x]').forEach(b => b.onclick = () => { if (b.dataset.x === 'csv') exportCsv(spec, rows()); else { v.page += b.dataset.x === 'next' ? 1 : -1; draw(); } });
    }
    draw();
  }
  function openTable(spec) {
    const m = $('#modal'), box = $('#modal-box');
    box.innerHTML = `<div class="head"><div><h2 id="modal-title">${esc(spec.title)}</h2><p class="sub">${spec.sub || ''}</p></div><button class="btn" type="button" id="modal-x">ปิด</button></div><div id="modal-t"></div>`;
    m.hidden = false; mountTable($('#modal-t'), spec); $('#modal-x').onclick = closeModal; $('#modal-x').focus();
  }
  function closeModal() { $('#modal').hidden = true; $('#modal-box').innerHTML = ''; }

  /* ---------- การ์ด KPI (count-up: ค่าเต็มอยู่ใน aria-label · N/A ไม่ถูก animate) ---------- */
  function kpi(o) {
    const has = o.val !== null && o.val !== undefined && o.val !== 'N/A';
    const valHtml = has ? `<span class="v" data-cu aria-hidden="true">${esc(o.val)}</span>${o.unit ? ` <small aria-hidden="true">${esc(o.unit)}</small>` : ''}` : NA(o.na || 'N/A');
    const aria = esc(o.label + ': ' + (has ? o.val + ' ' + (o.unit || '') : (o.na || 'ไม่มีข้อมูล')));
    const inner = `<span class="lab">${esc(o.label)}</span><span class="val" role="text" aria-label="${aria}">${valHtml}</span>${o.sub ? `<span class="full">${o.sub}</span>` : ''}${o.badge ? `<span>${o.badge}</span>` : ''}${o.fn ? '<span class="more">ดูรายละเอียด →</span>' : ''}`;
    return o.fn ? `<button type="button" class="card accent ${o.c || ''} kpi" ${drill(o.fn)}>${inner}</button>` : `<div class="card accent ${o.c || ''} kpi">${inner}</div>`;
  }
  function countUp(root, gen) {
    const reduce = (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) || document.documentElement.classList.contains('no-anim');
    if (reduce) return;
    root.querySelectorAll('[data-cu]').forEach(el => {
      const p = M.splitNum(el.textContent); if (!p || !p.v) return;
      const final = el.textContent, t0 = performance.now(), dur = 900;
      const step = t => {
        if (gen !== GEN || !el.isConnected) { el.textContent = final; return; }     // ยกเลิกชุดเก่าเมื่อเปลี่ยนตัวกรอง
        const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
        el.textContent = k < 1 ? p.pre + M.fmtNum(p.v * e, p.dec, p.minus ? '−' : '-') + p.post : final;
        if (k < 1) requestAnimationFrame(step);
      };
      el.textContent = p.pre + M.fmtNum(0, p.dec) + p.post; requestAnimationFrame(step);
    });
  }

  /* ---------- กราฟ SVG (แท่ง + เส้น + tooltip) ---------- */
  function niceStep(x) { const p = Math.pow(10, Math.floor(Math.log10(x || 1))), f = x / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p; }
  function chart(o) {   // o: {labels, bars:[{name, color, vals}], stacked, line:{name, vals, fmt}, yfmt, tip(i)}
    const W = 760, H = 280, L = 58, R = o.line ? 58 : 12, T = 18, Bm = 36, iw = W - L - R, ih = H - T - Bm, n = o.labels.length, bw = iw / n;
    const tops = o.labels.map((_, i) => o.stacked ? o.bars.reduce((s, b) => s + Math.max(0, b.vals[i] || 0), 0) : Math.max(0, ...o.bars.map(b => b.vals[i] || 0)));
    const lows = o.labels.map((_, i) => Math.min(0, ...o.bars.map(b => b.vals[i] || 0)));
    const mx = Math.max(1, ...tops), mn = Math.min(0, ...lows), step = niceStep((mx - mn) / 4), top = Math.ceil(mx / step) * step, bot = Math.floor(mn / step) * step;
    const y = v => T + ih - (v - bot) / (top - bot) * ih;
    let g = '';
    for (let v = bot; v <= top + 1e-9; v += step) g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" style="stroke:var(--grid)"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" style="fill:var(--muted)">${esc(o.yfmt(v))}</text>`;
    o.labels.forEach((lab, i) => {
      const x0 = L + i * bw; let acc = 0;
      g += `<g class="hit" data-tip="${esc(o.tip(i))}" tabindex="0" role="img" aria-label="${esc(o.tip(i))}"><rect class="bg" x="${x0}" y="${T}" width="${bw}" height="${ih}" style="fill:transparent"/>`;
      o.bars.forEach((b, j) => {
        const v = b.vals[i]; if (v === null || v === undefined) return;
        const w = o.stacked ? bw * .6 : bw * .7 / o.bars.length, x = o.stacked ? x0 + bw * .2 : x0 + bw * .15 + j * w;
        const y1 = o.stacked ? y(acc + Math.max(0, v)) : y(Math.max(0, v)), y2 = o.stacked ? y(acc) : y(Math.min(0, v));
        g += `<rect class="gy" x="${x}" y="${y1}" width="${w}" height="${Math.max(0, y2 - y1)}" rx="3" style="fill:${b.color}"/>`; if (o.stacked) acc += Math.max(0, v);
      });
      g += `<text x="${x0 + bw / 2}" y="${H - 14}" text-anchor="middle" font-size="11.5" style="fill:var(--muted)">${esc(lab)}</text></g>`;
    });
    if (o.line) {
      const lv = o.line.vals.filter(v => v !== null), lmx = Math.max(1, ...lv), ls = niceStep(lmx / 4), ltop = Math.ceil(lmx / ls) * ls, ly = v => T + ih - v / ltop * ih;
      for (let v = 0; v <= ltop + 1e-9; v += ls) g += `<text x="${W - R + 6}" y="${ly(v) + 4}" font-size="11" style="fill:var(--muted)">${esc(o.line.fmt(v))}</text>`;
      let d = '', seg = false;
      o.line.vals.forEach((v, i) => { if (v === null) { seg = false; return; } d += (seg ? 'L' : 'M') + (L + i * bw + bw / 2) + ' ' + ly(v) + ' '; seg = true; });
      g += `<path class="draw" d="${d}" style="fill:none;stroke:var(--line2);stroke-width:2.5"/>`;
      o.line.vals.forEach((v, i) => { if (v !== null) g += `<circle class="fade" cx="${L + i * bw + bw / 2}" cy="${ly(v)}" r="4" style="fill:var(--card);stroke:var(--line2);stroke-width:2"/>`; });
    }
    const leg = o.bars.map(b => `<span><i style="background:${b.color}"></i>${esc(b.name)}</span>`).join('') + (o.line ? `<span><i style="background:var(--line2);height:3px;vertical-align:3px"></i>${esc(o.line.name)}</span>` : '');
    return `<div class="legend">${leg}</div><svg class="chart" viewBox="0 0 ${W} ${H}" role="group" aria-label="${esc(o.title || 'กราฟ')}">${g}</svg>`;
  }
  const mfmt = v => nf(v / 1e8, 1);    // สตางค์ → ล้านบาท

  /* ---------- นิยามคอลัมน์ ---------- */
  const salesCols = [
    { k: 'pm', label: 'เดือนผลิต', fmt: r => r.pm ? thML(r.pm) + (r.pm_rule ? '' : '') : NA('อ่านไม่ได้'), sortv: r => r.pm || '' },
    { k: 'doc', label: 'BL' }, { k: 'bl_date', label: 'วันที่ BL', fmt: r => thD(r.bl_date) },
    { k: 'kwh', label: 'kWh (จากข้อความ)', r: 1, fmt: r => r.kwh ? nf(r.kwh) : NA(), csv: r => r.kwh == null ? '' : r.kwh },
    { k: 'amt', label: 'ก่อน VAT', r: 1, money: 1 }, { k: 'vat', label: 'VAT', r: 1, money: 1 },
    { k: 'price', label: 'บาท/kWh', r: 1, fmt: r => r.price ? nf(r.price, 4) : NA(), csv: r => r.price == null ? '' : r.price.toFixed(4) },
    { k: 'iv', label: 'IV/RV', fmt: r => r.iv ? esc(r.iv) : NA('ยังไม่ออก') }, { k: 'iv_date', label: 'วันที่ IV', fmt: r => thD(r.iv_date) },
    { k: 'iv_status', label: 'สถานะรับชำระ', fmt: r => r.iv_status === 'Cash' ? tag('รับแล้ว (สถานะ IV)', 'fact') : r.iv ? tag(r.iv_status) : tag('ค้างรับ', 'wait'), csv: r => r.iv_status || 'ค้างรับ' },
    { k: 'kwh_src', label: 'ข้อความต้นฉบับ kWh', fmt: r => r.kwh_src ? `<code>${esc(r.kwh_src)}</code>` : NA(r.kwh_status), csv: r => r.kwh_src || r.kwh_status }];
  const ledgerCols = [{ k: 'date', label: 'วันที่', fmt: r => thD(r.date) }, { k: 'ref', label: 'เอกสาร' }, { k: 'acc', label: 'บัญชี' },
    { k: 'kind', label: 'ลักษณะ', fmt: r => ({ est: tag('ประมาณการ', 'wait'), rev: tag('กลับรายการ', 'wait'), reclass: tag('ปรับปรุง/โอนบัญชี'), act: tag('รายการจริง', 'fact') }[r.kind] || ''), csv: r => r.kind },
    { k: 'note', label: 'คำอธิบาย', fmt: r => esc(r.note) + (r.flag ? ' ' + tag(r.flag, 'wait') : '') }, { k: 'net', label: 'สุทธิ (เดบิต−เครดิต)', r: 1, money: 1 }];
  const payCols = [{ k: 'doc', label: 'เอกสาร' }, { k: 'conv', label: 'ประเภท' }, { k: 'vendor', label: 'เจ้าหนี้' }, { k: 'type', label: 'กลุ่มคู่ค้า' },
    { k: 'date', label: 'วันที่', fmt: r => thD(r.date) }, { k: 'due', label: 'ครบกำหนด', fmt: r => thD(r.due) },
    { k: 'overdue', label: 'เกินกำหนด (วัน)', r: 1, fmt: r => { const d = M.daysBetween(r.due, S.meta.asof); return d > 0 ? nf(d) : '–'; }, sortv: r => M.daysBetween(r.due, S.meta.asof) },
    { k: 'opening', label: 'ยอดยกมา', fmt: r => r.opening ? tag('ยกมา', 'wait') : '', csv: r => r.opening ? 'ยกมา' : '' }, { k: 'amount', label: 'คงค้างหลังหัก WHT', r: 1, money: 1 }];
  const woCols = [{ k: 'wo', label: 'ใบงาน' }, { k: 'reported', label: 'แจ้ง', fmt: r => thD(r.reported) }, { k: 'status', label: 'สถานะ' }, { k: 'machine', label: 'เครื่องจักร' },
    { k: 'qr', label: 'QR' }, { k: 'mtype', label: 'ประเภท' }, { k: 'urgency', label: 'ความด่วน' }, { k: 'symptom', label: 'อาการ', fmt: r => esc(r.symptom.slice(0, 90)) },
    { k: 'flags', label: 'ข้อสังเกตข้อมูล', fmt: r => r.flags.map(f => tag(M.FLAG[f], 'wait')).join(' ') + (r.repeat_of ? ` <span class="note">ก่อนหน้า ${esc(r.repeat_of)}</span>` : ''), csv: r => r.flags.join('|') }];

  /* ---------- Insight ---------- */
  function insight(o) {
    return `<div class="insight ${o.warn ? 'warn' : ''}"><h3>${esc(o.title)}</h3><dl><dt>ช่วงเวลา</dt><dd>${o.when}</dd><dt>ตัวเลข</dt><dd>${o.num}</dd><dt>ผลต่อการบริหาร</dt><dd>${o.impact}</dd><dt>สิ่งที่เสนอ</dt><dd>${o.act}</dd></dl>${o.fn ? `<button class="link" type="button" ${drill(o.fn)}>ดูหลักฐาน →</button>` : ''}</div>`;
  }
  function insights() {
    const out = [], P = S.prod.filter(p => p.kwh), last = P[P.length - 1], prev = P[P.length - 2];
    if (last && prev) {
      const c = M.chg(last.kwh, prev.kwh), mn = P.reduce((a, b) => a.kwh < b.kwh ? a : b);
      out.push({ title: `kWh ขายเดือนผลิต ${thML(last.pm)} ${c < 0 ? 'ลดลง' : 'เพิ่มขึ้น'} ${nf(Math.abs(c), 1)}% จากเดือนก่อน`, warn: c < 0,
        when: `เดือนผลิต ${thM(P[0].pm)}–${thM(last.pm)} (เฉพาะเดือนที่มี kWh ในข้อความ BL)`, num: `${nf(last.kwh)} kWh เทียบ ${nf(prev.kwh)} kWh · ต่ำสุดในช่วงคือ ${thM(mn.pm)} ${nf(mn.kwh)} kWh`,
        impact: 'รายได้ตามสัญญา VSPP ผันตามหน่วยขาย — หน่วยขายต่ำลงกระทบรายได้โดยตรง (ความสัมพันธ์ ไม่ได้ระบุสาเหตุ)', act: 'ขอข้อมูลผลิต/ชั่วโมงเดินเครื่อง/สาเหตุหยุดรายวันเพื่ออธิบายสาเหตุ (ยังไม่มีในระบบ)',
        fn: () => openTable({ title: 'BL ตามเดือนผลิต', sub: 'kWh อ่านจากข้อความ BL — รอยืนยันกับมิเตอร์', cols: salesCols, rows: S.sales, sort: 'pm', dir: 1, file: 'PSG_sales' }) });
    }
    const ea = M.estAccuracy(S);
    if (ea) out.push({ title: `ประมาณการรายได้สิ้นเดือนคลาดจากรายได้จริงเฉลี่ย ${nf(ea.mape, 1)}%`, when: `${ea.n} เดือนผลิตที่มีทั้งประมาณการและรายได้จริง`,
      num: ea.rows.map(p => `${thM(p.pm)} ${nf((p.actual - p.est) / 100, 0)}`).join(' · ') + ' บาท (จริง − ประมาณการ)',
      impact: 'กำไรรายเดือนของงวดล่าสุดยังเป็นตัวเลขประมาณการจนกว่าจะออก BL จริง', act: 'อ่านงวดล่าสุดเป็น "ผลเบื้องต้น" และติดตามส่วนต่างเมื่อออก BL',
      fn: () => openTable({ title: 'ประมาณการเทียบรายได้จริง (บัญชี 4001000)', cols: [{ k: 'pm', label: 'เดือนผลิต', fmt: r => thML(r.pm) }, { k: 'est', label: 'ประมาณการ', r: 1, money: 1 }, { k: 'actual', label: 'รายได้จริง (BL)', r: 1, money: 1 }, { k: 'est_var', label: 'ส่วนต่าง', r: 1, money: 1 }], rows: S.prod, sort: 'pm', dir: 1, file: 'PSG_rev_est' }) });
    const L = S.pnl.lines, ms = months(), lm = ms[ms.length - 1], ebt = M.sum(ms, m => L.ebt[m]);
    const negM = ms.filter(m => L.ebt[m] < 0);
    out.push({ title: `กำไรก่อนภาษีสะสม ${MB(ebt)} · ขาดทุน ${negM.length} จาก ${ms.length} เดือน`, warn: ebt < 0, when: `งวดบัญชี ${thM(ms[0])}–${thM(lm)} (ผลเบื้องต้นจาก Ledger)`,
      num: `ค่าเสื่อมราคา ${MB(M.sum(ms, m => L.dep[m]))} · EBITDA ${MB(M.sum(ms, m => L.ebitda[m]))}`, impact: 'ค่าเสื่อมราคาเครื่องจักรเป็นต้นทุนหลักที่ไม่ใช่เงินสด — EBITDA ยังเป็นบวก', act: 'ยืนยันการปิดบัญชีรายเดือนกับฝ่ายบัญชีก่อนใช้ตัวเลขกำไรเป็นทางการ',
      fn: () => { st.page = 'fin'; location.hash = '#/fin'; } });
    const mt = S.maint_ledger, est = M.sum(mt.filter(x => x.kind === 'est'), x => x.net), tot = M.sum(mt, x => x.net);
    if (tot) out.push({ title: `ค่าซ่อมบำรุงในบัญชี ${nf(est / tot * 100, 0)}% เป็นรายการประมาณการรายเดือน`, when: `ม.ค.–${thM(lm)} (บัญชี ${Object.keys(S.maint_acc).join(', ')})`,
      num: `ประมาณการ ${MB(est)} จากยอดสุทธิ ${MB(tot)}`, impact: 'ยังผูกค่าซ่อมกับใบงาน/เครื่องจักรรายตัวไม่ได้จนกว่าจะมีใบแจ้งหนี้จริงและตารางเชื่อมใบงาน–PO', act: 'ให้บัญชีระบุเกณฑ์ประมาณการ และให้ OM ยืนยันตารางเชื่อมใบงาน–PR/PO',
      fn: () => openTable({ title: 'รายการบัญชีซ่อมบำรุง', sub: 'มุมมองเจาะดู — ยอดนี้อยู่ใน P&L แล้ว ไม่บวกซ้ำ', cols: ledgerCols, rows: mt, sort: 'date', dir: 1, file: 'PSG_maint_ledger', total: a => ({ net: M.sum(a, x => x.net) }) }) });
    const old = S.pay.filter(p => p.opening), oldAmt = M.sum(old, p => p.amount);
    if (old.length) out.push({ title: `เจ้าหนี้ยอดยกมาค้างนาน ${old.length} รายการ ${MB(oldAmt)}`, warn: true, when: `เอกสารปี ${Math.min(...old.map(p => +p.date.slice(0, 4))) + 543}–${Math.max(...old.map(p => +p.date.slice(0, 4))) + 543} ณ ${thD(S.meta.asof)}`,
      num: `${nf(oldAmt / M.sum(S.pay, p => p.amount) * 100, 0)}% ของยอดเจ้าหนี้คงค้างทั้งหมด · ส่วนใหญ่เป็นกิจการที่เกี่ยวข้องกัน`, impact: 'ยอดเจ้าหนี้รวมสูงกว่าภาระจ่ายปกติ — กระทบการวางแผนเงินสด', act: 'ฝ่ายการเงินยืนยันสถานะ (จ่ายจริง/หักกลบ/ตัดยอด) ของรายการยกมา',
      fn: () => openTable({ title: 'เจ้าหนี้ยอดยกมา', cols: payCols, rows: old, sort: 'due', dir: 1, file: 'PSG_ap_opening', total: a => ({ amount: M.sum(a, x => x.amount) }) }) });
    return out.slice(0, 5);
  }

  /* ---------- หน้า ---------- */
  function freshness() {
    const ds = S.datasets, f = t => ds.filter(d => d.tool === t && d.ok).map(d => d.fetched_at).sort().slice(-1)[0];
    const m = S.maint ? S.maint.source : null;
    return `<div class="cols note"><span>บัญชี/Ledger: ${esc((f('get_ledger') || '').slice(0, 10) || 'N/A')}</span><span>ขาย BL/IV: ${esc((f('get_b3_service_bill_report') || '').slice(0, 10) || 'N/A')}</span><span>จัดซื้อ PO/AP: ${esc((f('get_po3_purchase_order_report') || '').slice(0, 10))}</span><span>ใบงานซ่อม: ${m ? esc(m.file) + ' (' + thD(m.reported_to) + ')' : 'N/A'}</span><span>เงินสด: ${NA('รอแหล่งข้อมูล')}</span></div>`;
  }
  function pExec() {
    const ms = selMonths(), T = M.pnlSel(S, ms), lk = M.latestKwh(S), cpk = lk ? M.cosPerKwh(S, lk.pm) : null;
    const lmStatus = M.monthStatus(S, ms[ms.length - 1]);
    const prelim = tag(lmStatus.estRevenue ? 'ผลเบื้องต้น · รายได้งวดล่าสุดเป็นประมาณการ' : 'ผลเบื้องต้น/ยังไม่ปิดบัญชี', 'wait');
    return `<div class="grid g5">
      ${kpi({ label: 'รายได้ขายไฟฟ้า (Ledger)', val: MBv(T.rev_sales)[0], unit: MBv(T.rev_sales)[1], sub: periodTxt(), badge: prelim, fn: () => goto('fin') })}
      ${kpi({ label: 'กำไร(ขาดทุน)ก่อนภาษี', val: MBv(T.ebt)[0], unit: MBv(T.ebt)[1], sub: `EBITDA ${MB(T.ebitda)} · ${periodTxt()}`, badge: prelim, c: T.ebt < 0 ? 'warn' : '', fn: () => goto('fin') })}
      ${kpi({ label: 'kWh ขาย เดือนผลิตล่าสุด', val: lk ? nf(lk.kwh) : null, unit: 'kWh', sub: lk ? `เดือนผลิต ${thML(lk.pm)} · อ่านจากข้อความ BL (รอยืนยันมิเตอร์)` : '', fn: () => goto('sales') })}
      ${kpi({ label: 'ราคาเฉลี่ยขาย', val: lk && lk.price ? nf(lk.price, 2) : null, unit: 'บาท/kWh', sub: lk ? `ยอด BL ก่อน VAT ÷ kWh เดือนผลิต ${thM(lk.pm)}` : '' })}
      ${kpi({ label: 'ต้นทุนขายต่อ kWh', val: cpk !== null ? nf(cpk, 2) : null, unit: 'บาท/kWh', sub: lk ? `ต้นทุนขาย (51x) งวด ${thM(lk.pm)} ÷ kWh เดือนผลิตเดียวกัน · ไม่รวมค่าเสื่อม` : '' })}
    </div>
    <section class="card"><div class="head"><div><h2>รายได้ ต้นทุน และกำไรรายเดือน (งวดบัญชี)</h2><p class="sub">Ledger · ทุกเดือนเป็นผลเบื้องต้น ยังไม่มีข้อมูลยืนยันการปิดบัญชี · เส้น = kWh ขายตามเดือนผลิตเดียวกัน</p></div></div>
      ${chart({ title: 'รายได้และต้นทุนรายเดือน', labels: months().map(thM), bars: [{ name: 'รายได้ขายไฟฟ้า', color: 'var(--bar1)', vals: months().map(m => S.pnl.lines.rev_sales[m]) }, { name: 'ต้นทุนขาย (51x)', color: 'var(--bar3)', vals: months().map(m => S.pnl.lines.cos[m]) }, { name: 'กำไรก่อนภาษี', color: 'var(--bar2)', vals: months().map(m => S.pnl.lines.ebt[m]) }],
        line: { name: 'kWh ขาย (เดือนผลิต)', vals: months().map(m => (M.prodRow(S, m) || {}).kwh || null), fmt: v => nf(v / 1000, 0) + 'k' }, yfmt: mfmt,
        tip: i => { const m = months()[i], L = S.pnl.lines, p = M.prodRow(S, m); return `${thML(m)} · รายได้ ${MB(L.rev_sales[m])} · ต้นทุนขาย ${MB(L.cos[m])} · กำไรก่อนภาษี ${MB(L.ebt[m])} · kWh ${p && p.kwh ? nf(p.kwh) : 'N/A'}`; } })}
      <p class="note">หน่วยแกนซ้าย: ล้านบาท</p></section>
    <section class="card"><div class="head"><div><h2>ข้อค้นพบสำคัญ</h2><p class="sub">ทุกข้อคำนวณจากข้อมูลจริง กดดูหลักฐานได้ · แยกผลจริง/ประมาณการ · ไม่สรุปเหตุและผลจากความสัมพันธ์</p></div></div><div class="grid g2">${insights().map(insight).join('')}</div></section>
    <section class="card"><h3>ความสดของข้อมูลแต่ละกลุ่ม</h3>${freshness()}</section>`;
  }
  function pSales() {
    const P = S.prod.filter(p => p.pm >= '2026-01');
    return `<div class="grid g4">
      ${kpi({ label: 'kWh ขายสะสม (เดือนที่มีข้อมูล)', val: nf(M.sum(S.sales.filter(s => s.kwh), s => s.kwh)), unit: 'kWh', sub: `${S.sales.filter(s => s.kwh).length} เดือนผลิต (ก.พ.–ก.ย. 69) · ม.ค. 69 และก่อนหน้าไม่มีหน่วยในข้อความ = N/A` })}
      ${kpi({ label: 'ยอดเรียกเก็บ BL ปี 2569 (ก่อน VAT)', val: MBv(M.sum(S.sales.filter(s => s.bl_date >= '2026'), s => s.amt))[0], unit: MBv(M.sum(S.sales.filter(s => s.bl_date >= '2026'), s => s.amt))[1], sub: 'ตามวันที่ BL · ไม่บวก IV ซ้ำ' })}
      ${kpi({ label: 'รับชำระแล้ว (สถานะ IV = Cash)', val: MBv(M.sum(S.coll.filter(c => c.status === 'Cash' && c.date >= '2026'), c => c.grand))[0], unit: MBv(M.sum(S.coll.filter(c => c.status === 'Cash' && c.date >= '2026'), c => c.grand))[1], sub: 'รวม VAT · ใช้วันที่ IV แทนวันเงินเข้าจนกว่าจะมี bank statement' })}
      ${kpi({ label: 'ค้างรับ (BL ยังไม่ออก IV)', val: MBv(M.sum(S.ar_open, s => s.grand))[0], unit: MBv(M.sum(S.ar_open, s => s.grand))[1], sub: S.ar_open.map(s => `${s.doc} ครบกำหนด ${thD(s.due)}`).join(' · ') || 'ไม่มี', c: 'sky' })}
    </div>
    <section class="card"><div class="head"><div><h2>หน่วยขายและรายได้ตามเดือนผลิต</h2><p class="sub">แท่ง = ยอดก่อน VAT ของ BL (หรือประมาณการใน Ledger ถ้ายังไม่มี BL) · เส้น = kWh จากข้อความ BL</p></div></div>
      ${chart({ title: 'kWh และรายได้ตามเดือนผลิต', labels: P.map(p => thM(p.pm)), bars: [{ name: 'รายได้จริง (BL)', color: 'var(--bar1)', vals: P.map(p => p.bl_amt) }, { name: 'ประมาณการ (ยังไม่มี BL)', color: 'var(--barded)', vals: P.map(p => p.bl_amt === null ? p.est : null) }],
        line: { name: 'kWh', vals: P.map(p => p.kwh), fmt: v => nf(v / 1000, 0) + 'k' }, yfmt: mfmt, tip: i => { const p = P[i]; return `เดือนผลิต ${thML(p.pm)} · ${p.bl ? 'BL ' + p.bl + ' ' + MB(p.bl_amt) : 'ประมาณการ ' + MB(p.est)} · kWh ${p.kwh ? nf(p.kwh) : 'N/A'} · ${p.price ? nf(p.price, 4) + ' บาท/kWh' : 'ราคา N/A'}`; } })}</section>
    <section class="card"><div class="head"><div><h2>เอกสารขายแยกตามรอบเวลา</h2><p class="sub">เดือนผลิต ≠ วันที่ BL ≠ วันที่ IV ≠ งวดบัญชี · kWh อ่านจากข้อความด้วยกฎ <code>${esc(S.meta.kwh_rule)}</code> สถานะ: รอยืนยันกับมิเตอร์ · Quantity=1 ในเอกสารไม่ใช่ kWh</p></div></div>
      ${slot({ cols: salesCols, rows: S.sales, sort: 'pm', dir: 1, file: 'PSG_sales', minw: 1180, total: a => ({ amt: M.sum(a, r => r.amt), vat: M.sum(a, r => r.vat) }) })}</section>
    <section class="card"><h2>CRM และการหาลูกค้า</h2><p class="sub" style="margin-top:6px">ไม่แสดง Lead / Opportunity / Win Rate / Sales Cycle / Pipeline / ลูกค้าใหม่ — TRCloud ของ PSG ไม่มีข้อมูลเหล่านี้ และธุรกิจขายไฟฟ้าให้ลูกค้ารายเดียว (${esc(S.sales[0] ? S.sales[0].customer : '')}) ตามสัญญา ${esc((S.sales.find(s => s.contract) || {}).contract || '')} · จะเปิดเมื่อมีแหล่งข้อมูล CRM จริง</p></section>`;
  }
  function pnlTable() {
    const ms = months(), L = S.pnl.lines;
    const rows = M.LINES.map(([k, lab, sg]) => `<tr class="${sg === 0 ? 'sum' : ''}"><td>${esc(lab)}</td>${ms.map(m => `<td class="r num ${L[k][m] < 0 && sg === 0 ? 'neg' : ''}">${nf(L[k][m] / 100, 0)}</td>`).join('')}<td class="r num"><b>${nf(M.sum(ms, m => L[k][m]) / 100, 0)}</b></td></tr>`).join('');
    const gm = ms.map(m => M.pct(L.gp[m], L.rev_sales[m]));
    return `<div class="tbl-wrap"><table style="min-width:1100px"><thead><tr><th>บาท</th>${ms.map(m => `<th class="r">${thM(m)}${M.monthStatus(S, m).estRevenue ? '<br><span class="tag wait">รายได้ประมาณการ</span>' : ''}</th>`).join('')}<th class="r">รวม</th></tr></thead><tbody>${rows}
      <tr><td>อัตรากำไรขั้นต้น</td>${gm.map(v => `<td class="r num">${v === null ? NA() : nf(v, 1) + '%'}</td>`).join('')}<td class="r num">${nf(M.pct(M.sum(ms, m => L.gp[m]), M.sum(ms, m => L.rev_sales[m])), 1)}%</td></tr></tbody></table></div>`;
  }
  function pFin() {
    const ms = selMonths(), T = M.pnlSel(S, ms), ag = M.apAging(S.pay, S.meta.asof), apTot = M.sum(S.pay, p => p.amount);
    const accRows = S.pnl.accounts.map(a => ({ acc: a.acc, name: a.name, group: (S.meta.pnl_groups.find(g => g.key === a.group) || {}).label, amt: M.sum(ms, m => a.m[m] || 0) })).filter(a => a.amt);
    return `<div class="grid g4">
      ${kpi({ label: 'รายได้ขายไฟฟ้า', val: MBv(T.rev_sales)[0], unit: MBv(T.rev_sales)[1], sub: periodTxt() })}
      ${kpi({ label: 'อัตรากำไรขั้นต้น', val: M.pct(T.gp, T.rev_sales) === null ? null : nf(M.pct(T.gp, T.rev_sales), 1), unit: '%', sub: 'กำไรขั้นต้น = รายได้ขาย − ต้นทุนขายหัวบัญชี 51x (ไม่รวมค่าเสื่อมที่อยู่ในหมวด 5309)' })}
      ${kpi({ label: 'EBITDA', val: MBv(T.ebitda)[0], unit: MBv(T.ebitda)[1], sub: periodTxt() })}
      ${kpi({ label: 'กำไร(ขาดทุน)สุทธิ', val: MBv(T.np)[0], unit: MBv(T.np)[1], sub: 'ยังไม่มีรายการภาษีเงินได้ในงวด — ผลเบื้องต้น', c: T.np < 0 ? 'warn' : '' })}
    </div>
    <section class="card"><div class="head"><div><h2>Management P&L จาก Ledger (งวดบัญชี)</h2><p class="sub">รวมค้างรับ/ค้างจ่าย ปรับปรุง และกลับรายการตามธรรมชาติบัญชี · ไม่รวมบัญชีสินทรัพย์/หนี้สิน/เงินกู้/ภาษีซื้อขาย/ยอดยกมา · ${S.meta.pnl_after.length ? 'รายการเดือน ' + S.meta.pnl_after.map(thM).join(', ') + ' (ระหว่างงวด) ยังไม่แสดง' : ''}</p></div><span class="tag wait">ผลเบื้องต้น/ยังไม่ปิดบัญชี</span></div>${pnlTable()}</section>
    <section class="card"><div class="head"><div><h2>ยอดตามบัญชี (${esc(periodTxt())})</h2><p class="sub">กดค้นหา/ส่งออกได้ · ผังบัญชีหัว ${esc(S.meta.pnl_groups.map(g => g.prefixes.join('/')).join(', '))}</p></div></div>
      ${slot({ cols: [{ k: 'acc', label: 'บัญชี' }, { k: 'name', label: 'ชื่อบัญชี' }, { k: 'group', label: 'กลุ่ม P&L' }, { k: 'amt', label: 'ยอดสุทธิตามธรรมชาติบัญชี', r: 1, money: 1 }], rows: accRows, sort: 'acc', dir: 1, file: 'PSG_pnl_accounts', filters: [{ k: 'group', label: 'กลุ่ม' }] })}</section>
    <div class="grid g2">
      <section class="card"><h2>ลูกหนี้และอายุหนี้</h2><p class="sub" style="margin:6px 0 10px">รายงาน IV/CN ค้างรับ (API) คืนค่า ${S.ar_due_api} รายการ · BL ที่ยังไม่ออก IV:</p>
        ${S.ar_open.length ? S.ar_open.map(s => `<div class="mini"><div class="row"><span>${esc(s.doc)} เดือนผลิต ${thM(s.pm)} · ครบกำหนด ${thD(s.due)}</span><b>${B(s.grand)} บาท</b></div><div class="row"><span>อายุหนี้ ณ ${thD(S.meta.asof)}</span><b>${M.daysBetween(s.due, S.meta.asof) > 0 ? 'เกินกำหนด ' + M.daysBetween(s.due, S.meta.asof) + ' วัน' : 'ยังไม่ถึงกำหนด'}</b></div></div>`).join('') : '<div class="empty">ไม่มียอดค้างรับ</div>'}</section>
      <section class="card"><h2>เจ้าหนี้คงค้างตามอายุ</h2><p class="sub" style="margin:6px 0 10px">AP/EXP ที่ยังไม่จ่าย (หลังหัก WHT) ${MB(apTot)} · แยกจาก PO และ Ledger</p>
        ${M.AP_BUCKETS.map(([k, lab]) => `<button type="button" class="bar-row" ${drill(() => openTable({ title: 'เจ้าหนี้ ' + lab, cols: payCols, rows: S.pay.filter(p => M.apBucket(p, S.meta.asof) === k), sort: 'due', dir: 1, file: 'PSG_ap_' + k, total: a => ({ amount: M.sum(a, x => x.amount) }) }))}><span>${esc(lab)} (${ag[k].n})</span><span class="bar-track"><span class="bar-fill ${k === 'notdue' ? 'b2' : ''}" style="width:${apTot ? ag[k].amt / apTot * 100 : 0}%"></span></span><span class="num">${MB(ag[k].amt)}</span></button>`).join('')}</section>
    </div>
    <section class="card accent sky"><h2>เงินสดและกระแสเงินสด</h2><p class="sub" style="margin-top:6px">${NA('รอแหล่งข้อมูล')} — ยอดคงเหลือในทะเบียนธนาคารของ TRCloud เป็น 0 ทุกบัญชี (${S.banks.length} บัญชี) และ API งบดุล/กระแสเงินสดต้องใช้แพ็กเกจ Data Warehouse · ต้องการ bank statement รายเดือนเพื่อแยกเงินรับจ่ายจริง รายการไม่ใช่เงินสด และการโอนระหว่างบัญชี</p></section>`;
  }
  /* ---------- หน้าโครงการ: ClickUp (แผนงาน/สถานะ) + TRCLOUD (เงินลงทุน/ภาระจัดซื้อ) แยกฐานข้อมูล ---------- */
  const PTYPE = { investment_delivery: 'ลงทุน/ติดตั้ง/ปรับปรุง', feasibility_development: 'ศึกษา/พัฒนาธุรกิจ', regulatory_approval: 'ขออนุมัติ/สิทธิส่งเสริม', financing_workstream: 'งานจัดหาเงินทุน',
    contract_workstream: 'งานสัญญา/เจรจา', recurring_operation: 'งานประจำ/PM', corporate_governance: 'กิจการบริษัท', supporting_task: 'งานสนับสนุน/milestone', needs_review: 'รอจำแนก' };
  const PVIEW = [['all', 'ทั้งหมด', null], ['inv', 'ลงทุน/ติดตั้ง/ปรับปรุง', ['investment_delivery']], ['feas', 'ศึกษาและพัฒนาธุรกิจ', ['feasibility_development']], ['reg', 'BOI/การอนุมัติ', ['regulatory_approval']],
    ['sup', 'งานสนับสนุนเงินทุนและสัญญา', ['financing_workstream', 'contract_workstream', 'supporting_task']], ['opsg', 'งานประจำ/กิจการบริษัท', ['recurring_operation', 'corporate_governance']], ['rev', 'รอจำแนก', ['needs_review']]];
  const MAPL = { confirmed: ['เชื่อมแล้วและยืนยัน', 'fact'], proposed: ['คู่ที่เสนอให้ตรวจสอบ', 'wait'], unlinked: ['ยังไม่เชื่อม', 'none'], not_project: ['ไม่เกี่ยวข้องกับโครงการ', 'none'] };
  const CONF = { confirmed: ['ยืนยันแล้ว', 'fact'], proposed: ['ข้อเสนอ (proposed)', 'wait'], unclassified: ['ยังไม่จำแนก', 'sev'] };
  const STAT = { 'complete': 'fact', 'cancelled': 'none', 'on hold': 'wait', 'in progress': '', 'not started': 'none' };
  const thDT = iso => iso ? thD(iso) + ' ' + iso.slice(11, 16) + ' น.' : '–';
  const cuLink = (url, txt) => url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(txt || 'เปิด ClickUp')} ↗</a>` : '';
  let TR = [];
  const treeSlot = spec => { TR.push(spec); return `<div data-tree="${TR.length - 1}"></div>`; };
  function pv() { return PVIEW.find(v => v[0] === st.pv) || PVIEW[0]; }
  function pvItems(P) { const t = pv()[2]; return P.items.filter(i => !t || t.indexOf(i.type) >= 0); }
  function mountTree(el, spec) {       // ตาราง hierarchy แบบ recursive: ย่อ/ขยาย ค้นหา ส่งออก CSV
    const T = spec.T, roots = spec.roots, closed = new Set(spec.collapsed || []); let q = '';
    const kids = id => T[id].children.filter(c => T[c]);
    const match = id => !q || (T[id].name + ' ' + T[id].assignees.join(' ') + ' ' + T[id].status + ' ' + (T[id].role_label || '')).toLowerCase().indexOf(q) >= 0;
    const hit = id => match(id) || kids(id).some(hit);
    function walk(id, out) { if (!hit(id)) return; out.push(id); if (!closed.has(id) || q) kids(id).forEach(c => walk(c, out)); }
    function rows() { const o = []; roots.forEach(r => walk(r, o)); return o; }
    const csvRows = () => { const o = []; const all = id => { if (!hit(id)) return; o.push(id); kids(id).forEach(all); }; roots.forEach(all); return o; };
    function draw() {
      const a = rows();
      el.innerHTML = `<div class="tools no-print" style="margin-bottom:10px;justify-content:space-between"><div class="tools"><input type="search" placeholder="ค้นหางาน / ผู้รับผิดชอบ / สถานะ" value="${esc(q)}" aria-label="ค้นหางาน">
        <button class="btn" type="button" data-x="open">ขยายทั้งหมด</button><button class="btn" type="button" data-x="close">ย่อทั้งหมด</button></div>
        <div class="tools"><span class="note">${nf(csvRows().length)} งาน</span><button class="btn" type="button" data-x="csv">ส่งออก CSV</button></div></div>
        <div class="tbl-wrap"><table style="min-width:1180px"><thead><tr><th scope="col">งาน (ตามลำดับชั้น ClickUp)</th><th scope="col">บทบาทในโครงการ</th><th scope="col">สถานะ</th><th scope="col">ผู้รับผิดชอบ</th><th scope="col">กำหนดส่ง</th><th scope="col">อัปเดตล่าสุด</th><th scope="col">ข้อสังเกต</th><th scope="col">ต้นทาง</th></tr></thead><tbody>
        ${a.length ? a.map(id => { const t = T[id], k = kids(id), d = t.depth - spec.base;
          return `<tr class="tree d${Math.min(d, 4)}"><td><span class="tree-in" style="padding-left:${d * 22}px">${k.length ? `<button type="button" class="tgl" data-t="${esc(id)}" aria-expanded="${!closed.has(id) || !!q}" aria-label="${closed.has(id) ? 'ขยาย' : 'ย่อ'} ${esc(t.name)}">${closed.has(id) && !q ? '▸' : '▾'}</button>` : '<span class="tgl-sp"></span>'}${d === 0 ? '<b>' + esc(t.name) + '</b>' : esc(t.name)}${k.length ? ` <span class="note">(${k.length})</span>` : ''}</span></td>
            <td>${t.role_label ? esc(t.role_label) : d === 0 ? 'งานหลัก' : 'งานย่อย'}</td><td>${tag(t.status, STAT[t.status])}</td><td>${t.assignees.length ? esc(t.assignees.join(', ')) : NA('ไม่ระบุ')}</td>
            <td>${t.due ? thD(t.due) + (t.overdue ? ' ' + tag('เลยกำหนด', 'wait') : '') + (t.role === 'decision' || t.role === 'milestone' ? ' <span class="note">(ประมาณการ)</span>' : '') : NA('ไม่มีกำหนด')}</td>
            <td>${thD(t.updated)}</td><td>${t.flags.map(f => `<div class="flag">${esc(f)}</div>`).join('')}${t.desc ? `<details><summary>Note ใน ClickUp</summary><div class="note pre">${esc(t.desc)}</div></details>` : ''}</td><td>${cuLink(t.url, 'ClickUp')}</td></tr>`; }).join('') : `<tr><td colspan="8"><div class="empty">ไม่มีงานในมุมมองนี้</div></td></tr>`}</tbody></table></div>`;
      const inp = $('input[type=search]', el);
      inp.oninput = () => { q = inp.value.trim().toLowerCase(); const p = inp.selectionStart; draw(); const n = $('input[type=search]', el); n.focus(); n.setSelectionRange(p, p); };
      el.querySelectorAll('.tgl').forEach(b => b.onclick = () => { const id = b.dataset.t; closed.has(id) ? closed.delete(id) : closed.add(id); draw(); });
      el.querySelectorAll('button[data-x]').forEach(b => b.onclick = () => {
        if (b.dataset.x === 'open') { closed.clear(); draw(); }
        else if (b.dataset.x === 'close') { Object.keys(T).forEach(id => { if (kids(id).length) closed.add(id); }); draw(); }
        else exportCsv({ file: 'PSG_clickup_hierarchy', cols: [{ k: 'level', label: 'ชั้น' }, { k: 'id', label: 'Task ID' }, { k: 'parent', label: 'Parent ID' }, { k: 'name', label: 'งาน' }, { k: 'item', label: 'Project ID' }, { k: 'role', label: 'บทบาท' }, { k: 'status', label: 'สถานะ' }, { k: 'assignees', label: 'ผู้รับผิดชอบ' }, { k: 'due', label: 'กำหนดส่ง' }, { k: 'overdue', label: 'เลยกำหนด' }, { k: 'updated', label: 'อัปเดตล่าสุด' }, { k: 'flags', label: 'ข้อสังเกต' }, { k: 'url', label: 'ClickUp' }] },
          csvRows().map(id => { const t = T[id]; return { level: t.depth + 1, id: t.id, parent: t.parent || '', name: t.name, item: t.item, role: t.role_label || '', status: t.status, assignees: t.assignees.join(', '), due: t.due || '', overdue: t.overdue ? 'ใช่' : '', updated: (t.updated || '').slice(0, 10), flags: t.flags.join(' | '), url: t.url }; }));
      });
    }
    draw();
  }
  function invCols() {
    return [{ k: 'inv_id', label: 'รหัสรายการลงทุน' }, { k: 'po', label: 'PO', fmt: r => r.po ? esc(r.po) : NA('ไม่มี PO') },
      { k: 'docs', label: 'เอกสาร AP/EXP', fmt: r => r.docs.length ? esc(r.docs.join(', ')) : NA('ยังไม่บันทึก'), csv: r => r.docs.join(' ') },
      { k: 'vendors', label: 'ผู้ขาย', fmt: r => esc(r.vendors.join(', ')), csv: r => r.vendors.join(' / ') }, { k: 'desc', label: 'รายการ (บรรทัดแรก)', fmt: r => esc((r.desc || '').slice(0, 70)) },
      { k: 'accs', label: 'บัญชี', fmt: r => esc(r.accs.join(', ')), csv: r => r.accs.join(' ') },
      { k: 'budget', label: 'งบอนุมัติ', r: 1, fmt: () => NA('รอแหล่งข้อมูล'), csv: () => '' },
      { k: 'po_amt', label: 'มูลค่า PO (ภาระผูกพัน)', r: 1, fmt: r => r.po_amt == null ? NA('ไม่อยู่ในรายงาน PO') : B(r.po_amt) + (r.po_status.length ? `<br><span class="note">${esc(r.po_status.join('/'))}</span>` : ''), csv: r => r.po_amt == null ? '' : r.po_amt / 100 },
      { k: 'received', label: 'รับสินค้า/บริการ', r: 1, fmt: () => NA('รอแหล่งข้อมูล'), csv: () => '' },
      { k: 'booked_amt', label: 'บันทึกบัญชีสินทรัพย์ (ก่อน VAT)', r: 1, fmt: r => r.booked_amt == null ? NA('ยังไม่บันทึก') : B(r.booked_amt), csv: r => r.booked_amt == null ? '' : r.booked_amt / 100 },
      { k: 'paid', label: 'จ่ายจริง', r: 1, fmt: () => NA('รอแหล่งข้อมูล'), csv: () => '' },
      { k: 'map', label: 'สถานะ mapping', fmt: r => tag(MAPL[r.map][0], MAPL[r.map][1]), csv: r => MAPL[r.map][0] },
      { k: 'projects', label: 'โครงการ', fmt: r => r.projects.length ? esc(r.projects.join(', ')) : NA('–'), csv: r => r.projects.join(' ') }];
  }
  const invTot = a => ({ po_amt: M.sum(a, x => x.po_amt || 0), booked_amt: M.sum(a, x => x.booked_amt || 0) });
  function openInv(title, rows) { openTable({ title, sub: 'มูลค่า PO และยอดบันทึกบัญชีเป็นคนละฐาน — แสดงแยก ไม่บวกรวมกัน', cols: invCols(), rows, sort: 'inv_id', dir: 1, file: 'PSG_investments', minw: 1500, total: invTot }); }
  function boiPanel(P, T, it) {
    const root = T[it.roots[0]]; if (!root) return '';
    const step = t => { const isDec = t.role === 'decision', isSub = t.role === 'submission', isMs = t.role === 'milestone';
      const act = isDec ? NA('ไม่ใช่กิจกรรมของบริษัท') : tag(t.kind === 'done' ? 'ทำขั้นตอนเสร็จ' : t.kind === 'closed' ? 'ยกเลิก' : t.status, t.kind === 'done' ? 'fact' : STAT[t.status]);
      const out = t.outcome_kind === 'returned' ? tag('ถูกตีกลับ (ตาม Note)', 'wait') : isDec ? tag(t.open ? 'รอผลพิจารณา' : 'ClickUp ปิดงานแล้ว — ต้องมีเอกสารผล', 'wait') : isSub ? (t.kind === 'done' ? tag('ยังไม่มีหลักฐานผลพิจารณา', 'none') : NA('–')) : isMs ? NA('ยังไม่ถึงขั้นนี้') : NA('–');
      return `<tr><td style="padding-left:${(t.depth - root.depth - 1) * 18 + 6}px">${esc(t.name)}</td><td>${esc(t.role_label || '')}</td><td>${act}</td><td>${out}</td><td>${t.due ? thD(t.due) + (isDec || isMs ? ' <span class="note">(ประมาณการ)</span>' : '') : NA('ไม่มีกำหนด')}</td><td>${cuLink(t.url, 'ClickUp')}</td></tr>`; };
    const dfs = (id, o) => { T[id].children.forEach(c => { o.push(T[c]); dfs(c, o); }); return o; };
    return `<section class="card accent"><div class="head"><div><h2>${esc(it.name)} — ขั้นตอนและผลพิจารณา</h2><p class="sub">แยก "กิจกรรมเสร็จ" ออกจาก "ผลพิจารณาสำเร็จ" · งานที่ชื่อมีคำว่า "อนุมัติ" ไม่ใช่หลักฐานการอนุมัติ · ไม่คำนวณสิทธิประโยชน์ภาษี/รายได้จาก BOI</p></div>${tag(CONF[it.status][0], CONF[it.status][1])}</div>
      <div class="mini" style="margin-bottom:12px"><div class="row"><span>วันคาดว่าจะได้รับบัตร <b>(ประมาณการ)</b> — ${esc(it.expected_date_note || 'ตามกำหนดส่งงานหลักใน ClickUp')}</span><b>${it.due ? thD(it.due) : 'N/A'}</b></div>
      <div class="row"><span>งานถัดไปตามข้อมูล ClickUp</span><b>${it.next ? esc(it.next.name) + (it.next.due ? ' · ' + thD(it.next.due) : '') : '–'}</b></div></div>
      <div class="tbl-wrap"><table style="min-width:900px"><thead><tr><th>ขั้นตอน</th><th>บทบาท</th><th>กิจกรรม (สถานะ ClickUp)</th><th>ผลพิจารณา</th><th>กำหนด</th><th>ต้นทาง</th></tr></thead><tbody>${dfs(root.id, []).map(step).join('')}</tbody></table></div></section>`;
  }
  function pProj() {
    const P = S.projects;
    const cip = S.cip, po17 = S.po.filter(p => p.acc.startsWith('1701'));
    const fin = `<section class="card"><div class="head"><div><h2>2 · เงินลงทุนและภาระจัดซื้อจาก TRCLOUD</h2><p class="sub">ฐานบัญชี — แยกจากสถานะงาน ClickUp · ข้อมูล TRCLOUD ณ ${thD(S.meta.asof)} · การอัปเดตโครงการใน ClickUp ไม่ได้ทำให้ตัวเลขบัญชีเป็นปัจจุบันขึ้น</p></div><span class="chip">TRCLOUD ณ ${thD(S.meta.asof)}</span></div>
      <div class="grid g3">
      ${kpi({ label: 'บันทึกเข้าสินทรัพย์ระหว่างก่อสร้าง/ปรับปรุง', val: MBv(M.sum(cip, a => a.amt))[0], unit: MBv(M.sum(cip, a => a.amt))[1], sub: `AP/EXP ${cip.length} บรรทัด บัญชี 1701xxx (ก่อน VAT) · ไม่เข้า P&L` })}
      ${kpi({ label: 'PO ที่ลงบัญชีสินทรัพย์', val: nf(new Set(po17.map(p => p.doc)).size), unit: 'ใบ', sub: `มูลค่า ${MB(M.sum(po17, p => p.amt))} · เป็นภาระผูกพัน ไม่ใช่ค่าใช้จ่าย · ไม่บวกกับยอดบันทึกบัญชี` })}
      ${P ? kpi({ label: 'รายการลงทุนที่ยังไม่ระบุโครงการ', val: nf(P.investments.filter(i => i.map === 'unlinked').length), unit: `จาก ${nf(P.investments.length)} รายการ`, sub: 'รายการลงทุน = 1 PO หรือ 1 เอกสาร AP/EXP ที่ไม่มี PO · ไม่ใช่จำนวนโครงการ', c: 'warn', fn: () => openInv('รายการลงทุนที่ยังไม่ระบุโครงการ', P.investments.filter(i => i.map === 'unlinked')) }) : ''}
      </div></section>
      ${P ? `<section class="card"><div class="head"><div><h2>รายการลงทุน (ระดับ PO / เอกสาร)</h2><p class="sub">งบอนุมัติ · มูลค่า PO · รับสินค้า/บริการ · ยอดบันทึกบัญชี · เงินจ่ายจริง แยกคอลัมน์ ไม่บวกข้ามคอลัมน์ · ยอดรวมท้ายตารางรวมเฉพาะในคอลัมน์เดียวกัน · ไม่อนุมานความคืบหน้าทางกายภาพจากสัดส่วนการจ่ายเงิน</p></div></div>
        ${slot({ cols: invCols(), rows: P.investments, sort: 'inv_id', dir: 1, file: 'PSG_investments', minw: 1500, total: invTot, filters: [{ k: 'map', label: 'สถานะ mapping', get: r => MAPL[r.map][0] }, { k: 'projects', label: 'โครงการ', get: r => r.projects.join(', ') || '(ยังไม่ระบุ)' }] })}</section>` : ''}
      <section class="card"><div class="head"><div><h2>งานติดตั้ง/ปรับปรุง (Overhaul, Installation, Improvement)</h2><p class="sub">จาก AP/EXP ที่ลงบัญชี 1701xxx · ยังไม่มีงบประมาณ แผน หรือ % ความคืบหน้า → ไม่แสดงสถานะล่าช้า · จำนวนบรรทัดไม่ใช่จำนวนโครงการ</p></div></div>
      ${slot({ cols: [{ k: 'date', label: 'วันที่', fmt: r => thD(r.date) }, { k: 'doc', label: 'เอกสาร' }, { k: 'src', label: 'ที่มา' }, { k: 'vendor', label: 'ผู้ขาย' }, { k: 'acc', label: 'บัญชี' }, { k: 'name', label: 'รายการ' }, { k: 'po', label: 'PO' },
        { k: 'map', label: 'สถานะ mapping', fmt: r => r.map ? tag(MAPL[r.map][0], MAPL[r.map][1]) : NA(), csv: r => r.map ? MAPL[r.map][0] : '' }, { k: 'projects', label: 'โครงการ' }, { k: 'amt', label: 'ก่อน VAT', r: 1, money: 1 }],
        rows: cip, sort: 'date', dir: -1, file: 'PSG_cip', minw: 1250, total: a => ({ amt: M.sum(a, x => x.amt) }), filters: P ? [{ k: 'map', label: 'สถานะ mapping', get: r => r.map ? MAPL[r.map][0] : '–' }, { k: 'projects', label: 'โครงการ', get: r => r.projects || '–' }] : [] })}</section>`;
    if (!P) return `<section class="card accent warn"><h2>1 · โครงการและงานสำคัญจาก ClickUp</h2><p class="sub" style="margin-top:6px">${NA('รอแหล่งข้อมูล')} — snapshot นี้ยังไม่มีข้อมูล ClickUp (รัน scripts/build_projects.py หลังดึงข้อมูล)</p>
      <div class="grid g3" style="margin-top:12px">${kpi({ label: 'Resource Utilization', val: null, na: 'ไม่แสดง', sub: 'ไม่มีชั่วโมงทำงานจริงในระบบ' })}</div></section>` + fin;
    const T = {}; P.tasks.forEach(t => { T[t.id] = t; });
    const items = pvItems(P), ids = new Set(items.map(i => i.project_id));
    const vt = P.tasks.filter(t => ids.has(t.item)), roots = items.reduce((a, i) => a.concat(i.roots), []);
    const conf = items.filter(i => i.is_project && i.status === 'confirmed'), propProj = items.filter(i => i.is_project && i.status !== 'confirmed');
    const sc = {}; roots.forEach(r => { sc[T[r].status] = (sc[T[r].status] || 0) + 1; });
    const od = vt.filter(t => t.overdue), nd = vt.filter(t => !t.due);
    const tcols = [{ k: 'name', label: 'งาน', fmt: r => esc(r.name) }, { k: 'item', label: 'Project ID' }, { k: 'status', label: 'สถานะ', fmt: r => tag(r.status, STAT[r.status]) }, { k: 'assignees', label: 'ผู้รับผิดชอบ', fmt: r => esc(r.assignees.join(', ')) || NA('ไม่ระบุ'), csv: r => r.assignees.join(', ') },
      { k: 'due', label: 'กำหนดส่ง', fmt: r => thD(r.due) }, { k: 'updated', label: 'อัปเดตล่าสุด', fmt: r => thD(r.updated) }, { k: 'url', label: 'ClickUp', fmt: r => cuLink(r.url, 'ClickUp'), csv: r => r.url }];
    const tabs = `<div class="seg2" role="tablist" aria-label="มุมมองโครงการ">${PVIEW.map(([k, l, ty]) => { const n = P.items.filter(i => !ty || ty.indexOf(i.type) >= 0).length; return `<button type="button" role="tab" aria-selected="${pv()[0] === k}" ${drill(() => { st.pv = k; render(false); })}>${l} <span class="note">${n}</span></button>`; }).join('')}</div>`;
    const reg = slot({ cols: [
      { k: 'name', label: 'รายการ', fmt: r => `<b>${esc(r.name)}</b>${r.parent_project ? `<br><span class="note">ภายใต้ ${esc(r.parent_project)}</span>` : ''}`, csv: r => r.name },
      { k: 'project_id', label: 'Project ID' }, { k: 'type', label: 'ประเภท', fmt: r => esc(PTYPE[r.type] || r.type) + (r.is_project ? '' : '<br><span class="note">ไม่นับเป็นโครงการ</span>'), csv: r => PTYPE[r.type] || r.type },
      { k: 'stage', label: 'ขั้นดำเนินงาน' }, { k: 'owner', label: 'ผู้รับผิดชอบ (ClickUp)', fmt: r => r.owner ? esc(r.owner) : NA('ไม่ระบุ') },
      { k: 'main_status', label: 'สถานะงานหลัก', fmt: r => r.main_status ? tag(r.main_status, STAT[r.main_status]) : NA('ไม่มีงานใน ClickUp') },
      { k: 'due', label: 'กำหนดส่ง', fmt: r => r.due ? thD(r.due) + (r.type === 'regulatory_approval' ? ' <span class="note">(ประมาณการ)</span>' : '') : NA('ไม่มีกำหนด'), sortv: r => r.due || '9' },
      { k: 'updated', label: 'อัปเดตล่าสุด', fmt: r => thD(r.updated), sortv: r => r.updated || '' },
      { k: 'sub', label: 'งานย่อยเสร็จ', r: 1, fmt: r => r.sub.pct === null ? NA('N/A — ไม่มีงานย่อย') : `${r.sub.done}/${r.sub.leaves - r.sub.cancelled} <span class="note">(${nf(r.sub.pct, 0)}%)</span>`, csv: r => r.sub.pct === null ? 'N/A' : r.sub.done + '/' + (r.sub.leaves - r.sub.cancelled), sortv: r => r.sub.pct === null ? -1 : r.sub.pct },
      { k: 'physical', label: 'Physical Progress', r: 1, fmt: r => r.physical ? nf(r.physical.pct, 0) + '% <span class="note">' + esc(r.physical.confirmed_by) + '</span>' : NA('ยังไม่มีผู้ยืนยัน'), csv: r => r.physical ? r.physical.pct : 'N/A' },
      { k: 'next', label: 'งานถัดไป', fmt: r => r.next ? esc(r.next.name) + (r.next.due ? `<br><span class="note">${thD(r.next.due)}</span>` : '') : NA('–'), csv: r => r.next ? r.next.name : '' },
      { k: 'fin', label: 'TRCLOUD ที่เชื่อม', fmt: r => r.fin.confirmed_n ? `${r.fin.confirmed_n} รายการ · ${MB(r.fin.confirmed_booked)}` : r.fin.proposed_n ? tag(r.fin.proposed_n + ' คู่รอตรวจ', 'wait') : NA('ยังไม่มี'), csv: r => r.fin.confirmed_n },
      { k: 'status', label: 'การยืนยัน', fmt: r => tag(CONF[r.status][0], CONF[r.status][1]) + (r.confirmed_by ? `<br><span class="note">${esc(r.confirmed_by)} ${esc(r.confirmed_at)}</span>` : ''), csv: r => CONF[r.status][0] },
      { k: 'reason', label: 'เหตุผลการจัดประเภท', fmt: r => `<details><summary>ดู</summary><div class="note">${esc(r.reason || '')}${(r.evidence || []).map(e => '<br>• ' + esc(e)).join('')}</div></details>`, csv: r => r.reason + ' | ' + (r.evidence || []).join(' | ') },
      { k: 'url', label: 'ต้นทาง', fmt: r => r.url ? cuLink(r.url, 'ClickUp') : r.roots.length ? r.roots.map(x => cuLink(T[x].url, T[x].name.slice(0, 18))).join('<br>') : NA('–'), csv: r => r.roots.map(x => T[x].url).join(' ') }],
      rows: items, sort: 'type', dir: 1, size: 15, file: 'PSG_project_register', minw: 1900, empty: 'ไม่มีรายการในมุมมองนี้' });
    const insHtml = P.insights.filter(i => !i.tasks.length || i.tasks.some(t => !T[t.id] || ids.has(T[t.id].item)) || st.pv === 'all').map(i => {
      const tl = i.tasks.filter(t => st.pv === 'all' || ids.has(T[t.id].item));
      const extra = i.kind === 'inv_unlinked' ? `<button class="link" type="button" ${drill(() => openInv('รายการลงทุนที่ยังไม่ระบุโครงการ', P.investments.filter(x => x.map === 'unlinked')))}>ดูรายการ →</button>`
        : i.kind === 'project_no_fin' ? `<div class="note">${i.items.map(x => esc((P.items.find(y => y.project_id === x) || {}).name || x)).join(' · ')}</div>` : '';
      return `<div class="insight ${/overdue|stale|unlinked|mismatch|done_child|parent_open/.test(i.kind) ? 'warn' : ''}"><h3>${esc(i.text)}</h3>${tl.length ? `<div class="note">${tl.map(t => cuLink(t.url, t.name)).join(' · ')}</div>` : ''}${extra}</div>`; }).join('');
    const boi = items.filter(i => i.type === 'regulatory_approval' && i.roots.length).map(i => boiPanel(P, T, i)).join('');
    const maps = ['confirmed', 'proposed', 'unlinked', 'not_project'].map(k => [k, P.investments.filter(i => i.map === k)]);
    return `<div class="note-bar cols"><span><b>ClickUp</b> (แผนงาน/สถานะ) ดึงเมื่อ ${thDT(P.meta.fetched_at)} · ${esc(P.meta.tz || '')}</span><span><b>TRCLOUD</b> (บัญชี/จัดซื้อ) ข้อมูล ณ ${thD(S.meta.asof)}</span><span>ทะเบียนโครงการ ${esc(P.meta.registry_version || '–')}</span></div>
    <section class="card"><div class="head"><div><h2>1 · โครงการและงานสำคัญจาก ClickUp</h2><p class="sub">Task / List ใน ClickUp ไม่ใช่โครงการโดยอัตโนมัติ — จัดประเภทผ่านทะเบียนโครงการ · การจัดประเภทที่ยังไม่มีผู้ยืนยันแสดงเป็น "ข้อเสนอ" · เกินกำหนดคำนวณ ณ ${thD(P.meta.today)} ตามเวลาผู้ใช้ ClickUp</p></div><span class="chip">ClickUp ณ ${thDT(P.meta.fetched_at)}</span></div>
      ${tabs}
      <div class="grid g5" style="margin-top:14px">
      ${kpi({ label: 'โครงการที่ยืนยันแล้ว', val: nf(conf.length), unit: 'โครงการ', sub: `ข้อเสนอประเภทโครงการ ${propProj.length} รายการ รอผู้รับผิดชอบยืนยัน · ไม่นับงานประจำ/ประชุม/ปันผล` })}
      ${kpi({ label: 'รายการ proposed / รอจำแนก', val: nf(items.filter(i => i.status !== 'confirmed').length), unit: 'รายการ', sub: `รอจำแนก ${items.filter(i => i.type === 'needs_review').length} · ทะเบียนทั้งหมดในมุมมองนี้ ${items.length}`, c: 'warn' })}
      ${kpi({ label: 'สถานะงานหลัก', val: nf(roots.length), unit: 'งานหลัก', sub: Object.entries(sc).map(([k, v]) => `${k} ${v}`).join(' · ') || '–' })}
      ${kpi({ label: 'งานเกินกำหนดตามข้อมูล', val: nf(od.length), unit: 'งาน', sub: `ยังไม่ complete/cancelled และกำหนดส่งก่อน ${thD(P.meta.today)}`, c: od.length ? 'warn' : '', fn: od.length ? () => openTable({ title: 'งานที่เลยกำหนดส่งตามข้อมูล ClickUp', sub: 'ไม่ใช่การประเมินผู้รับผิดชอบ — อาจเป็นกำหนดที่ไม่ได้อัปเดต', cols: tcols, rows: od, sort: 'due', dir: 1, file: 'PSG_clickup_overdue' }) : null })}
      ${kpi({ label: 'งานไม่มีกำหนดส่ง', val: nf(nd.length), unit: 'งาน', sub: `ยังเปิดอยู่ ${nd.filter(t => t.open).length} · รวมงานหลักและงานย่อย`, fn: nd.length ? () => openTable({ title: 'งานที่ไม่มีกำหนดส่ง', cols: tcols, rows: nd, sort: 'item', dir: 1, file: 'PSG_clickup_nodue' }) : null })}
      </div></section>
    ${boi}
    <section class="card"><div class="head"><div><h2>ทะเบียนโครงการและงานสำคัญ — ${esc(pv()[1])}</h2><p class="sub">"งานย่อยเสร็จ" นับเฉพาะงานย่อยระดับล่างสุด (ไม่บวกงานแม่+งานลูกซ้ำ) · cancelled ไม่นับเป็นเสร็จ · ไม่มีงานย่อย = N/A · ไม่ใช่ Physical Progress</p></div></div>${reg}</section>
    <section class="card"><div class="head"><div><h2>ลำดับชั้นงานจาก ClickUp</h2><p class="sub">รักษา parent–child ทุกระดับตามต้นทาง · วันที่เป็นวันตามเขตเวลา ${esc(P.meta.tz || '')} · งาน "อนุมัติ"/"ผลพิจารณา" แสดงกำหนดเป็นประมาณการ</p></div></div>
      ${treeSlot({ T, roots, base: 0 })}${P.meta.empty_lists.length ? `<p class="note" style="margin-top:8px">List ที่ยังไม่มีงาน: ${P.meta.empty_lists.map(l => esc(l.name)).join(', ')}</p>` : ''}</section>
    <section class="card"><div class="head"><div><h2>ข้อสังเกตจากข้อมูล</h2><p class="sub">ทุกข้อมีลิงก์ต้นทาง · ไม่สร้างคะแนนความเสี่ยง · วันที่อัปเดตไม่ใช่ตัวชี้วัดผลงานของผู้รับผิดชอบ</p></div></div><div class="grid g2">${insHtml || '<div class="empty">ไม่มีข้อสังเกต</div>'}</div></section>
    ${fin}
    <section class="card"><div class="head"><div><h2>3 · รายการที่เชื่อมกันแล้วและยังไม่ยืนยัน</h2><p class="sub">ClickUp กับ TRCLOUD มี grain ต่างกัน (หลายต่อหลาย) · ไม่จับคู่จากชื่อ ผู้ขาย หรือยอดใกล้กันอย่างเดียว · คู่ที่ยืนยันต้องมีเหตุผล ผู้ยืนยัน และวันที่ (intake/project_links.json)</p></div></div>
      <div class="grid g4">${maps.map(([k, a]) => `<button type="button" class="card kpi ${k === 'unlinked' ? 'accent warn' : 'accent'}" ${drill(() => openInv(MAPL[k][0], a))}><span class="lab">${esc(MAPL[k][0])}</span><span class="val">${nf(a.length)} <small>รายการ</small></span><span class="full">PO ${MB(M.sum(a, x => x.po_amt || 0))} · บันทึกบัญชี ${MB(M.sum(a, x => x.booked_amt || 0))} (แสดงแยก)</span><span class="more">ดูรายการ →</span></button>`).join('')}</div>
      <p class="note" style="margin-top:10px">${maps[0][1].length + maps[1][1].length ? '' : 'ยังไม่มีคู่ที่ยืนยันหรือเสนอ — ข้อมูล ClickUp ปัจจุบันไม่มีงานที่ระบุ PO/เอกสาร/เครื่องจักรที่ตรงกับรายการลงทุน 1701xxx จึงยังไม่เสนอคู่ใด ๆ · '}รายการที่ยังไม่เชื่อมยังแสดงครบในตารางรายการลงทุนด้านบน ไม่ถูกซ่อน</p></section>`;
  }
  function pStrat() {
    const ea = M.estAccuracy(S), ms = months(), L = S.pnl.lines, rev = M.sum(ms, m => L.rev_sales[m]);
    const cat = {}; S.mat_lines.filter(x => ms.indexOf(x.ym) >= 0).forEach(x => { cat[x.cat] = (cat[x.cat] || 0) + x.net; });
    const comp = [['ต้นทุนดำเนินการ (5101000)', M.sum(ms, m => (S.pnl.accounts.find(a => a.acc === '5101000') || { m: {} }).m[m] || 0)], ['ซ่อมบำรุงและอะไหล่', M.sum(S.maint_ledger.filter(x => ms.indexOf(x.ym) >= 0 && x.acc.startsWith('51')), x => x.net)],
      ['ค่าเสื่อมราคา', M.sum(ms, m => L.dep[m])], ['ค่าใช้จ่ายบริหาร', M.sum(ms, m => L.admin[m])], ['ดอกเบี้ยจ่าย', M.sum(ms, m => L.int[m])]];
    return `<div class="grid g4">
      ${kpi({ label: 'สัดส่วนรายได้จากลูกค้ารายใหญ่สุด', val: '100', unit: '%', sub: `ลูกค้ารายเดียว ${esc(S.sales[0] ? S.sales[0].customer : '')} ตามสัญญา ${esc((S.sales.find(s => s.contract) || {}).contract || '')}` })}
      ${kpi({ label: 'ความคลาดเคลื่อนประมาณการรายได้', val: ea ? nf(ea.mape, 1) : null, unit: '%', sub: ea ? `เฉลี่ยค่าสัมบูรณ์ ${ea.n} เดือนผลิต` : '' })}
      ${kpi({ label: 'Customer Lifetime Value', val: null, na: 'ไม่เหมาะกับ PSG', sub: 'ลูกค้ารายเดียวตามสัญญาซื้อขายไฟฟ้า — ไม่มีนิยาม CLV ที่ใช้ได้' })}
      ${kpi({ label: 'เทียบปีก่อน (YoY)', val: null, na: 'รอแหล่งข้อมูล', sub: 'Ledger ในระบบเริ่ม ม.ค. 2569' })}
    </div>
    <section class="card"><div class="head"><div><h2>โครงสร้างต้นทุนเทียบรายได้ขาย</h2><p class="sub">ม.ค.–${thM(ms[ms.length - 1])} · Ledger ผลเบื้องต้น · รายได้ ${MB(rev)}</p></div></div>
      ${comp.map(([lab, v]) => `<div class="bar-row"><span>${esc(lab)}</span><span class="bar-track"><span class="bar-fill" style="width:${Math.min(100, Math.max(0, v / rev * 100))}%"></span></span><span class="num">${nf(v / rev * 100, 1)}% · ${MB(v)}</span></div>`).join('')}
      <p class="note" style="margin-top:8px">ซ่อมบำรุงในแถวนี้เป็นส่วนหนึ่งของบัญชี 51x และค่าเสื่อม/บริหารเป็นหมวด 530 — แต่ละแถวไม่ซ้อนกัน ยกเว้นแถวแรกกับแถวซ่อมบำรุงที่แยกบัญชีกันชัดเจน</p></section>`;
  }
  function pOps() {
    const subs = [['prod', 'การผลิต'], ['mat', 'วัตถุดิบและต้นทุนผลิต'], ['maint', 'ซ่อมบำรุง']];
    const nav = `<div class="seg2" role="tablist">${subs.map(([k, l]) => `<button type="button" role="tab" aria-selected="${st.sub === k}" ${drill(() => { st.sub = k; render(true); })}>${l}</button>`).join('')}</div>`;
    return nav + (st.sub === 'mat' ? opsMat() : st.sub === 'maint' ? opsMaint() : opsProd());
  }
  function opsProd() {
    const P = S.prod.filter(p => p.pm >= '2026-01');
    return `<div class="grid g3">
      ${kpi({ label: 'kWh ผลิต (Generation)', val: null, na: 'รอแหล่งข้อมูล', sub: 'ยังไม่มีข้อมูลมิเตอร์ผลิต/ใช้ภายใน/ส่งออกรายวัน' })}
      ${kpi({ label: 'ชั่วโมงเดินเครื่อง / Availability', val: null, na: 'รอแหล่งข้อมูล', sub: 'ไม่ใช้สถานะในใบงานสรุป downtime (ข้อความขัดกับสถานะ)' })}
      ${kpi({ label: 'kWh ขาย (ตาม BL)', val: nf(M.sum(P.filter(p => p.kwh), p => p.kwh)), unit: 'kWh', sub: 'ก.พ.–ก.ย. 2569 · เป็นหน่วยขาย ไม่ใช่หน่วยผลิต' })}
    </div>
    <section class="card"><h2>หน่วยขายรายเดือน (ฐานเดือนผลิต)</h2>${chart({ title: 'kWh ขายรายเดือน', labels: P.map(p => thM(p.pm)), bars: [{ name: 'kWh ขาย', color: 'var(--bar1)', vals: P.map(p => p.kwh === null ? null : p.kwh * 100) }], yfmt: v => nf(v / 100 / 1000, 0) + 'k', tip: i => `${thML(P[i].pm)} · ${P[i].kwh ? nf(P[i].kwh) + ' kWh' : 'N/A — ไม่มีหน่วยในข้อความ BL'}` })}
      <p class="note">ไม่ใช้กำลังรับซื้อสูงสุดตามสัญญาเป็นเป้ารายวัน · ยังไม่มีเป้าที่อนุมัติ จึงไม่แสดง % เทียบเป้า</p></section>`;
  }
  function opsMat() {
    const ms = months(), cats = S.mat_cats, by = {};
    S.mat_lines.forEach(x => { by[x.cat] = by[x.cat] || {}; by[x.cat][x.ym] = (by[x.cat][x.ym] || 0) + x.net; });
    const rows = cats.filter(c => by[c.key]).map(c => `<tr><td>${esc(c.label)}</td>${ms.map(m => `<td class="r num">${by[c.key][m] ? nf(by[c.key][m] / 100, 0) : '–'}</td>`).join('')}<td class="r num"><b>${nf(M.sum(ms, m => by[c.key][m] || 0) / 100, 0)}</b></td></tr>`).join('');
    const om = S.om_check;
    return `<section class="card"><div class="head"><div><h2>ต้นทุนดำเนินการผลิต บัญชี 5101000 แยกตามหมวด (บาท)</h2><p class="sub">จัดหมวดจากข้อความในบัญชีตามกฎใน config/mapping.json — สถานะ: <b>ต้องยืนยัน</b> · รวมประมาณการ/กลับรายการตามงวดบัญชี</p></div></div>
      <div class="tbl-wrap"><table style="min-width:1100px"><thead><tr><th>หมวด</th>${ms.map(m => `<th class="r">${thM(m)}</th>`).join('')}<th class="r">รวม</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="cols" style="margin-top:10px"><button class="btn" type="button" ${drill(() => openTable({ title: 'รายการบัญชี 5101000', cols: [{ k: 'date', label: 'วันที่', fmt: r => thD(r.date) }, { k: 'ref', label: 'เอกสาร' }, { k: 'cat', label: 'หมวด', fmt: r => esc((cats.find(c => c.key === r.cat) || {}).label), csv: r => r.cat }, { k: 'kind', label: 'ลักษณะ', fmt: r => ({ est: tag('ประมาณการ', 'wait'), rev: tag('กลับรายการ', 'wait'), act: tag('รายการจริง', 'fact') }[r.kind]), csv: r => r.kind }, { k: 'note', label: 'คำอธิบาย' }, { k: 'net', label: 'สุทธิ', r: 1, money: 1 }], rows: S.mat_lines, sort: 'date', dir: 1, file: 'PSG_5101000', filters: [{ k: 'cat', label: 'หมวด', get: r => (cats.find(c => c.key === r.cat) || {}).label }], total: a => ({ net: M.sum(a, x => x.net) }) }))}>ดูรายการทั้งหมด</button></div></section>
    <div class="grid g2">
      <section class="card"><h2>ค่าจ้างควบคุมและบำรุงรักษาระบบ (O&M)</h2><p class="sub" style="margin-top:6px">ตรวจจากข้อความใน Ledger (ไม่กำหนดยอดตายตัวในโค้ด): พบใน ${om.months.length} เดือน (${om.months.map(thM).join(', ')}) · ยอดที่พบ ${om.amounts.map(a => B(a)).join(', ')} บาท/เดือน</p></section>
      <section class="card accent warn"><h2>Material Master — ยังไม่พร้อมคำนวณต่อหน่วย</h2><ul class="note" style="margin:6px 0 0;padding-left:18px"><li>ยังไม่มีปริมาณรับ/ใช้/คงเหลือที่ยืนยันหน่วย → ไม่คำนวณราคาต่อตัน หรือวัตถุดิบต่อ kWh</li><li>OM ต้องยืนยันว่า “สลัดเค้ก/ขี้เค้ก” คือ MIXCAKE หรือไม่</li><li>ยังไม่ถือว่ามีการซื้อผลปาล์มโดยตรง</li><li>GAS MIXER อยู่ในบัญชีซ่อมบำรุง ไม่ถูกจัดเป็นวัตถุดิบ</li><li>ไม่ใช้ปริมาณซื้อแทนการใช้จริง</li></ul></section>
    </div>`;
  }
  function opsMaint() {
    if (!S.maint) return '<div class="state">ยังไม่ได้นำเข้าไฟล์ใบงาน — รัน scripts/import_maintenance.py</div>';
    const R = S.maint.rows, w = M.woStats(R, S.meta.asof), src = S.maint.source, ms = months();
    const byM = M.countBy(R, r => r.machine).slice(0, 10), byS = M.countBy(R, r => r.status), mx = byM.length ? byM[0][1] : 1;
    const ml = S.maint_ledger, macc = Object.keys(S.maint_acc);
    const lk = S.wo_links, mtot = M.sum(ml.filter(x => ms.indexOf(x.ym) >= 0), x => x.net);
    return `<div class="grid g4">
      ${kpi({ label: 'ใบงานทั้งหมด', val: nf(w.total), unit: 'ใบ', sub: `${nf(w.qr)} QR Code (ไม่จำเป็นต้องเป็นเครื่องจักร ${w.qr} เครื่อง — ต้องมี parent asset mapping)` })}
      ${kpi({ label: 'ใบงานค้าง', val: nf(w.open), unit: 'ใบ', sub: `ปิดงาน/รอประเมิน ${w.done} · ถูกปฏิเสธ ${w.rejected}`, c: 'warn', fn: () => openTable({ title: 'ใบงานค้าง', cols: woCols, rows: R.filter(r => r.state === 'open'), sort: 'reported', dir: 1, file: 'PSG_wo_open' }) })}
      ${kpi({ label: 'ส่งซ่อมภายนอก', val: nf(w.external), unit: 'ใบ', sub: 'จากรหัส/วิธีแก้ที่ระบุส่งซ่อม' })}
      ${kpi({ label: 'ค่าซ่อมบำรุงตามบัญชี', val: MBv(mtot)[0], unit: MBv(mtot)[1], sub: `ม.ค.–${thM(ms[ms.length - 1])} (YTD งวดบัญชี) · อยู่ใน P&L แล้ว (ไม่บวกซ้ำ)`, c: 'navy', fn: () => openTable({ title: 'รายการบัญชีซ่อมบำรุง', sub: 'มุมมองเจาะดู — ยอดนี้อยู่ใน P&L แล้ว ไม่บวกซ้ำ', cols: ledgerCols, rows: S.maint_ledger, sort: 'date', dir: 1, file: 'PSG_maint_ledger', total: a => ({ net: M.sum(a, x => x.net) }) }) })}
    </div>
    <div class="grid g2">
      <section class="card"><h2>ใบงานตามเครื่องจักร (10 อันดับ)</h2><p class="sub" style="margin-bottom:8px">นับใบงาน ไม่ใช่จำนวนครั้งที่เสีย — เช่นเครื่องเดียวอาจมีหลายใบสำหรับงานต่อเนื่อง</p>
        ${byM.map(([k, n]) => `<button type="button" class="bar-row" ${drill(() => openTable({ title: 'ใบงาน: ' + k, cols: woCols, rows: R.filter(r => r.machine === k), sort: 'reported', dir: 1, file: 'PSG_wo_machine' }))}><span>${esc(k)}</span><span class="bar-track"><span class="bar-fill" style="width:${n / mx * 100}%"></span></span><span class="num">${n} ใบ</span></button>`).join('')}</section>
      <section class="card"><h2>สถานะและอายุงานค้าง</h2>
        <div class="mini">${byS.map(([k, n]) => `<div class="row"><span>${esc(k)}</span><b>${n}</b></div>`).join('')}</div>
        <h3 style="margin-top:12px">อายุงานค้าง ณ ${thD(S.meta.asof)}</h3><div class="mini">${M.AGE.map(([k, l]) => `<div class="row"><span>${l}</span><b>${w.age[k]}</b></div>`).join('')}</div>
        <p class="note" style="margin-top:8px">ระยะเริ่ม–เสร็จไม่ใช่ชั่วโมงแรงงาน · SLA ต้องยืนยันกฎเวลาและจุดวัดก่อนใช้เป็น KPI${w.slaN ? ` (ตามข้อความ SLA: ทันกำหนด ${w.slaMet}/${w.slaN} ใบ — ข้อมูลอ้างอิง ไม่ใช่ KPI ยืนยัน)` : ''}</p></section>
    </div>
    <section class="card accent warn"><div class="head"><div><h2>ข้อสังเกตคุณภาพข้อมูลใบงาน</h2><p class="sub">${esc(src.note)} · ไฟล์ ${esc(src.file)} (นำเข้า ${esc(src.imported_at.slice(0, 16).replace('T', ' '))})</p></div></div>
      <div class="mini">${w.flags.map(([k, n]) => `<button type="button" class="row link-row" ${drill(() => openTable({ title: M.FLAG[k], cols: woCols, rows: R.filter(r => r.flags.indexOf(k) >= 0), sort: 'reported', dir: 1, file: 'PSG_wo_' + k }))}><span>${esc(M.FLAG[k])}</span><b>${n} ใบ</b></button>`).join('')}
      <div class="row"><span>มีวันที่คาดว่าจะเสร็จ</span><b>${R.filter(r => r.expected).length} ใบ</b></div></div></section>
    <section class="card"><div class="head"><div><h2>ค่าซ่อมบำรุงตามบัญชี (${esc(macc.join(', '))})</h2><p class="sub">มุมมองเจาะดูบัญชีที่อยู่ใน P&L แล้ว — ไม่บวกซ้ำ · แยกประมาณการ/รายการจริง/ปรับปรุง</p></div></div>
      ${chart({ title: 'ค่าซ่อมบำรุงรายเดือน', stacked: true, labels: ms.map(thM), bars: [['est', 'ประมาณการ', 'var(--barded)'], ['act', 'รายการจริง', 'var(--bar1)'], ['reclass', 'ปรับปรุง/โอน', 'var(--bar3)']].map(([k, n, c]) => ({ name: n, color: c, vals: ms.map(m => M.sum(ml.filter(x => x.ym === m && x.kind === k), x => x.net)) })),
        yfmt: v => nf(v / 1e8, 2), tip: i => { const m = ms[i]; return `${thML(m)} · สุทธิ ${MB(M.sum(ml.filter(x => x.ym === m), x => x.net))} (รวมรายการปรับปรุงที่เป็นยอดติดลบ)`; } })}
      ${slot({ cols: ledgerCols, rows: ml, sort: 'date', dir: -1, file: 'PSG_maint_ledger', filters: [{ k: 'acc', label: 'บัญชี' }], total: a => ({ net: M.sum(a, x => x.net) }) })}</section>
    <section class="card"><div class="head"><div><h2>ตารางเชื่อมใบงาน → PR → PO → AP/EXP</h2><p class="sub">ไฟล์ใบงานไม่มีเลข PR/PO · ระบบเสนอเฉพาะคู่ที่เอกสารจัดซื้ออ้างเลขใบงานตรงตัว · ห้ามยืนยันจากชื่อหรือยอดใกล้กัน · ต้องมีผู้ยืนยันใน config/wo_po_links.json</p></div></div>
      ${slot({ cols: [{ k: 'wo', label: 'ใบงาน' }, { k: 'pr', label: 'PR' }, { k: 'po', label: 'PO' }, { k: 'ap', label: 'AP/EXP' }, { k: 'share', label: 'สัดส่วนต้นทุน' }, { k: 'basis', label: 'หลักฐาน' }, { k: 'status', label: 'สถานะ' }, { k: 'by', label: 'ผู้ยืนยัน' }], rows: lk.confirmed.concat(lk.suggested), empty: 'ยังไม่มีคู่ที่เชื่อมได้จากหลักฐานตรง — รอ OM/จัดซื้อระบุเลขใบงานใน PR/PO หรือกรอกตารางเชื่อม', file: 'PSG_wo_po' })}</section>`;
  }
  function pData() {
    const ds = S.datasets, ok = ds.filter(d => d.ok).length, led = ds.filter(d => d.tool === 'get_ledger');
    const R = [['รายได้ขายไฟฟ้า / P&L รายเดือน (Ledger)', 'ใช้ได้แล้ว', 'ผลเบื้องต้น — ไม่มีสถานะปิดบัญชี'], ['kWh ขาย และราคาเฉลี่ย', 'ต้องยืนยัน', 'อ่านจากข้อความ BL; ม.ค. 69 และก่อนหน้าไม่มีหน่วย'], ['ต้นทุนขาย/kWh', 'ต้องยืนยัน', 'ต้นทุนงวดบัญชี ÷ kWh เดือนผลิตเดียวกัน'],
      ['อัตรากำไรขั้นต้น / EBITDA', 'ใช้ได้แล้ว', 'นิยามตามหัวบัญชี 51x/530 — บัญชีต้องยืนยันการจัดกลุ่ม'], ['อายุเจ้าหนี้', 'ใช้ได้แล้ว', 'จากรายงาน AP/EXP ค้างจ่าย; รายการยกมาต้องยืนยันสถานะ'], ['ลูกหนี้และอายุหนี้', 'ใช้ได้แล้ว', 'BL ที่ยังไม่ออก IV + รายงานค้างรับ'],
      ['การรับชำระ (วันเงินเข้า)', 'ต้องยืนยัน', 'ใช้วันที่ IV สถานะ Cash แทนวันเงินเข้า'], ['เงินสด / Cash Flow', 'รอแหล่งข้อมูล', 'ต้องมี bank statement หรือแพ็กเกจ Data Warehouse'], ['kWh ผลิต / ชั่วโมงเดิน / Availability', 'รอแหล่งข้อมูล', 'ต้องมีข้อมูลมิเตอร์และบันทึกเดินเครื่อง'],
      ['ต้นทุนวัตถุดิบต่อหน่วย / ต่อ kWh', 'รอแหล่งข้อมูล', 'ต้องมี Material Master และปริมาณรับ/ใช้'], ['หมวดต้นทุน 5101000', 'ต้องยืนยัน', 'จัดหมวดจากข้อความ'], ['ใบงานค้าง/อายุงาน/ใบงานตามเครื่อง', 'ใช้ได้แล้ว', 'snapshot จากระบบแจ้งซ่อม'],
      ['MTBF / MTTR / PM Compliance', 'รอแหล่งข้อมูล', 'ต้องมีชั่วโมงเดิน เหตุเสียยืนยัน แผน PM'], ['SLA ซ่อม', 'ต้องยืนยัน', 'ต้องยืนยันกฎเวลาและจุดวัด'], ['ค่าซ่อมต่อใบงาน/เครื่องจักร', 'รอแหล่งข้อมูล', 'ต้องมีตารางเชื่อมใบงาน–PO ที่ยืนยัน'],
      ['โครงการ: สถานะ/กำหนดส่ง/งานย่อยเสร็จ (ClickUp)', 'ต้องยืนยัน', 'ดึงจาก ClickUp แล้ว · การจัดประเภทโครงการยังเป็นข้อเสนอ รอผู้รับผิดชอบยืนยัน'], ['โครงการ: งบอนุมัติ', 'รอแหล่งข้อมูล', 'ยังไม่มีเอกสารงบลงทุนที่อนุมัติ'], ['โครงการ: ต้นทุนที่เชื่อมโครงการ', 'ต้องยืนยัน', 'มียอดบันทึกสินทรัพย์ 1701xxx แต่ยังไม่มีคู่ mapping ที่ยืนยัน'], ['โครงการ: Physical Progress', 'รอแหล่งข้อมูล', 'ต้องมาจากผู้ควบคุมงาน ไม่ใช้สัดส่วนงานย่อยแทน'], ['Resource Utilization', 'ไม่เหมาะกับ PSG', 'ไม่มีชั่วโมงทำงานจริง และ ClickUp ไม่มี Time Estimate/Time Spent'], ['CRM (Lead/Pipeline/Win Rate)', 'ไม่เหมาะกับ PSG', 'ลูกค้ารายเดียวตามสัญญา VSPP'], ['CLV', 'ไม่เหมาะกับ PSG', 'ไม่มีนิยามที่ใช้ได้'], ['เทียบปีก่อน (YoY)', 'รอแหล่งข้อมูล', 'Ledger เริ่มปี 2569']];
    const cls = s => ({ 'ใช้ได้แล้ว': 'fact', 'ต้องยืนยัน': 'wait', 'รอแหล่งข้อมูล': 'none', 'ไม่เหมาะกับ PSG': 'none' }[s]);
    return `<div class="grid g4">
      ${kpi({ label: 'ชุดข้อมูลที่ดึงสำเร็จ', val: nf(ok), unit: `/ ${ds.length}`, sub: 'TRCloud MCP ของ PSG แบบอ่านอย่างเดียว' })}
      ${kpi({ label: 'บัญชีแยกประเภทที่ดึง', val: nf(new Set(led.map(d => d.params.acc_code)).size), unit: 'บัญชี', sub: `${nf(led.reduce((s, d) => s + (d.rows || 0), 0))} บรรทัด · ม.ค.–พ.ย. 2569` })}
      ${kpi({ label: 'ข้อมูล ณ วันที่', val: thD(S.meta.asof), sub: `สร้าง snapshot ${esc(S.meta.built.slice(0, 16).replace('T', ' '))} น.` })}
      ${kpi({ label: 'Mapping version', val: S.meta.mapping_version, sub: 'config/mapping.json' })}
    </div>
    <section class="card"><h2>ผลตรวจความถูกต้อง</h2><div class="mini" style="margin-top:8px">${S.checks.concat(S.projects ? S.projects.checks.map(c => ({ level: c.level, msg: 'ClickUp/โครงการ: ' + c.msg })) : []).map(c => `<div class="row"><span>${esc(c.msg)}</span><b>${c.level === 'pass' ? tag('ผ่าน', 'fact') : c.level === 'warn' ? tag('ข้อจำกัด', 'wait') : tag('ไม่ผ่าน', 'bad')}</b></div>`).join('')}</div></section>
    <section class="card"><h2>ความพร้อมของ KPI</h2>${slot({ cols: [{ k: 0, label: 'KPI' }, { k: 1, label: 'สถานะ', fmt: r => tag(r[1], cls(r[1])) }, { k: 2, label: 'หมายเหตุ' }], rows: R, size: 25, file: 'PSG_kpi_readiness', filters: [{ k: 1, label: 'สถานะ' }] })}</section>
    <section class="card"><h2>ชุดข้อมูลต้นทาง</h2>${slot({ cols: [{ k: 'tool', label: 'เครื่องมือ' }, { k: 'params', label: 'พารามิเตอร์', fmt: r => esc(JSON.stringify(r.params)), csv: r => JSON.stringify(r.params) }, { k: 'rows', label: 'แถว', r: 1 }, { k: 'http', label: 'ผล' }, { k: 'fetched_at', label: 'ดึงเมื่อ' }], rows: ds, sort: 'tool', dir: 1, file: 'PSG_datasets' })}</section>`;
  }

  /* ---------- ตัวกรองและการแสดงผล ---------- */
  function goto(p, sub) { if (sub) st.sub = sub; location.hash = '#/' + p; }
  const usesPeriod = () => ['exec', 'fin'].indexOf(st.page) >= 0;
  /* หน้าที่ไม่มีตัวเลือกช่วงงวด: บอกช่วงข้อมูลไว้ท้ายหน้า เพื่อให้การ์ด KPI ขึ้นก่อนโดยไม่ต้องเลื่อนจอ */
  const periodNote = () => `<span class="note">ช่วงข้อมูล: ${st.page === 'sales' ? 'ฐานเดือนผลิตและวันที่เอกสาร' : st.page === 'ops' ? 'ตามแหล่งข้อมูลแต่ละส่วน' : 'ทั้งหมด'} · ข้อมูล ณ ${thD(S.meta.asof)}</span>`;
  function filters() {
    return `<label>ช่วงงวดบัญชี<select id="f-period"><option value="ytd" ${st.period === 'ytd' ? 'selected' : ''}>สะสมตั้งแต่ต้นปี (YTD)</option>${months().slice().reverse().map(m => `<option value="${m}" ${st.period === m ? 'selected' : ''}>${thML(m)}${M.monthStatus(S, m).estRevenue ? ' (รายได้ประมาณการ)' : ''}</option>`).join('')}</select></label>
      <span class="hint">ทุกเดือนเป็นผลเบื้องต้นจาก Ledger — ยังไม่มีข้อมูลยืนยันการปิดบัญชี · KPI กราฟ และตารางใช้ช่วงเดียวกัน</span>`;
  }
  function render(anim) {
    DR = []; TB = []; TR = []; GEN++;
    const title = PAGES.find(p => p[0] === st.page)[1];
    $('#tabs').innerHTML = PAGES.map(([k, l]) => `<a href="#/${k}" ${k === st.page ? 'aria-current="page"' : ''}>${l}</a>`).join('');
    $('#ptitle').textContent = st.page === 'exec' ? 'PSG Executive Dashboard' : title;
    $('#psub').textContent = 'ภาพรวมธุรกิจ การเงิน การผลิต และซ่อมบำรุง · ' + S.meta.company;
    $('#status').innerHTML = st.page === 'proj' && S.projects ? `<span class="chip"><span class="dot"></span>ClickUp ณ ${thD(S.projects.meta.fetched_at)}</span><span class="chip"><span class="dot"></span>TRCLOUD ณ ${thD(S.meta.asof)}</span><span class="chip warn">การจัดประเภทโครงการยังเป็นข้อเสนอ</span>`
      : `<span class="chip"><span class="dot"></span>ข้อมูล ณ ${thD(S.meta.asof)}</span><span class="chip warn">ผลเบื้องต้น/ยังไม่ปิดบัญชี</span>`;
    const per = usesPeriod();
    $('#filters').innerHTML = per ? filters() : '';
    document.querySelector('.filterbar').hidden = !per;
    const f = $('#f-period'); if (f) f.onchange = () => { st.period = f.value; save(); render(true); };
    const fn = { exec: pExec, sales: pSales, fin: pFin, proj: pProj, strat: pStrat, ops: pOps, data: pData }[st.page];
    const main = $('#main');
    try { main.innerHTML = fn() + (per ? '' : `<div class="note-bar">${periodNote()}</div>`); } catch (e) { main.innerHTML = `<div class="state err">แสดงผลไม่สำเร็จ: ${esc(e.message)}</div>`; console.error(e); return; }
    main.querySelectorAll('[data-table]').forEach(el => mountTable(el, TB[+el.dataset.table]));
    main.querySelectorAll('[data-tree]').forEach(el => mountTree(el, TR[+el.dataset.tree]));
    document.documentElement.classList.toggle('no-anim', anim === false);
    if (anim !== false) countUp(main, GEN);
    $('#foot').innerHTML = `PSG Executive Dashboard · ข้อมูลจาก TRCloud (อ่านอย่างเดียว)${S.projects ? ', ClickUp (อ่านอย่างเดียว)' : ''} และไฟล์ใบงานซ่อม · ข้อมูลภายในสำหรับผู้บริหาร ห้ามเผยแพร่ · สร้าง ${esc(S.meta.built.slice(0, 16).replace('T', ' '))} น.`;
    save();
  }
  function save() { try { sessionStorage.setItem('psg-st', JSON.stringify(st)); } catch (e) { /* ไม่บันทึก */ } }
  /* tooltip สำหรับกราฟ */
  const tip = document.createElement('div'); tip.className = 'tip'; tip.setAttribute('role', 'tooltip'); tip.hidden = true;
  function showTip(t, x, y) { tip.textContent = t; tip.hidden = false; const w = tip.offsetWidth; tip.style.left = Math.min(window.innerWidth - w - 8, Math.max(8, x - w / 2)) + 'px'; tip.style.top = (y - tip.offsetHeight - 12 + window.scrollY) + 'px'; }
  document.addEventListener('mouseover', e => { const g = e.target.closest && e.target.closest('[data-tip]'); if (g) showTip(g.dataset.tip, e.clientX, e.clientY); else tip.hidden = true; });
  document.addEventListener('focusin', e => { const g = e.target.closest && e.target.closest('[data-tip]'); if (g) { const r = g.getBoundingClientRect(); showTip(g.dataset.tip, r.left + r.width / 2, r.top); } });
  document.addEventListener('focusout', () => { tip.hidden = true; });
  document.addEventListener('click', e => { const t = e.target.closest('[data-drill]'); if (t) { e.preventDefault(); DR[+t.dataset.drill](); } else if (e.target.id === 'modal') closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeModal(); tip.hidden = true; } });
  window.addEventListener('hashchange', () => { const p = location.hash.replace('#/', ''); if (PAGES.some(x => x[0] === p)) { st.page = p; render(true); window.scrollTo(0, 0); } });

  /* ---------- ธีม: ปกติ (Corporate PSG) / มืด / สว่าง — จำค่าที่เลือก ---------- */
  function setTheme(t) {
    if (['psg', 'dark', 'light'].indexOf(t) < 0) t = 'psg';
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('psg-theme', t); } catch (e) { /* ใช้เฉพาะหน้านี้ */ }
    document.querySelectorAll('#theme button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.t === t)));
  }
  let theme = 'psg'; try { theme = localStorage.getItem('psg-theme') || 'psg'; } catch (e) { /* ค่าเริ่มต้น */ }
  setTheme(theme);
  document.querySelectorAll('#theme button').forEach(b => b.onclick = () => { setTheme(b.dataset.t); if (S) render(false); });

  function start(d) {
    document.body.appendChild(tip);
    S = d; if (!S || !S.pnl || !S.meta) { $('#main').innerHTML = '<div class="state err">snapshot ไม่สมบูรณ์ — ตรวจการสร้างข้อมูล</div>'; return; }
    try { Object.assign(st, JSON.parse(sessionStorage.getItem('psg-st') || '{}')); } catch (e) { /* ค่าเริ่มต้น */ }
    const hp = location.hash.replace('#/', ''); if (PAGES.some(x => x[0] === hp)) st.page = hp;
    if (st.period !== 'ytd' && months().indexOf(st.period) < 0) st.period = 'ytd';
    window.PSG = { snap: S, state: st }; render(true);
  }
  window.DASHApp = { start: start };
  if (!window.DASH_STATIC) {
    fetch('../data/snapshot.json', { cache: 'no-store' }).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(start)
      .catch(e => { $('#main').innerHTML = `<div class="state err">โหลด data/snapshot.json ไม่สำเร็จ (${esc(e.message)}) — โหมดทดสอบในเครื่อง: รัน <code>node scripts/serve.js</code> แล้วเปิด http://127.0.0.1:8090/web/</div>`; });
  }
})();
