// ทดสอบหน้าโครงการ (ClickUp + TRCLOUD) ด้วย Playwright — รัน: node scripts/serve.js 8091 & แล้ว node tests/ui_projects.js
const { chromium } = require('playwright'), assert = require('assert'), fs = require('fs'), path = require('path');
const URL = process.env.PSG_URL || 'http://127.0.0.1:8091/web/';
const S = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'snapshot.json'), 'utf8')), P = S.projects;
const num = s => +String(s).replace(/[^\d.]/g, '');
(async () => {
  assert.ok(P, 'snapshot ต้องมี projects'); const b = await chromium.launch(); let ok = 0; const errs = [];
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  p.on('pageerror', e => errs.push(e.message));
  for (const theme of ['psg', 'dark', 'light']) {
    await p.goto(URL); await p.evaluate(t => { localStorage.setItem('psg-theme', t); sessionStorage.clear(); }, theme);
    await p.goto(URL + '#/proj'); await p.reload(); await p.waitForSelector('[data-tree] table');
    const h2 = await p.$$eval('#main h2', a => a.map(x => x.textContent));
    assert.ok(h2.some(t => t.startsWith('1 · โครงการและงานสำคัญจาก ClickUp')) && h2.some(t => t.startsWith('2 · เงินลงทุนและภาระจัดซื้อจาก TRCLOUD')) && h2.some(t => t.startsWith('3 · รายการที่เชื่อม')), 'ต้องมี 3 ส่วนแยกฐานข้อมูล ' + theme);
    const chips = await p.$$eval('#status .chip', a => a.map(x => x.textContent));
    assert.ok(chips.some(c => c.startsWith('ClickUp ณ')) && chips.some(c => c.startsWith('TRCLOUD ณ')), 'ป้ายเวลาแยก ClickUp/TRCLOUD'); ok++;
  }
  await p.waitForTimeout(1200);
  const kv = async lab => (await p.$$eval('.kpi', (a, l) => a.filter(x => x.querySelector('.lab') && x.querySelector('.lab').textContent === l).map(x => x.querySelector('.val').getAttribute('aria-label')), lab))[0];
  // KPI ตรงกับข้อมูล + "โครงการที่ยืนยัน" ไม่นับ proposed
  assert.ok((await kv('โครงการที่ยืนยันแล้ว')).includes(String(P.items.filter(i => i.is_project && i.status === 'confirmed').length)));
  assert.ok((await kv('งานเกินกำหนดตามข้อมูล')).includes(String(P.tasks.filter(t => t.overdue).length)));
  assert.ok((await kv('งานไม่มีกำหนดส่ง')).includes(String(P.tasks.filter(t => !t.due).length)));
  const sec1 = await p.$$eval('section.card', a => a.find(x => x.querySelector('h2') && x.querySelector('h2').textContent.startsWith('1 ·')).querySelectorAll('.kpi').length);
  assert.strictEqual(sec1, 5, 'การ์ด KPI ส่วน ClickUp = 5 ใบ'); assert.strictEqual(await kv('Resource Utilization'), undefined, 'ไม่แสดงการ์ดที่ไม่มีข้อมูล'); ok++;
  // ห้ามเรียกจำนวนบรรทัด AP/EXP หรือ PO ว่าจำนวนโครงการ
  const labs = await p.$$eval('.kpi .lab', a => a.map(x => x.textContent)); assert.ok(!labs.some(l => /จำนวนโครงการ/.test(l))); ok++;
  // มุมมอง: KPI ตาราง และ CSV สอดคล้อง
  for (const [tab, types] of [['ศึกษาและพัฒนาธุรกิจ', ['feasibility_development']], ['งานประจำ/กิจการบริษัท', ['recurring_operation', 'corporate_governance']], ['ทั้งหมด', null]]) {
    await p.click(`.seg2 button:has-text("${tab}")`); await p.waitForTimeout(150);
    const items = P.items.filter(i => !types || types.includes(i.type)), roots = items.reduce((a, i) => a.concat(i.roots), []);
    assert.ok((await kv('สถานะงานหลัก')).includes(String(roots.length)), 'KPI ตามมุมมอง ' + tab);
    const regCount = await p.$eval('[data-table] .tools .note', e => e.textContent); assert.strictEqual(num(regCount), items.length, 'ตารางทะเบียน ' + tab);
    const [dl] = await Promise.all([p.waitForEvent('download'), p.click('[data-table] button[data-x=csv]')]);
    const csv = fs.readFileSync(await dl.path(), 'utf8').trim().split(/\r\n/); assert.strictEqual(csv.length - 1, items.length, 'CSV ตามมุมมอง ' + tab);
    const treeN = num(await p.$eval('[data-tree] .tools .note', e => e.textContent));
    assert.strictEqual(treeN, P.tasks.filter(t => items.some(i => i.project_id === t.item)).length, 'ต้นไม้ตามมุมมอง ' + tab); ok++;
  }
  // ต้นไม้: ย่อ/ขยาย + ระดับลึก BOI
  const rowsAll = await p.$$eval('[data-tree] tbody tr', a => a.length);
  await p.click('[data-tree] button[data-x=close]'); const rowsClosed = await p.$$eval('[data-tree] tbody tr', a => a.length);
  assert.ok(rowsClosed < rowsAll && rowsClosed === P.items.reduce((n, i) => n + i.roots.length, 0)); await p.click('[data-tree] button[data-x=open]');
  assert.ok(await p.$('[data-tree] tr.tree.d3'), 'ต้องแสดงงานชั้นที่ 4'); ok++;
  // BOI: "อนุมัติ" ไม่ถูกตีความว่าอนุมัติ / ยื่นเสร็จ ≠ สำเร็จ
  const boi = await p.$eval('section.card.accent', e => e.textContent);
  assert.ok(/รอผลพิจารณา/.test(boi) && /ถูกตีกลับ/.test(boi) && /ประมาณการ/.test(boi) && !/อนุมัติแล้ว/.test(boi)); ok++;
  // TRCLOUD: ยอดเดิมไม่หาย และไม่บวก PO กับ AP/EXP
  const cipTot = S.cip.reduce((s, c) => s + c.amt, 0) / 100;
  const foot = await p.$$eval('[data-table] tfoot', a => a.map(x => x.textContent));
  assert.ok(foot.some(f => f.includes(cipTot.toLocaleString('en-US', { minimumFractionDigits: 2 }))), 'ยอดตาราง 1701xxx เดิมต้องคงอยู่');
  const unl = P.investments.filter(i => i.map === 'unlinked').length;
  assert.ok((await kv('รายการลงทุนที่ยังไม่ระบุโครงการ')).includes(String(unl)), 'รายการที่ยังไม่เชื่อมยังปรากฏ');
  const head = await p.$$eval('[data-table] thead', a => a.map(x => x.textContent).join('|')); assert.ok(!/PO\s*\+\s*AP|รวมต้นทุน/.test(head)); ok++;
  // filter mapping ในตารางรายการลงทุน: ยอดท้ายตารางและ CSV สอดคล้อง
  const inv = (await p.$$('[data-table]'))[1];
  await (await inv.$('select[data-f=map]')).selectOption({ label: 'ยังไม่เชื่อม' }); await p.waitForTimeout(100);
  assert.strictEqual(num(await (await inv.$('.tools .note')).textContent()), unl); ok++;
  // แท็บเล็ต: ไม่เลื่อนแนวนอนทั้งหน้า
  await p.setViewportSize({ width: 820, height: 1100 }); await p.reload(); await p.waitForSelector('[data-tree] table');
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) <= 1); ok++;
  assert.deepStrictEqual(errs, []); console.log('UI โครงการ ผ่าน', ok, 'ข้อ'); await b.close();
})().catch(e => { console.error('ไม่ผ่าน:', e.message); process.exit(1); });
