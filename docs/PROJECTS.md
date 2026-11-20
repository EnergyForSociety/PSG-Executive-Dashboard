# หน้าโครงการ — ClickUp + TRCLOUD

> เอกสารนี้อยู่ใน repo สาธารณะ จึงอธิบายเฉพาะวิธีการ · ชื่องาน/โครงการจริงอยู่ใน `intake/` และ `raw/clickup/` (ไม่ขึ้น Git) และในไฟล์เว็บที่เข้ารหัสเท่านั้น

## โครงสร้างหน้า

| ส่วน | แหล่ง | เนื้อหา |
|---|---|---|
| 1 · โครงการและงานสำคัญจาก ClickUp | ClickUp (อ่านอย่างเดียว · PSG Space เท่านั้น) | มุมมอง 7 แบบ, KPI, ขั้นตอน BOI, ทะเบียนโครงการ, ลำดับชั้นงาน, ข้อสังเกต |
| 2 · เงินลงทุนและภาระจัดซื้อจาก TRCLOUD | snapshot TRCLOUD เดิม | การ์ดเดิม 2 ใบ + รายการลงทุนที่ยังไม่ระบุโครงการ, ตารางรายการลงทุนระดับ PO/เอกสาร, ตาราง 1701xxx เดิม (เพิ่มคอลัมน์และตัวกรอง mapping) |
| 3 · รายการที่เชื่อมกันแล้วและยังไม่ยืนยัน | `intake/project_links.json` | จำนวนตามสถานะ mapping 4 แบบ เปิดดูรายการได้ |

ป้ายเวลา ClickUp และ TRCLOUD แยกกันทั้งที่หัวหน้าและในแต่ละส่วน

## ทะเบียนโครงการ (`intake/project_registry.json`)

Task / List / Folder ไม่ใช่โครงการโดยอัตโนมัติ · ทะเบียนเป็นตัวกำหนด

| ฟิลด์ | ความหมาย |
|---|---|
| `project_id` | รหัสภายใน Dashboard (`PSG-P-…` โครงการ, `PSG-W-…` งานสนับสนุน, `PSG-O-…` งานประจำ, `PSG-G-…` กิจการบริษัท, `PSG-S-…` milestone) |
| `type` | investment_delivery · feasibility_development · regulatory_approval · financing_workstream · contract_workstream · recurring_operation · corporate_governance · supporting_task · needs_review |
| `stage` | ขั้นดำเนินงาน (ข้อความ) |
| `clickup_tasks` | Task ID ที่เป็นงานหลักของรายการ (งานย่อยทุกชั้นตามมาเอง) |
| `clickup_lists` | List ที่ใช้รวบรวมงาน — ใช้เมื่อไม่มีงานระบุตรง และไม่ดึงงานที่เป็นของรายการอื่น |
| `parent_project` | โครงการแม่ (ถ้ามี) |
| `owner` | เจ้าของโครงการที่ยืนยัน · ว่าง = แสดงผู้รับผิดชอบงานหลักจาก ClickUp |
| `status` | `proposed` / `confirmed` · confirmed ต้องมี `confirmed_by` และ `confirmed_at` ไม่เช่นนั้นระบบแสดงเป็น proposed |
| `reason`, `evidence` | เหตุผลและหลักฐานการจัดประเภท |
| `physical_progress` | `{pct, confirmed_by, at}` จากผู้ควบคุมงานเท่านั้น · ว่าง = N/A |
| `task_roles` | บทบาทงานย่อย: `submission` (ยื่นเอกสาร), `decision` (ผลพิจารณาของหน่วยงาน), `milestone`, `track`, `parent` · `outcome_kind: returned` = มีหลักฐานว่าถูกตีกลับ |

นับเป็น "โครงการ" เฉพาะ `type` ใน `project_types` (ค่าเริ่มต้น investment_delivery, feasibility_development, regulatory_approval) และ `status = confirmed`
งานหลักใหม่ใน ClickUp ที่ไม่อยู่ในทะเบียน → แสดงเป็น "ยังไม่จำแนก" (`AUTO-<task id>`) ไม่สร้างโครงการเอง

## นิยามตัวเลข

| ตัวเลข | นิยาม |
|---|---|
| โครงการที่ยืนยันแล้ว | รายการในทะเบียนที่เป็นประเภทโครงการและ confirmed |
| รายการ proposed / รอจำแนก | รายการในทะเบียนที่ยังไม่ confirmed |
| สถานะงานหลัก | จำนวนงานหลักของรายการในมุมมอง แยกตามสถานะ ClickUp |
| งานเกินกำหนดตามข้อมูล | งานที่ไม่ใช่ complete/cancelled และกำหนดส่ง < วันนี้ (วันนี้ = `current_time` ของผู้ใช้ ClickUp ตอนดึง) |
| งานไม่มีกำหนดส่ง | งานหลัก+งานย่อยที่ไม่มี due date |
| งานย่อยเสร็จ | งานย่อยระดับล่างสุดที่ complete ÷ (งานย่อยระดับล่างสุด − cancelled) · ไม่มีงานย่อย = N/A · ไม่ใช่ Physical Progress |
| งานถัดไป | งานระดับล่างสุดที่ยังเปิด เรียงกำหนดส่งก่อน แล้ววันสร้าง |
| Resource Utilization | ไม่แสดง — ClickUp ไม่มี Time Estimate/Time Spent และไม่มีชั่วโมงจริง |

วันที่แบบไม่มีเวลาใน ClickUp เก็บเป็น 00:00 ของวันถัดไปตามเขตเวลาผู้ใช้ → แปลงด้วยเขตเวลาผู้ใช้แล้วถอย 1 ms (ยืนยันจาก Note ในงานสองรายการที่ระบุวันที่เป็นข้อความ)

## รายการลงทุน TRCLOUD และ mapping

- รายการลงทุน = 1 PO (บรรทัดบัญชี 1701xxx) หรือ 1 เอกสาร AP/EXP 1701xxx ที่ไม่มี PO · รหัส `INV-<เลขเอกสาร>`
- คอลัมน์แยก: งบอนุมัติ · มูลค่า PO (ภาระผูกพัน) · รับสินค้า/บริการ · บันทึกบัญชีสินทรัพย์ · จ่ายจริง — ไม่บวกข้ามคอลัมน์ · ไม่มีข้อมูล = "รอแหล่งข้อมูล"
- สินทรัพย์ระหว่างก่อสร้างไม่เข้า P&L · ไม่อนุมานความคืบหน้าจากสัดส่วนการจ่ายเงิน
- `intake/project_links.json` (รูปแบบใน `templates/project_links.example.json`) รองรับหลายต่อหลาย พร้อมสัดส่วน/จำนวนเงินจัดสรร
- สถานะ: เชื่อมแล้วและยืนยัน · คู่ที่เสนอให้ตรวจสอบ · ยังไม่เชื่อม · ไม่เกี่ยวข้องกับโครงการ · confirmed ที่ไม่มีผู้ยืนยัน → ถือเป็นคู่เสนอ
- ห้ามจับคู่จากชื่อ ผู้ขาย หรือยอดใกล้กันอย่างเดียว · รายการที่ยังไม่เชื่อมแสดงครบเสมอ

## ข้อสังเกตอัตโนมัติ (ไม่มีคะแนนความเสี่ยง)

กำหนดงานย่อยหลังงานแม่ · งานแม่ complete แต่งานย่อยเปิด · งานย่อยปิดครบแต่งานแม่เปิด · งานเลยกำหนด · งานเปิดที่ไม่มีกำหนด · งานเปิดที่ไม่อัปเดตเกิน `stale_days` (ค่าเริ่มต้น 60) · milestone/ยื่นเอกสาร complete แต่ผลยังไม่ยืนยัน · รายการลงทุนที่ยังไม่เชื่อม · โครงการที่ยังไม่มีหลักฐานค่าใช้จ่ายเชื่อม — ทุกข้อมีลิงก์ต้นทาง

## อัปเดตข้อมูล ClickUp (adapter ผ่าน MCP session)

เว็บบน GitHub Pages เรียก MCP ไม่ได้ ต้องดึงผ่านผู้ช่วย (Claude/Codex) ที่ต่อ ClickUp MCP แล้วเก็บผลดิบในเครื่อง

1. สั่งผู้ช่วย: "ดึง ClickUp PSG Space 901811857778 แบบอ่านอย่างเดียวตาม docs/PROJECTS.md แล้วบันทึกผลดิบใน raw/clickup" — ลำดับเรียก
   - `clickup_get_user` (เวลาและเขตเวลา) · `clickup_get_workspace_hierarchy` (space_ids=[PSG], max_depth=2)
   - `clickup_filter_tasks` (space_ids=[PSG], include_closed=true, subtasks=true) ทุก page จน `has_more=false`
   - `clickup_execute_operator` task.get_many (ids ทั้งหมด, includeContent=false) · `clickup_get_list` (สถานะ) · `clickup_get_custom_fields`
   - `clickup_get_time_entries` เมื่อจำเป็นและได้รับสิทธิ์
2. ทางเลือก: `python3 scripts/ingest_clickup.py <transcript.jsonl>` อ่าน transcript ของ session แล้วเขียน `raw/clickup/` (หยุดทันทีถ้าพบเครื่องมือเขียนข้อมูล)
3. `python3 scripts/build_projects.py` (หรือ `build_snapshot.py` ซึ่งเรียกให้อัตโนมัติ) — อ่าน PASS/WARN ท้ายคำสั่ง · ถ้า pagination ไม่ครบ ขาดรายละเอียดงาน หรือ parent วนซ้ำ จะหยุด
4. ตรวจ/แก้ทะเบียนและ mapping ใน `intake/` แล้ว build เว็บตามขั้นตอนเดิม (`build-static.js`) — สคริปต์ปฏิเสธถ้าชื่องาน/ID ClickUp หลุดในไฟล์ที่ไม่เข้ารหัส

ห้ามแก้สถานะ วันที่ ผู้รับผิดชอบ Custom Fields หรือโครงสร้างใน ClickUp จาก Dashboard นี้
