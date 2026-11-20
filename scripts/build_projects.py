"""PSG Executive Dashboard — โครงการและงานสำคัญ (ClickUp) + เงินลงทุน/ภาระจัดซื้อ (TRCLOUD) → snapshot['projects']
ใช้:  python3 scripts/build_projects.py            (อ่าน data/snapshot.json เดิม แล้วเขียนกลับพร้อมส่วน projects)
      หรือถูกเรียกอัตโนมัติจาก build_snapshot.py เมื่อมี raw/clickup/
แหล่ง: raw/clickup/ (ผลดิบ ClickUp MCP แบบอ่านอย่างเดียว เฉพาะ PSG Space) · intake/project_registry.json · intake/project_links.json
หลักการ
- Task / List ไม่ใช่โครงการโดยอัตโนมัติ — ทะเบียนโครงการ (registry) เป็นตัวกำหนด · proposed ไม่กลายเป็น confirmed เอง
- Deduplicate ด้วย Task ID · hierarchy recursive (ไม่จำกัดชั้น) · สัดส่วนงานย่อยนับเฉพาะงานย่อยระดับล่างสุด (ไม่บวก parent+child ซ้ำ)
- complete ≠ cancelled · ไม่มีงานย่อย = None (N/A) ไม่ใช่ 0% · ไม่คำนวณ Physical Progress / Utilization จากจำนวนงาน
- วันนี้/เกินกำหนด ใช้ current_time + timezone ของผู้ใช้ ClickUp ตอนดึงข้อมูล (ไม่ใช้นาฬิกาเครื่อง build)
- TRCLOUD: แยก มูลค่า PO / ยอดบันทึกบัญชี / รับของ / จ่ายจริง / งบอนุมัติ · ไม่บวก PO กับ AP/EXP · รายการที่ยังไม่เชื่อมยังแสดงครบ"""
import json, os, re, sys, glob, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW_CU = os.path.join(ROOT, 'raw', 'clickup')
INTAKE = os.path.join(ROOT, 'intake')
DATA = os.path.join(ROOT, 'data')
SPACE_ID = '901811857778'
DONE, CLOSED = 'done', 'closed'


def tz_of(offset):          # '+07:00' → timezone
    m = re.match(r'([+-])(\d{2}):(\d{2})', offset or '+07:00')
    s = 1 if m.group(1) == '+' else -1
    return datetime.timezone(s * datetime.timedelta(hours=int(m.group(2)), minutes=int(m.group(3))))


def ms_date(ms, tz):
    """วันที่แบบไม่มีเวลา (due_date_time=false): ClickUp เก็บเป็นเวลา 00:00 ของวันถัดไปตามเขตเวลาผู้ใช้
    (ยืนยันจาก Note ในงาน: ปันผล 'ภายใน 31 สิงหาคม' และ BOI 'ภายใน 31/3/2570' ตรงกับค่า −1 ms) → ถอย 1 ms ก่อนแปลงเป็นวันที่"""
    if ms in (None, ''): return None
    dt = datetime.datetime.fromtimestamp(int(ms) / 1000, tz)
    if (dt.hour, dt.minute, dt.second, dt.microsecond) == (0, 0, 0, 0): dt -= datetime.timedelta(milliseconds=1)
    return dt.date().isoformat()


def ms_iso(ms, tz):
    return None if ms in (None, '') else datetime.datetime.fromtimestamp(int(ms) / 1000, tz).isoformat(timespec='seconds')


def load_json(p, default=None):
    if not os.path.exists(p): return default
    with open(p, encoding='utf-8') as f: return json.load(f)


def load_clickup(raw_dir=RAW_CU):
    """อ่านผลดิบ → (meta, tasks_by_id, checks) · ตรวจ pagination ครบ, space ถูกต้อง, detail ครบทุก task"""
    checks = []
    meta = load_json(os.path.join(raw_dir, 'meta.json'))
    if not meta: raise SystemExit('ไม่พบ raw/clickup/meta.json — ดึงข้อมูล ClickUp ก่อน (ดู README)')
    pages = sorted(glob.glob(os.path.join(raw_dir, f'filter_tasks__space{SPACE_ID}__p*.json')), key=lambda p: int(re.search(r'__p(\d+)\.json$', p).group(1)))
    if not pages: raise SystemExit('ไม่พบผล filter_tasks ของ PSG Space')
    nums = [int(re.search(r'__p(\d+)\.json$', p).group(1)) for p in pages]
    if nums != list(range(len(nums))): raise SystemExit(f'หน้า pagination ไม่ต่อเนื่อง: {nums}')
    rows = []
    for i, p in enumerate(pages):
        d = load_json(p)
        if i == len(pages) - 1 and d.get('has_more'): raise SystemExit(f'pagination ยังไม่ครบ — หน้า {nums[-1]} มี has_more=true ต้องดึง page {d.get("next_page")} ต่อ')
        rows += d['tasks']
    checks.append(('pass', f'ClickUp filter_tasks {len(pages)} หน้า {len(rows)} แถว · หน้าสุดท้าย has_more=false'))
    allowed_lists = {l['id']: l['name'] for l in meta['hierarchy']['lists']}
    foreign = [r for r in rows if r['list']['id'] not in allowed_lists]
    if foreign: checks.append(('warn', f'ตัดงานนอก PSG Space ออก {len(foreign)} รายการ'))
    rows = [r for r in rows if r['list']['id'] in allowed_lists]
    by = {}
    for r in rows:                                   # dedupe ด้วย Task ID (เก็บฉบับที่อัปเดตล่าสุด)
        if r['id'] not in by or int(r['date_updated'] or 0) > int(by[r['id']]['date_updated'] or 0): by[r['id']] = r
    dup = len(rows) - len(by)
    checks.append(('pass', f'Deduplicate ด้วย Task ID: {len(rows)} → {len(by)} รายการ (ซ้ำ {dup})'))
    detail = {}
    for f in sorted(glob.glob(os.path.join(raw_dir, 'task_get_many__*.json'))):
        for d in load_json(f):
            if d.get('st') == 'found': detail[d['id']] = d
    miss = [k for k in by if k not in detail]
    if miss: raise SystemExit('ขาดรายละเอียดงาน (get task): ' + ', '.join(miss))
    return meta, by, detail, allowed_lists, checks, {'pages': len(pages), 'rows': len(rows) + len(foreign), 'dup': dup}


def build_tasks(meta, by, detail, lists, tz):
    stype = {s['status']: s['type'] for s in meta['statuses']}
    T = {}
    for tid, r in by.items():
        d = detail[tid]
        st = r['status']
        kind = DONE if stype.get(st) == 'done' else CLOSED if stype.get(st) == 'closed' else 'open'
        remark = next((f['value'].strip() for f in d.get('fields') or [] if f.get('field_id') in {c['id'] for c in meta['custom_fields'] if c['name'] == 'Remark'} and f.get('value')), None)
        T[tid] = {'id': tid, 'name': r['name'].strip(), 'url': r['url'], 'status': st, 'kind': kind,
                  'list_id': r['list']['id'], 'list': lists[r['list']['id']].strip(),
                  'parent': d.get('parent') if d.get('parent') in by else None, 'parent_raw': d.get('parent'),
                  'assignees': [a['username'] for a in r.get('assignees') or []],
                  'due': ms_date(d.get('due'), tz), 'start': ms_date(d.get('start'), tz),
                  'created': ms_iso(d.get('created'), tz), 'updated': ms_iso(d.get('updated'), tz), 'done_at': ms_iso(d.get('done') or d.get('closed'), tz),
                  'desc': (d.get('txt') or '').strip(), 'remark': remark, 'priority': r.get('priority'),
                  'time_est': d.get('est'), 'time_spent': d.get('spent'), 'children': []}
    for t in T.values():
        if t['parent']: T[t['parent']]['children'].append(t['id'])
    for t in T.values():                             # ลำดับงานย่อย: กำหนดส่ง (ไม่มีกำหนดไว้ท้าย) แล้ววันสร้าง
        t['children'].sort(key=lambda c: (T[c]['due'] is None, T[c]['due'] or '', T[c]['created'] or ''))
    # depth + root (recursive, ตรวจวงวน)
    def chain(tid):
        seen, c = [], tid
        while c:
            if c in seen: raise SystemExit('พบ parent วนซ้ำที่งาน ' + tid)
            seen.append(c); c = T[c]['parent']
        return seen
    for t in T.values():
        ch = chain(t['id']); t['depth'] = len(ch) - 1; t['root'] = ch[-1]
    return T


def descendants(T, tid):
    out = []
    for c in T[tid]['children']: out += [c] + descendants(T, c)
    return out


def leaf_progress(T, roots):
    """สัดส่วนงานย่อยเสร็จ = งานย่อยระดับล่างสุดที่ complete ÷ (งานย่อยระดับล่างสุด − cancelled) · ไม่มีงานย่อย → None"""
    leaves = [x for r in roots for x in descendants(T, r) if not T[x]['children']]
    if not leaves: return {'leaves': 0, 'done': 0, 'cancelled': 0, 'open': 0, 'pct': None}
    done = sum(1 for x in leaves if T[x]['kind'] == DONE); canc = sum(1 for x in leaves if T[x]['kind'] == CLOSED)
    base = len(leaves) - canc
    return {'leaves': len(leaves), 'done': done, 'cancelled': canc, 'open': base - done, 'pct': (done / base * 100) if base else None}


def investments(snap):
    """รายการลงทุน TRCLOUD ระดับ PO (หรือเอกสาร AP/EXP เมื่อไม่มี PO) จากบัญชี 1701xxx — แยกยอดแต่ละฐาน ไม่บวกรวมกัน"""
    inv = {}
    def get(key):
        return inv.setdefault(key, {'inv_id': 'INV-' + key, 'company': 'PSG', 'po': None, 'docs': [], 'vendors': [], 'accs': [], 'desc': None,
                                    'po_amt': None, 'po_lines': 0, 'po_status': [], 'po_backlog': None, 'booked_amt': None, 'booked_lines': 0, 'src': [],
                                    'first': None, 'last': None, 'budget': None, 'received': None, 'paid': None})
    for p in snap.get('po', []):
        if not p['acc'].startswith('1701'): continue
        it = get(p['doc']); it['po'] = p['doc']
        it['po_amt'] = (it['po_amt'] or 0) + (p['amt'] or 0); it['po_lines'] += 1
        if p.get('backlog') is not None: it['po_backlog'] = (it['po_backlog'] or 0) + p['backlog']
        for k, v in (('po_status', p['status']), ('vendors', p['vendor']), ('accs', p['acc'])):
            if v and v not in it[k]: it[k].append(v)
        it['desc'] = it['desc'] or p['name']; it['first'] = min(filter(None, [it['first'], p['date']]))
    for c in snap.get('cip', []):
        key = c.get('po') or c['doc']
        it = get(key)
        if c.get('po'): it['po'] = c['po']
        it['booked_amt'] = (it['booked_amt'] or 0) + (c['amt'] or 0); it['booked_lines'] += 1
        for k, v in (('docs', c['doc']), ('vendors', c['vendor']), ('accs', c['acc']), ('src', c['src'])):
            if v and v not in it[k]: it[k].append(v)
        it['desc'] = it['desc'] or c['name']
        it['first'] = min(filter(None, [it['first'], c['date']])); it['last'] = max(filter(None, [it['last'], c['date']]))
        c['inv_id'] = it['inv_id']
    return inv


def apply_links(inv, links, items_by_id, checks):
    """สถานะ mapping: confirmed (ต้องมีผู้ยืนยัน+วันที่) / proposed / not_project / unlinked · รองรับหลายต่อหลาย"""
    for it in inv.values(): it['links'] = []
    bad = 0
    for l in links:
        key = l.get('inv_id') or ('INV-' + l['doc'] if l.get('doc') else None)
        target = inv.get((key or '')[4:]) if key else None
        if not target:
            target = next((i for i in inv.values() if l.get('doc') and (l['doc'] == i['po'] or l['doc'] in i['docs'])), None)
        if not target: checks.append(('warn', f'ลิงก์ mapping อ้างรายการลงทุนที่ไม่พบในข้อมูลช่วงนี้: {key or l.get("doc")}')); continue
        rel = l.get('relation')
        if rel == 'confirmed' and not (l.get('confirmed_by') and l.get('confirmed_at')):
            rel = 'proposed'; bad += 1                     # ไม่มีผู้ยืนยัน → ถือเป็นข้อเสนอ
        if rel not in ('confirmed', 'proposed', 'not_project'): rel = 'proposed'
        if l.get('project_id') and l['project_id'] not in items_by_id and rel != 'not_project':
            checks.append(('warn', f'ลิงก์อ้าง Project ID ที่ไม่มีในทะเบียน: {l["project_id"]}'))
        target['links'].append({'project_id': l.get('project_id'), 'task': l.get('clickup_task_id'), 'relation': rel, 'pct': l.get('allocation_pct'),
                                'amount': l.get('allocation_amount'), 'reason': l.get('reason'), 'by': l.get('confirmed_by'), 'at': l.get('confirmed_at')})
    if bad: checks.append(('warn', f'ลิงก์ที่ตั้ง confirmed แต่ไม่มีผู้ยืนยัน/วันที่ {bad} รายการ — ถือเป็น "เสนอให้ตรวจสอบ"'))
    for it in inv.values():
        rels = {x['relation'] for x in it['links']}
        it['map'] = 'confirmed' if 'confirmed' in rels else 'proposed' if 'proposed' in rels else 'not_project' if rels == {'not_project'} else 'unlinked'
        it['projects'] = sorted({x['project_id'] for x in it['links'] if x['project_id'] and x['relation'] in ('confirmed', 'proposed')})


def alloc(it, link, base):
    if base is None: return None
    if link.get('amount') is not None: return int(round(float(link['amount']) * 100))
    if link.get('pct') is not None: return int(round(base * float(link['pct']) / 100))
    return base


def build(snap, raw_dir=RAW_CU, intake=INTAKE):
    meta, by, detail, lists, checks, pg = load_clickup(raw_dir)
    tz = tz_of(meta['user'].get('utc_offset'))
    now = datetime.datetime.fromisoformat(meta['user']['current_time'])
    today = now.astimezone(tz).date().isoformat()
    T = build_tasks(meta, by, detail, lists, tz)
    reg = load_json(os.path.join(intake, 'project_registry.json'), {'items': [], 'task_roles': {}, 'project_types': [], 'settings': {}})
    links = (load_json(os.path.join(intake, 'project_links.json'), {'links': []}) or {}).get('links', [])
    roles = reg.get('task_roles', {}); ptypes = set(reg.get('project_types') or ['investment_delivery', 'feasibility_development', 'regulatory_approval'])
    stale_days = (reg.get('settings') or {}).get('stale_days', 60)

    # ---------- registry → items ----------
    items, owner_of = [], {}
    for it in reg['items']:
        it = dict(it)
        if it.get('status') == 'confirmed' and not (it.get('confirmed_by') and it.get('confirmed_at')):
            it['status'] = 'proposed'; checks.append(('warn', f'{it["project_id"]} ตั้ง confirmed แต่ไม่มีผู้ยืนยัน/วันที่ — แสดงเป็น proposed'))
        if it.get('status') not in ('confirmed', 'proposed'): it['status'] = 'proposed'
        it['clickup_tasks'] = [t for t in it.get('clickup_tasks', []) if t in T]
        missing = set(it.get('clickup_tasks', [])) - set(T)
        if missing: checks.append(('warn', f'{it["project_id"]} อ้าง Task ที่ไม่พบแล้ว: {", ".join(missing)}'))
        for t in it['clickup_tasks']:
            if t in owner_of: checks.append(('warn', f'Task {t} อยู่ในทะเบียนมากกว่าหนึ่งรายการ ({owner_of[t]}, {it["project_id"]})'))
            owner_of.setdefault(t, it['project_id'])
        items.append(it)
    # งานหลักที่ยังไม่อยู่ในทะเบียน → รอจำแนก (ไม่สร้างโครงการอัตโนมัติ)
    for t in sorted(T.values(), key=lambda x: x['created'] or ''):
        if t['depth'] == 0 and t['id'] not in owner_of:
            pid = 'AUTO-' + t['id']
            items.append({'project_id': pid, 'name': t['name'], 'type': 'needs_review', 'stage': 'ยังไม่จำแนก', 'clickup_tasks': [t['id']], 'clickup_lists': [],
                          'parent_project': None, 'owner': None, 'status': 'unclassified', 'confirmed_by': None, 'confirmed_at': None,
                          'reason': 'งานหลักใหม่ใน ClickUp ที่ยังไม่อยู่ในทะเบียนโครงการ', 'evidence': [], 'physical_progress': None, 'outcome': None})
            owner_of[t['id']] = pid
    item_of_task = {}
    for t in T.values():
        r = t['id']
        while r and r not in owner_of: r = T[r]['parent']
        item_of_task[t['id']] = owner_of.get(r)
        t['item'] = item_of_task[t['id']]
        rl = roles.get(t['id']) or {}
        t['role'] = rl.get('role'); t['role_label'] = rl.get('label'); t['role_note'] = rl.get('note') or rl.get('outcome_note')
        t['outcome_kind'] = rl.get('outcome_kind')
        t['open'] = t['kind'] == 'open'
        t['overdue'] = bool(t['open'] and t['due'] and t['due'] < today)
        t['days_since_update'] = (now.astimezone(tz).date() - datetime.date.fromisoformat(t['updated'][:10])).days if t['updated'] else None
        flags = []
        if re.search(r'อนุมัติ', t['name']) and not rl.get('outcome_confirmed'):
            flags.append('ชื่องานมีคำว่า "อนุมัติ" — ไม่ใช่หลักฐานว่าอนุมัติจริง' + (' (สถานะยัง ' + t['status'] + ')' if t['open'] else ' · ต้องมีเอกสารผลพิจารณา'))
        if t['role'] == 'submission' and t['kind'] == DONE:
            flags.append('ขั้นยื่นเอกสารเสร็จ ≠ คำขอได้รับอนุมัติ' + (' · ' + t['role_note'] if t['role_note'] else ''))
        if t['role'] == 'decision' and t['open']: flags.append('รอผลพิจารณา — ยังไม่ยืนยันผล')
        if t['role'] == 'milestone' and t['kind'] == DONE and t['role_label']: flags.append('Milestone เสร็จ — ผลทางธุรกิจยังไม่ยืนยัน')
        t['flags'] = flags

    # ---------- TRCLOUD ----------
    inv = investments(snap)
    ib = {i['project_id']: i for i in items}
    apply_links(inv, links, ib, checks)
    for c in snap.get('cip', []):
        i = inv.get(c['inv_id'][4:]); c['map'] = i['map']; c['projects'] = ', '.join(i['projects']) or '–'

    # ---------- metrics ต่อ item ----------
    for it in items:
        roots = list(it['clickup_tasks'])
        if not roots and it.get('clickup_lists'):    # List เป็นแหล่งรวบรวมงาน: งานหลักใน List ที่ไม่อยู่ item อื่นเท่านั้น
            roots = [t['id'] for t in T.values() if t['depth'] == 0 and t['list_id'] in it['clickup_lists'] and item_of_task[t['id']] == it['project_id']]
        allt = [x for r in roots for x in [r] + descendants(T, r)]
        it['roots'] = roots; it['task_ids'] = allt
        it['is_project'] = it['type'] in ptypes
        it['n_tasks'] = len(allt); it['n_sub'] = len(allt) - len(roots)
        it['main_status'] = T[roots[0]]['status'] if len(roots) == 1 else (', '.join(sorted({T[r]['status'] for r in roots})) if roots else None)
        it['due'] = max([T[r]['due'] for r in roots if T[r]['due']], default=None)
        it['owner'] = it.get('owner') or (', '.join(sorted({a for r in roots for a in T[r]['assignees']})) or None)
        it['updated'] = max([T[x]['updated'] for x in allt if T[x]['updated']], default=None)
        it['sub'] = leaf_progress(T, roots)
        it['overdue'] = sum(1 for x in allt if T[x]['overdue'])
        it['nodue'] = sum(1 for x in allt if not T[x]['due'])
        cand = [T[x] for x in allt if T[x]['open'] and not T[x]['children']]
        cand.sort(key=lambda t: (t['due'] is None, t['due'] or '', t['created'] or ''))
        it['next'] = {'id': cand[0]['id'], 'name': cand[0]['name'], 'due': cand[0]['due'], 'url': cand[0]['url']} if cand else None
        it['url'] = T[roots[0]]['url'] if len(roots) == 1 else None
        pp = it.get('physical_progress')
        it['physical'] = pp if isinstance(pp, dict) and pp.get('pct') is not None and pp.get('confirmed_by') else None
        fin = {'confirmed_booked': 0, 'confirmed_po': 0, 'proposed_n': 0, 'confirmed_n': 0}
        for i in inv.values():
            for l in i['links']:
                if l['project_id'] != it['project_id']: continue
                if l['relation'] == 'confirmed':
                    fin['confirmed_n'] += 1
                    fin['confirmed_booked'] += alloc(i, l, i['booked_amt']) or 0; fin['confirmed_po'] += alloc(i, l, i['po_amt']) or 0
                elif l['relation'] == 'proposed': fin['proposed_n'] += 1
        it['fin'] = fin

    # ---------- insights (มีหลักฐาน + ลิงก์ต้นทาง · ไม่ให้คะแนน ไม่กล่าวโทษ) ----------
    ins = []
    def add(kind, text, ids): ins.append({'kind': kind, 'text': text, 'tasks': [{'id': i, 'name': T[i]['name'], 'url': T[i]['url']} for i in ids if i in T]})
    for t in T.values():
        p = T[t['parent']] if t['parent'] else None
        if p and t['due'] and p['due'] and t['due'] > p['due']:
            add('date_mismatch', f'กำหนดส่งงานย่อย ({t["due"]}) หลังกำหนดงานแม่ ({p["due"]})', [t['id'], p['id']])
        if p and p['kind'] == DONE and t['open']: add('parent_done_child_open', 'งานแม่ complete แต่งานย่อยยังเปิดอยู่', [p['id'], t['id']])
    for t in T.values():
        ch = descendants(T, t['id'])
        if ch and t['open'] and all(T[c]['kind'] in (DONE, CLOSED) for c in ch): add('children_done_parent_open', 'งานย่อยปิดครบแล้ว แต่งานแม่ยังเปิดอยู่', [t['id']])
    od = sorted([t for t in T.values() if t['overdue']], key=lambda t: t['due'])
    if od: add('overdue', f'งานยังไม่เสร็จที่เลยกำหนดส่งตามข้อมูล ClickUp {len(od)} รายการ (ณ {today})', [t['id'] for t in od])
    nd = [t for t in T.values() if not t['due'] and t['open']]
    if nd: add('nodue', f'งานที่ยังเปิดอยู่แต่ไม่มีกำหนดส่ง {len(nd)} รายการ', [t['id'] for t in nd])
    stl = [t for t in T.values() if t['open'] and t['days_since_update'] is not None and t['days_since_update'] > stale_days]
    if stl: add('stale', f'งานที่ยังเปิดและไม่มีการอัปเดตใน ClickUp เกิน {stale_days} วัน {len(stl)} รายการ — ควรตรวจว่าสถานะยังเป็นปัจจุบัน', [t['id'] for t in stl])
    ms = [t for t in T.values() if t['kind'] == DONE and (t['role'] in ('submission', 'milestone'))]
    if ms: add('milestone_unconfirmed', 'Milestone/ขั้นยื่นเอกสาร complete แต่ผลทางธุรกิจยังไม่ยืนยัน', [t['id'] for t in ms])
    un = [i for i in inv.values() if i['map'] == 'unlinked']
    if un: ins.append({'kind': 'inv_unlinked', 'text': f'รายการลงทุน TRCLOUD (บัญชี 1701xxx) ที่ยังไม่ระบุโครงการ {len(un)} รายการ', 'tasks': [], 'inv': [i['inv_id'] for i in un]})
    nofin = [it for it in items if it['is_project'] and not it['fin']['confirmed_n']]
    if nofin: ins.append({'kind': 'project_no_fin', 'text': f'รายการประเภทโครงการที่ยังไม่มีงบหรือหลักฐานค่าใช้จ่ายเชื่อม {len(nofin)} รายการ', 'tasks': [], 'items': [it['project_id'] for it in nofin]})

    # ---------- ตัวเลขตรวจสอบ ----------
    tops = [t for t in T.values() if t['depth'] == 0]
    from collections import Counter
    sc = Counter(t['status'] for t in T.values())
    checks.append(('pass', f'งานหลัก (parent=null) {len(tops)} · งานย่อย {len(T) - len(tops)} · ลึกสุด {max(t["depth"] for t in T.values()) + 1} ชั้น · สถานะ ' + ', '.join(f'{k} {v}' for k, v in sorted(sc.items()))))
    checks.append(('pass', f'ไม่มีกำหนดส่ง {sum(1 for t in T.values() if not t["due"])} รายการ · Time Estimate/Time Spent มีค่า {sum(1 for t in T.values() if t["time_est"] or t["time_spent"])} รายการ → ไม่คำนวณ Utilization'))
    bk = sum(i['booked_amt'] or 0 for i in inv.values()); ck = sum(c['amt'] or 0 for c in snap.get('cip', []))
    checks.append(('pass' if bk == ck else 'warn', f'ยอดบันทึกสินทรัพย์ 1701xxx รวมตามรายการลงทุน = ยอดตารางเดิม ({bk / 100:,.2f} บาท)' if bk == ck else f'ยอดรวมรายการลงทุนไม่เท่าตารางเดิม {bk} ≠ {ck}'))
    checks.append(('pass', f'รายการลงทุน {len(inv)} รายการ · ยืนยันแล้ว {sum(1 for i in inv.values() if i["map"] == "confirmed")} · เสนอ {sum(1 for i in inv.values() if i["map"] == "proposed")} · ยังไม่เชื่อม {len(un)} · ไม่เกี่ยวกับโครงการ {sum(1 for i in inv.values() if i["map"] == "not_project")}'))
    if any(it['status'] == 'confirmed' for it in items): pass
    else: checks.append(('warn', 'ยังไม่มีรายการในทะเบียนที่ผู้รับผิดชอบยืนยัน — การจำแนกทั้งหมดเป็นข้อเสนอ (proposed)'))

    lists_used = {t['list_id'] for t in T.values()}
    empty_lists = [{'id': k, 'name': v.strip()} for k, v in lists.items() if k not in lists_used]
    return {
        'meta': {'source': 'ClickUp MCP (อ่านอย่างเดียว) · PSG Space ' + SPACE_ID, 'fetched_at': meta['user']['current_time'], 'today': today,
                 'tz': meta['user'].get('timezone'), 'pages': pg['pages'], 'rows_raw': pg['rows'], 'dup': pg['dup'],
                 'date_rule': 'วันที่แบบไม่มีเวลาของ ClickUp แปลงด้วยเขตเวลาผู้ใช้ แล้วถอย 1 ms (ค่าที่เก็บเป็น 00:00 ของวันถัดไป)',
                 'stale_days': stale_days, 'registry_version': reg.get('version'), 'empty_lists': empty_lists,
                 'trcloud_asof': snap.get('meta', {}).get('asof'), 'trcloud_built': snap.get('meta', {}).get('built')},
        'tasks': list(T.values()), 'items': items, 'investments': sorted(inv.values(), key=lambda i: i['first'] or ''),
        'insights': ins, 'checks': [{'level': a, 'msg': b} for a, b in checks],
    }


if __name__ == '__main__':
    p = os.path.join(DATA, 'snapshot.json')
    snap = json.load(open(p, encoding='utf-8'))
    snap['projects'] = build(snap)
    json.dump(snap, open(p, 'w', encoding='utf-8'), ensure_ascii=False)
    P = snap['projects']
    print('ClickUp ณ', P['meta']['fetched_at'], '· งาน', len(P['tasks']), '· ทะเบียน', len(P['items']), '· รายการลงทุน', len(P['investments']))
    for c in P['checks']: print(' ', c['level'].upper(), c['msg'])
    for i in P['insights']: print('  •', i['text'])
