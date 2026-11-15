"""นำเข้าไฟล์ Excel ใบงานแจ้งซ่อมของ PSG → data/maintenance.json พร้อมที่มา (ไฟล์ ชีท แถว เวลานำเข้า sha256)
ใช้: python3 scripts/import_maintenance.py om/<ไฟล์>.xlsx
หลักการ
- ไม่เก็บชื่อบุคคล (ผู้แจ้ง/ผู้รับผิดชอบ/ความคิดเห็น) ลงชุดข้อมูล
- ช่องว่าง = ไม่มีข้อมูล (ไม่แปลงเป็นศูนย์) · วันที่เป็น ค.ศ. ตามไฟล์ (ตรวจปีให้อยู่ในช่วง 2020–2035 ไม่เช่นนั้นแจ้งเตือน)
- ข้อมูลเป็น snapshot ของระบบแจ้งซ่อม ไม่ใช่สถานะปัจจุบันที่ยืนยันแล้ว
- ตรวจคุณภาพ: วันเสร็จช่างต่างจากวันเสร็จในระบบเกิน 7 วัน, เริ่มก่อนแจ้ง, เสร็จก่อนแจ้ง,
  ข้อความบอกว่าเดินไม่ได้แต่สถานะเครื่องจักรระบุใช้งานได้, ใบงานเครื่องเดียวกันห่างกันไม่เกิน 30 วัน (อาจซ้ำ/ต่อเนื่อง — ต้องตรวจ)
- นำเข้าไฟล์เดิมซ้ำ (sha256 เดิม) ไม่เพิ่มประวัติและไม่เพิ่มยอด เพราะเขียนทับชุดข้อมูลทั้งไฟล์"""
import sys, os, json, hashlib, datetime, re
import openpyxl
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data')
COLS = {'wo': 'เลขที่ใบงาน', 'status': 'สถานะ', 'reported': 'วันที่แจ้งซ่อม', 'type': 'ประเภทใบงาน', 'machine_stop': 'สถานะเครื่องจักรหยุด', 'line': 'สถานะไลน์ผลิต',
        'urgency': 'ระดับความด่วน', 'safety': 'ความปลอดภัย', 'mdept': 'แผนกของเครื่องจักร', 'qr': 'QR Code', 'machine': 'ชื่อเครื่องจักร', 'mtype': 'ประเภทเครื่องจักร',
        'symptom': 'อาการเสีย', 'fcode': 'รหัสอาการเสีย', 'fdesc': 'รายละเอียดรหัสอาการเสีย', 'rcode': 'รหัสอาการซ่อม', 'rdesc': 'รายละเอียดรหัสอาการซ่อม',
        'cause': 'สาเหตุอาการเสีย', 'fix': 'วิธีการแก้ไข', 'assigned': 'วันเวลาที่มอบงาน', 'min_assign': 'ระยะเวลาตั้งแต่แจ้งซ่อมถึงมอบหมาย (นาที)',
        'min_done': 'ระยะเวลาตั้งแต่แจ้งซ่อมถึงซ่อมเสร็จ (นาที)', 'min_work': 'ระยะเวลาเริ่มซ่อมถึงซ่อมเสร็จ (นาที)', 'expected': 'วันที่คาดว่าจะเสร็จ',
        'tech_start': 'เริ่มทำจริง (ช่างระบุเอง)', 'tech_done': 'ซ่อมเสร็จจริง (ช่างระบุเอง)', 'done_at': 'วันเวลาที่ซ่อมเสร็จ', 'score': 'คะแนนการประเมิน'}
DONE = ('ปิดงาน', 'ซ่อมแล้ว รอประเมิน')
REJECT = ('ถูกปฏิเสธ',)
NOT_RUN = re.compile(r'เดินไม่ได้|ไม่สามารถเดิน|ไม่สามารถใช้งาน|ใช้งานไม่ได้|หยุดเดิน|ดับ|trip', re.I)


def iso(v):
    if isinstance(v, datetime.datetime): return v.isoformat(timespec='minutes')
    if isinstance(v, datetime.date): return v.isoformat()
    return None


def num(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def txt(v, n=None):
    s = re.sub(r'\s+', ' ', str(v)).strip() if v not in (None, '') else ''
    return s[:n] if n else s


def sla_hours(label):
    m = re.search(r'SLA\s*(\d+)\s*(ชั่วโมง|วัน)', label or '')
    return None if not m else int(m.group(1)) * (1 if m.group(2) == 'ชั่วโมง' else 24)


def days(a, b):
    if not a or not b: return None
    f = lambda s: datetime.datetime.fromisoformat(s if len(s) > 10 else s + 'T00:00')
    return (f(b) - f(a)).total_seconds() / 86400


def parse(path):
    wb = openpyxl.load_workbook(path, data_only=True); ws = wb.worksheets[0]
    rows = list(ws.iter_rows(values_only=True)); head = [txt(h) for h in rows[0]]
    idx = {k: head.index(v) for k, v in COLS.items() if v in head}
    miss = [v for k, v in COLS.items() if k not in idx]
    if 'wo' not in idx or 'reported' not in idx: raise SystemExit('ไม่พบคอลัมน์ เลขที่ใบงาน/วันที่แจ้งซ่อม — ไฟล์ไม่ใช่รูปแบบรายงานใบงาน')
    out, issues, seen = [], [], set()
    for n, r in enumerate(rows[1:], start=2):
        g = lambda k: r[idx[k]] if k in idx else None
        if not g('wo'): continue
        wo = txt(g('wo'))
        if wo in seen: issues.append(f'แถว {n}: เลขที่ใบงาน {wo} ซ้ำ — ใช้แถวแรก'); continue
        seen.add(wo)
        rep = iso(g('reported'))
        if not rep: issues.append(f'แถว {n}: อ่านวันที่แจ้งซ่อมไม่ได้'); continue
        if not 2020 <= int(rep[:4]) <= 2035: issues.append(f'แถว {n}: ปีวันที่แจ้ง {rep[:4]} อยู่นอกช่วงที่คาด — ตรวจ พ.ศ./ค.ศ.')
        st = txt(g('status')); done = st in DONE
        tstart, tdone, sysdone = iso(g('tech_start')), iso(g('tech_done')), iso(g('done_at')) if done else None
        text = ' '.join(txt(g(k)) for k in ('symptom', 'cause', 'fix'))
        flags = []
        if tdone and sysdone and abs(days(tdone, sysdone)) > 7: flags.append('done_gap')
        if tstart and days(rep, tstart) < 0: flags.append('start_before_report')
        if tdone and days(rep, tdone) < 0: flags.append('done_before_report')
        if txt(g('machine_stop')).startswith('ยังใช้งาน') and NOT_RUN.search(text): flags.append('stop_text_conflict')
        out.append({'wo': wo, 'row': n, 'status': st, 'state': 'done' if done else 'rejected' if st in REJECT else 'open',
                    'reported': rep, 'type': txt(g('type')), 'urgency': txt(g('urgency')), 'sla_h': sla_hours(txt(g('urgency'))),
                    'safety': txt(g('safety')).startswith('เกี่ยวข้อง'), 'machine_stop': txt(g('machine_stop')), 'line': txt(g('line')),
                    'qr': txt(g('qr')), 'machine': txt(g('machine'), 120), 'mtype': txt(g('mtype')) or '(ไม่ระบุ)', 'symptom': txt(g('symptom'), 400),
                    'fcode': txt(g('fcode')).rstrip(','), 'fdesc': txt(g('fdesc')), 'rcode': txt(g('rcode')).rstrip(','), 'rdesc': txt(g('rdesc')),
                    'external': 'ภายนอก' in txt(g('rdesc')) or 'ส่งซ่อม' in txt(g('fix')),
                    'cause': txt(g('cause'), 300), 'fix': txt(g('fix'), 300), 'assigned': iso(g('assigned')), 'expected': iso(g('expected')),
                    'min_assign': num(g('min_assign')), 'min_done': num(g('min_done')) if done else None, 'min_work': num(g('min_work')) if done else None,
                    'tech_start': tstart, 'tech_done': tdone, 'done_at': sysdone, 'score': num(g('score')), 'flags': flags})
    # ใบงานเครื่อง (QR) เดียวกันที่แจ้งห่างกันไม่เกิน 30 วัน → อาจเป็นงานซ้ำหรืองานต่อเนื่อง (ระบบไม่ตัดสินเอง)
    by_qr = {}
    for w in sorted(out, key=lambda x: x['reported']):
        if not w['qr']: continue
        prev = by_qr.get(w['qr'])
        if prev and days(prev['reported'], w['reported']) <= 30:
            w['flags'].append('maybe_repeat'); w['repeat_of'] = prev['wo']
        by_qr[w['qr']] = w
    return out, miss, issues, ws.title


def main(path):
    raw = open(path, 'rb').read(); sha = hashlib.sha256(raw).hexdigest()
    rows, miss, issues, sheet = parse(path)
    now = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=7))).isoformat(timespec='seconds')
    dates = sorted(r['reported'] for r in rows)
    d = {'source': {'file': os.path.basename(path), 'sheet': sheet, 'sha256': sha, 'imported_at': now, 'rows': len(rows),
                    'reported_from': dates[0][:10] if dates else None, 'reported_to': dates[-1][:10] if dates else None, 'missing_cols': miss, 'issues': issues[:50],
                    'note': 'snapshot จากระบบแจ้งซ่อม — ไม่ใช่สถานะปัจจุบันที่ยืนยันแล้ว'},
         'rows': rows}
    os.makedirs(DATA, exist_ok=True)
    json.dump(d, open(os.path.join(DATA, 'maintenance.json'), 'w', encoding='utf-8'), ensure_ascii=False)
    hp = os.path.join(DATA, 'maintenance_history.json')
    h = json.load(open(hp, encoding='utf-8')) if os.path.exists(hp) else []
    if not any(x['sha256'] == sha for x in h): h.append({k: d['source'][k] for k in ('file', 'sha256', 'imported_at', 'rows', 'reported_from', 'reported_to')})
    json.dump(h, open(hp, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    qrs = len({r['qr'] for r in rows if r['qr']})
    print(f'นำเข้าใบงาน {len(rows)} รายการ ({d["source"]["reported_from"]} ถึง {d["source"]["reported_to"]}) · QR {qrs} รหัส · sha256 {sha[:12]}…')
    if miss: print('  คอลัมน์ที่ไม่พบ:', ', '.join(miss))
    for i in issues[:10]: print('  !', i)


if __name__ == '__main__':
    if len(sys.argv) != 2: raise SystemExit(__doc__)
    main(sys.argv[1])
