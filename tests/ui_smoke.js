// ทดสอบหน้าเว็บด้วย Playwright — รัน: node scripts/serve.js 8091 & แล้ว node tests/ui_smoke.js
const { chromium } = require('playwright'), assert = require('assert');
const URL = process.env.PSG_URL || 'http://127.0.0.1:8091/web/';
(async () => {
  const b = await chromium.launch(); let ok = 0; const errs = [];
  const p = await b.newPage({ viewport: { width: 1366, height: 900 } });
  p.on('pageerror', e => errs.push(e.message));
  const pages = ['exec', 'sales', 'fin', 'proj', 'strat', 'ops', 'data'];
  for (const theme of ['psg', 'dark', 'light']) {
    await p.goto(URL); await p.evaluate(t => localStorage.setItem('psg-theme', t), theme);
    for (const pg of pages) {
      await p.goto(URL + '#/' + pg); await p.reload(); await p.waitForSelector('#main .card');
      assert.strictEqual(await p.getAttribute('html', 'data-theme'), theme);
      assert.ok(!(await p.$('.state.err')), `${pg}/${theme} แสดงผลผิดพลาด`); ok++;
    }
  }
  // count-up จบที่ค่าจริง + aria-label มีค่าจริง + N/A ไม่ถูก animate เป็นศูนย์
  await p.goto(URL + '#/exec'); await p.reload(); await p.waitForTimeout(1300);
  const k = await p.$$eval('.kpi .val', els => els.map(e => ({ aria: e.getAttribute('aria-label'), txt: e.textContent.trim() })));
  k.forEach(x => { if (!/N\/A|รอแหล่ง|ยังคำนวณ|ไม่แสดง|ไม่เหมาะ/.test(x.txt)) assert.ok(x.aria.includes(x.txt.split(' ')[0]), 'aria-label ต้องมีค่าจริง ' + x.txt); });
  assert.ok(k.some(x => x.txt.includes('รอแหล่งข้อมูล')), 'เงินสดต้องเป็น N/A'); ok++;
  // เปลี่ยนตัวกรองกลางคัน: ค่าต้องจบที่ค่าของตัวกรองใหม่
  await p.selectOption('#f-period', '2026-09'); await p.waitForTimeout(100); await p.selectOption('#f-period', 'ytd'); await p.waitForTimeout(1300);
  const v1 = await p.$eval('.kpi .val', e => e.textContent.trim()), a1 = await p.$eval('.kpi .val', e => e.getAttribute('aria-label'));
  assert.ok(a1.includes(v1.split(' ')[0]), 'ค่าหลังเปลี่ยนตัวกรองต้องตรงผลคำนวณ'); ok++;
  // reduced motion: แสดงค่าจริงทันที
  const rp = await b.newPage({ reducedMotion: 'reduce' }); await rp.goto(URL + '#/exec'); await rp.waitForSelector('.kpi .v');
  const imm = await rp.$eval('.kpi .val', e => [e.textContent.trim(), e.getAttribute('aria-label')]);
  assert.ok(imm[1].includes(imm[0].split(' ')[0])); ok++;
  // modal drilldown
  await p.click('.insight .link'); await p.waitForSelector('#modal:not([hidden]) table'); await p.keyboard.press('Escape'); ok++;
  // tablet
  await p.setViewportSize({ width: 820, height: 1100 }); await p.goto(URL + '#/fin'); await p.reload(); await p.waitForSelector('.card');
  const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); assert.ok(over <= 1, 'หน้าแท็บเล็ตไม่ควรเลื่อนแนวนอน'); ok++;
  assert.deepStrictEqual(errs, []); console.log('UI smoke ผ่าน', ok, 'ข้อ'); await b.close();
})().catch(e => { console.error('ไม่ผ่าน:', e.message); process.exit(1); });
