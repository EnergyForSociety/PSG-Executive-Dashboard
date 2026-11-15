# PSG Executive Dashboard

ภาพรวมธุรกิจ การเงิน การผลิต และซ่อมบำรุง ของ บริษัท พระแสงกรีน พาวเวอร์ จำกัด (PSG)
ใช้ stack เดียวกับ SAM / STG / HEA: pipeline Python → snapshot JSON → เว็บ static ที่เข้ารหัสข้อมูล → เข้าสู่ระบบด้วย Microsoft 365 → เผยแพร่บน GitHub Pages

> repo เป็นสาธารณะเพื่อใช้ GitHub Pages — **ข้อมูลการเงินจริงทุกชิ้นอยู่นอก Git** (`raw/`, `data/`, `om/`, `intake/` อยู่ใน `.gitignore`)
> สิ่งเดียวที่ขึ้นเว็บคือ `site/data.enc.js` ซึ่งเข้ารหัส AES-256-GCM และเปิดได้เมื่อเข้าสู่ระบบ M365 และอยู่ในกลุ่มที่ได้รับสิทธิ์

## โครงสร้าง

| ส่วน | ไฟล์ | หน้าที่ |
|---|---|---|
| Source adapter | `scripts/ingest_session.py` | อ่านผลเรียก TRCloud MCP ของ PSG (อ่านอย่างเดียว) จาก transcript ของผู้ช่วย → `raw/` + `raw/_manifest.json` · ถ้าพบเครื่องมือเขียนข้อมูลจะหยุดทันที |
| Raw snapshot | `raw/` | ผลดิบทุกครั้งที่ดึง พร้อมพารามิเตอร์และเวลาที่ดึง |
| Import ใบงาน | `scripts/import_maintenance.py` | Excel ระบบแจ้งซ่อม → `data/maintenance.json` (เก็บไฟล์/ชีท/แถว/sha256 · นำเข้าไฟล์เดิมซ้ำไม่เพิ่มยอด · ไม่เก็บชื่อบุคคล) |
| Mapping | `config/mapping.json` | กลุ่มบัญชี P&L ตามหัวบัญชี COA, บัญชีซ่อมบำรุง, กฎจัดหมวดต้นทุน 5101000 |
| Normalization + Calculation | `scripts/build_snapshot.py` | Decimal → สตางค์, แยกฐานเวลา, P&L จาก Ledger, ตรวจความสอดคล้อง → `data/snapshot.json` |
| UI | `web/` (`metrics.js` คำนวณ, `app.js` แสดงผล) | 7 เมนู · 3 ธีม · count-up · tooltip · ส่งออก CSV |
| Login / เข้ารหัส | `static/gate.js`, `static/auth-config.js`, `scripts/build-static.js` | MSAL (M365) ตรวจ tenant + กลุ่ม → ดึงกุญแจจาก SharePoint ด้วยสิทธิ์ผู้ใช้ → ถอดรหัสในเบราว์เซอร์ |
| เผยแพร่ | `.github/workflows/pages.yml` | push โฟลเดอร์ `site/` ขึ้น GitHub Pages |

## อัปเดตข้อมูล (ทำในเครื่อง / ผ่านผู้ช่วย)

1. ดึงข้อมูล TRCloud ของ **PSG เท่านั้น** แบบอ่านอย่างเดียว (Ledger ทุกบัญชี P&L ครบทุกหน้า, B3, IV3, CN3, PO3, P5, X3, receivable/payable due, search_bank, search_coa) แล้วรัน
   `python3 scripts/ingest_session.py <transcript.jsonl>`
2. วางไฟล์ใบงานซ่อมใน `om/` แล้วรัน `python3 scripts/import_maintenance.py om/<ไฟล์>.xlsx`
3. `python3 scripts/build_snapshot.py --asof YYYY-MM-DD` — อ่านผล PASS/WARN ท้ายคำสั่ง
4. ตรวจในเครื่อง: `node scripts/serve.js` แล้วเปิด http://127.0.0.1:8090/web/ (ฟังเฉพาะเครื่องนี้)
5. สร้างเว็บ: `node scripts/build-static.js --key C:\mcp\keys\psg-dash-key.txt --out site`
   (ไม่มีไฟล์กุญแจ → สร้างใหม่ให้ · ห้ามเก็บกุญแจในโฟลเดอร์โครงการ — สคริปต์จะปฏิเสธ · สคริปต์ตรวจไม่ให้เลขเอกสาร/ชื่อคู่ค้าจริงหลุดในไฟล์ที่ไม่เข้ารหัส)
6. commit และ push ด้วย GitHub Desktop (เฉพาะโค้ด + `site/`)

## ตั้งค่า Login Microsoft 365 (ครั้งแรก)

ใช้ App registration เดิม "CCC Staff Status Login" (clientId/tenantId อยู่ใน `static/auth-config.js` — เปิดเผยได้ ไม่ใช่ความลับ)

1. สร้างกลุ่ม Entra ID `psg_dashboard_viewers` → ใส่ Object ID ใน `groupId`
2. เพิ่ม redirect URI ของเว็บ PSG (เช่น `https://<org>.github.io/PSG-Executive-Dashboard/`) ใน App registration แบบ SPA
3. อัปโหลด `psg-dash-key.txt` ไปที่ SharePoint แชร์ **เฉพาะ** `psg_dashboard_viewers` สิทธิ์ View → ใส่ลิงก์ใน `keyShareUrl`
4. กุญแจ PSG ต้องแยกจาก STG/HEA/SAM · ถ้าเปลี่ยนกุญแจ: build ใหม่ด้วยกุญแจใหม่ แล้วแทนไฟล์ใน SharePoint พร้อมกัน (กุญแจเก่าเปิดข้อมูลชุดใหม่ไม่ได้)

ความปลอดภัย: ไม่มี client secret / session secret ในเว็บ · token อยู่ใน sessionStorage ของ MSAL · หมดอายุตาม session ของ M365 · ออกจากระบบด้วยปุ่ม "ออกจากระบบ"
เว็บเป็น static จึงไม่มี API ฝั่ง server — สิทธิ์ดูข้อมูลบังคับด้วย "อยู่ในกลุ่ม + เปิดไฟล์กุญแจใน SharePoint ได้" · สิทธิ์ import/refresh/mapping อยู่ที่ผู้ที่เข้าถึงเครื่องและโฟลเดอร์โครงการเท่านั้น

## ทดสอบ

```
python3 -m unittest tests/test_pipeline.py      # pipeline, P&L, กลับรายการ, BL/IV ไม่ซ้ำ, kWh, ใบงานนำเข้าซ้ำ
node tests/metrics.test.js                      # ฟังก์ชันคำนวณ
node scripts/serve.js 8091 & node tests/ui_smoke.js     # 7 หน้า × 3 ธีม, count-up, ตัวกรอง, reduced motion, แท็บเล็ต
node tests/gate_test.js site <ไฟล์กุญแจทดสอบ>          # login/logout/สิทธิ์กลุ่ม/กุญแจผิด (จำลอง M365)
```

เอกสารเพิ่มเติม: `docs/KPI-DEFINITIONS.md` (นิยาม KPI, mapping, ตารางความพร้อม) · `docs/DATA-REQUESTS.md` · `docs/CHANGES-LIMITATIONS.md` · `docs/TEST-RESULTS.md`
