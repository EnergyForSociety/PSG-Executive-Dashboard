"""PSG Executive Dashboard — normalization + calculation → data/snapshot.json
ใช้: python3 scripts/build_snapshot.py [--asof YYYY-MM-DD]
แหล่ง: raw/ (ผลดิบจาก TRCloud MCP ของ PSG แบบอ่านอย่างเดียว + _manifest.json), data/maintenance.json, config/mapping.json
หลักการ
- เงินคำนวณด้วย Decimal แล้วเก็บเป็นสตางค์ (int) · เวลา Asia/Bangkok
- แยกฐาน: เดือนผลิต (BL/ข้อความค่าไฟ) ≠ วันที่ BL ≠ วันที่ IV ≠ งวดบัญชี (Ledger) ≠ วันรับชำระ
- รายได้/ยอดขายใช้ BL เป็นฐานเอกสาร ไม่บวก IV ซ้ำ · P&L ใช้ Ledger เท่านั้น ไม่บวก AP/EXP ซ้ำ
- บัญชีสินทรัพย์/หนี้สิน/ทุน ไม่เข้า P&L · ไม่มีข้อมูล = None (แสดง N/A) ไม่ใช่ศูนย์
- kWh อ่านจากข้อความ product_name เท่านั้น เก็บข้อความต้นฉบับ กฎ และสถานะยืนยัน · quantity=1 ไม่ใช่ kWh"""
import json, os, re, sys, glob, datetime, hashlib
from decimal import Decimal, ROUND_HALF_UP
from collections import defaultdict, OrderedDict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW, DATA, CFG = (os.path.join(ROOT, d) for d in ('raw', 'data', 'config'))
BKK = datetime.timezone(datetime.timedelta(hours=7))
TH_MONTH = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม']
KWH_RULE = r'\(\s*จำนวน\s*([\d,]+)\s*หน่วย\s*\)'
PMONTH_RULE_TEXT = r'ประจำเดือน\s*(<ชื่อเดือนไทย>)\s*(\d{4}) (พ.ศ.)'
PMONTH_RULE_NUM = r'(\d{1,2})/(\d{2}) (เดือน/ปี พ.ศ. 2 หลัก)'


def ws(t):
    return re.sub(r'\s+', ' ', (t or '').replace('\xa0', ' ')).strip()


def D(x):
    try: return Decimal(str(x)) if x not in (None, '') else None
    except Exception: return None


def sat(x):
    d = D(x)
    return None if d is None else int((d * 100).quantize(Decimal('1'), rounding=ROUND_HALF_UP))


def load_manifest():
    m = json.load(open(os.path.join(RAW, '_manifest.json'), encoding='utf-8'))
    for c in m['calls']:
        p = os.path.join(RAW, c['file'])
        c['data'] = json.load(open(p, encoding='utf-8')) if c.get('ok') and os.path.exists(p) else None
    return m['calls']


def rows_of(calls, tool):
    out = []
    for c in calls:
        if c['tool'] == tool and c['data']: out += c['data'].get('result') or []
    return out


def prod_month(text):
    """เดือนผลิตจากข้อความ → (YYYY-MM, rule) หรือ (None, None)"""
    t = text or ''
    m = re.search(r'ประจำเดือน\s*(' + '|'.join(TH_MONTH) + r')\s*(\d{4})', t)
    if m: return f'{int(m.group(2)) - 543}-{TH_MONTH.index(m.group(1)) + 1:02d}', 'thai_month_name'
    m = re.search(r'(?<![\d/])(\d{1,2})/(\d{2})(?![\d/])', t)
    if m and 1 <= int(m.group(1)) <= 12: return f'{2500 + int(m.group(2)) - 543}-{int(m.group(1)):02d}', 'mm_yy_be'
    return None, None


def parse_kwh(text):
    m = re.search(KWH_RULE, text or '')
    return (int(m.group(1).replace(',', '')), m.group(0)) if m else (None, None)


def build(asof):
    calls = load_manifest()
    cfg = json.load(open(os.path.join(CFG, 'mapping.json'), encoding='utf-8'))
    checks, notes = [], []

    # ---------- Ledger: รวมทุกหน้า (pagination) ต่อบัญชี ไม่ตัดรายการซ้ำเองเพราะ JV เดียวมีหลายบรรทัดยอดเท่ากันได้ ----------
    ledger, acc_name, pages = [], {}, defaultdict(list)
    for c in calls:
        if c['tool'] != 'get_ledger' or not c['data']: continue
        acc = c['params'].get('acc_code'); start = int(c['params'].get('start') or 0)
        pages[acc].append((start, len(c['data']['result'])))
        for r in c['data']['result']:
            if r['acc_code'] != acc: checks.append(('fail', f'Ledger {acc} มีบรรทัดบัญชีอื่น {r["acc_code"]}')); continue
            acc_name[acc] = r.get('acc_th') or acc
            ledger.append({'acc': acc, 'date': r['date'], 'ym': r['date'][:7], 'ref': r['ref_no'], 'dr': sat(r['dr']) or 0, 'cr': sat(r['cr']) or 0,
                           'note': ws(r.get('acc_note') or r.get('note1')), 'note1': ws(r.get('note1')), 'by': r.get('create_by')})
    incomplete = []
    for acc, ps in pages.items():
        ps.sort(); last = ps[-1]
        if last[1] >= 100: incomplete.append(acc)
    if incomplete: checks.append(('warn', 'Ledger อาจยังดึงไม่ครบหน้า (หน้าสุดท้ายเต็ม 100): ' + ', '.join(incomplete)))
    else: checks.append(('pass', f'Ledger ดึงครบทุกหน้า {len(pages)} บัญชี ({len(ledger)} บรรทัด)'))

    def group_of(acc):
        for g in cfg['pnl_groups']:
            if any(acc.startswith(p) for p in g['prefixes']) and not any(acc.startswith(x) for x in g.get('exclude_prefixes', [])): return g
        return None
    bad = sorted({l['acc'] for l in ledger if l['acc'][0] in '123'})
    checks.append(('pass' if not bad else 'fail', 'ไม่มีบัญชีสินทรัพย์/หนี้สิน/ทุนใน P&L' if not bad else 'พบบัญชีงบดุลใน P&L: ' + ', '.join(bad)))

    # งวด P&L: ม.ค. ถึงเดือนล่าสุดที่มีการคิดค่าเสื่อมราคา (ใช้เป็นสัญญาณว่าปิดรอบรายเดือนแล้วบางส่วน — ยังไม่ใช่การปิดบัญชีที่ยืนยัน)
    dep_months = sorted({l['ym'] for l in ledger if l['acc'].startswith('5309') and l['by'] == 'depreciation'})
    last_m = dep_months[-1] if dep_months else asof[:7]
    months = [f'2026-{i:02d}' for i in range(1, int(last_m[5:]) + 1)] if last_m.startswith('2026') else []
    after = sorted({l['ym'] for l in ledger if l['ym'] > last_m})

    acc_month = defaultdict(lambda: defaultdict(int))
    for l in ledger:
        g = group_of(l['acc'])
        if not g: continue
        v = (l['cr'] - l['dr']) if g['sign'] == 'credit' else (l['dr'] - l['cr'])
        acc_month[l['acc']][l['ym']] += v
    accounts = []
    for acc in sorted(acc_month):
        g = group_of(acc); vals = {m: acc_month[acc].get(m, 0) for m in months}
        if not any(vals.values()) and not any(acc_month[acc].values()): continue
        accounts.append({'acc': acc, 'name': acc_name.get(acc, acc), 'group': g['key'], 'm': vals, 'outside': {m: v for m, v in acc_month[acc].items() if m not in months}})
    G = {g['key']: {m: sum(a['m'][m] for a in accounts if a['group'] == g['key']) for m in months} for g in cfg['pnl_groups']}
    pnl = OrderedDict()
    for k in ('rev_sales', 'rev_other', 'cos', 'sell', 'admin', 'dep', 'int', 'tax'): pnl[k] = G[k]
    pnl['gp'] = {m: G['rev_sales'][m] - G['cos'][m] for m in months}
    pnl['ebitda'] = {m: G['rev_sales'][m] + G['rev_other'][m] - G['cos'][m] - G['sell'][m] - G['admin'][m] for m in months}
    pnl['ebt'] = {m: pnl['ebitda'][m] - G['dep'][m] - G['int'][m] for m in months}
    pnl['np'] = {m: pnl['ebt'][m] - G['tax'][m] for m in months}

    # ---------- รายได้ 4001000: ประมาณการ / กลับรายการ / รายได้จริง ต่อเดือนผลิต ----------
    rev = defaultdict(lambda: {'est': None, 'est_ref': None, 'rev_reversal': None, 'actual': None, 'actual_ref': None, 'actual_date': None, 'adj': 0})
    for l in [x for x in ledger if x['acc'].startswith('400')]:
        pm, _ = prod_month(l['note1'] or l['note'])
        txt = l['note1'] or l['note']
        if 'กลับประมาณการ' in txt and pm: rev[pm]['rev_reversal'] = l['dr'] - l['cr']
        elif 'ประมาณการรายได้' in txt and pm: rev[pm]['est'] = l['cr'] - l['dr']; rev[pm]['est_ref'] = l['ref']; rev[pm]['est_date'] = l['date']
        elif 'รายได้จากการขายไฟฟ้า' in txt and pm: rev[pm]['actual'] = l['cr'] - l['dr']; rev[pm]['actual_ref'] = l['ref']; rev[pm]['actual_date'] = l['date']
        else: rev[l['ym']]['adj'] += l['cr'] - l['dr']; notes.append(f'รายการปรับปรุงรายได้ {l["ref"]} {l["date"]}: {txt[:60]}')

    # ---------- BL (ฐานเอกสารยอดขาย) + IV/RV (การรับชำระ) ----------
    b3 = rows_of(calls, 'get_b3_service_bill_report'); iv3 = rows_of(calls, 'get_iv3_sales_report')
    iv_by_bl = defaultdict(list)
    for r in iv3:
        if r.get('product_id') or D(r['before_vat']): iv_by_bl[r['bl'] or r['reference']].append(r)
    sales = []
    for r in b3:
        if not D(r['before_vat']): continue          # บรรทัดหัวเอกสารยกยอดที่ไม่มียอด
        pm, rule = prod_month(r['product_name'])
        kwh, ksrc = parse_kwh(r['product_name'])
        ivs = iv_by_bl.get(r['document'], [])
        iv = ivs[0] if ivs else None
        amt = sat(r['before_vat'])
        sales.append({'doc': r['document'], 'kind': 'opening' if r['doc_type'].startswith('ยกยอด') else 'bl', 'bl_date': r['issue_date'], 'due': r['due_date'],
                      'pm': pm, 'pm_rule': rule, 'text': r['product_name'], 'customer': r['organization'], 'contract': (re.search(r'VSPP-[\w/-]+', r['product_name']) or [None])[0],
                      'qty_doc': r['quantity'], 'kwh': kwh, 'kwh_src': ksrc, 'kwh_rule': KWH_RULE if kwh else None, 'kwh_status': 'อ่านจากข้อความ — รอยืนยันกับมิเตอร์/บิล กฟภ.' if kwh else 'ไม่มีจำนวนหน่วยในข้อความ',
                      'amt': amt, 'vat': sat(r['vat']), 'grand': sat(r['after_vat']), 'bl_status': r['status'],
                      'iv': iv['document'] if iv else None, 'iv_date': iv['issue_date'] if iv else None, 'iv_status': iv['status'] if iv else None,
                      'iv_amt': sat(iv['before_vat']) if iv else None, 'iv_grand': sat(iv['after_vat']) if iv else None,
                      'price': float(D(r['before_vat']) / kwh) if kwh else None})
        if iv and sat(iv['before_vat']) != amt: checks.append(('warn', f'{r["document"]} ยอด BL ไม่เท่ายอด IV {iv["document"]}'))
        if pm and rev[pm]['actual'] is not None and rev[pm]['actual'] != amt: checks.append(('warn', f'เดือนผลิต {pm}: รายได้จริงใน Ledger ไม่เท่ายอด BL {r["document"]}'))
    sales.sort(key=lambda s: s['pm'] or '')
    q1 = [s for s in sales if s['qty_doc'] in ('1', 1) and s['kwh'] is None]
    checks.append(('pass', f'quantity=1 ไม่ถูกใช้เป็น kWh ({len(q1)} BL ไม่มี kWh ในข้อความ → แสดง N/A)'))
    for s in sales:
        r = rev.get(s['pm']) if s['pm'] else None
        s['ledger_actual'] = r['actual'] if r else None; s['ledger_est'] = r['est'] if r else None
    # ยอดรับชำระ: IV สถานะ Cash = รับเงินแล้วตามสถานะเอกสาร (วันที่ IV ใช้แทนวันเงินเข้าจนกว่าจะมี bank statement)
    coll = [{'doc': s['iv'], 'date': s['iv_date'], 'bl': s['doc'], 'pm': s['pm'], 'grand': s['iv_grand'], 'status': s['iv_status']} for s in sales if s['iv']]
    ar_open = [s for s in sales if not s['iv'] and s['bl_status'] in ('Debtor', 'Partial', 'Billing Note')]
    rdue = rows_of(calls, 'get_receivable_due')

    # รายเดือนผลิต (ฐานผลิต) — รายได้จริงจาก BL หรือ ประมาณการจาก Ledger ถ้ายังไม่มี BL
    pms = sorted(set([s['pm'] for s in sales if s['pm']] + [m for m in rev if rev[m]['est'] is not None and m >= '2025-11']))
    prod = []
    for m in pms:
        s = next((x for x in sales if x['pm'] == m), None); r = rev.get(m, {})
        prod.append({'pm': m, 'kwh': s['kwh'] if s else None, 'bl': s['doc'] if s else None, 'bl_amt': s['amt'] if s else None,
                     'est': r.get('est'), 'actual': r.get('actual'), 'basis': 'BL' if s else 'ประมาณการใน Ledger',
                     'price': s['price'] if s else None, 'est_var': (r['actual'] - r['est']) if r.get('actual') is not None and r.get('est') is not None else None})

    # ---------- ต้นทุนวัตถุดิบ/ดำเนินการ 5101000 จัดหมวดจากข้อความ ----------
    rules = [(x['key'], x['label'], re.compile(x['pattern'])) for x in cfg['material_rules']['rules'] if x['pattern']]
    def mcat(t):
        for k, lab, rx in rules:
            if rx.search(t): return k
        return 'other'
    mat_lines = []
    for l in [x for x in ledger if x['acc'] == '5101000']:
        t = l['note'] + ' ' + l['note1']
        est = 'กลับประมาณการ' in t and 'rev' or ('ประมาณการ' in t and 'est' or 'act')
        mat_lines.append({'date': l['date'], 'ym': l['ym'], 'ref': l['ref'], 'cat': mcat(t), 'kind': est, 'net': l['dr'] - l['cr'], 'note': l['note'][:140]})
    mat_cats = [{'key': x['key'], 'label': x['label']} for x in cfg['material_rules']['rules']]
    om = sorted({(l['ym'], l['dr']) for l in ledger if l['acc'] == '5101000' and 'ควบคุมและบำรุงรักษา' in (l['note'] + l['note1']) and l['dr']})
    om_check = {'months': [m for m, _ in om], 'amounts': sorted({a for _, a in om}), 'rule': 'ค้นจากข้อความ "ควบคุมและบำรุงรักษา" ในบัญชี 5101000 — ไม่ได้กำหนดยอดตายตัวในโค้ด'}

    # ---------- ซ่อมบำรุง (มุมมองบัญชีที่อยู่ใน P&L แล้ว ไม่บวกซ้ำ) ----------
    macc = cfg['maintenance_accounts']
    maint_ledger = []
    for l in [x for x in ledger if x['acc'] in macc]:
        t = l['note'] + ' ' + l['note1']
        kind = 'est' if 'ประมาณการ' in t else 'reclass' if re.search(r'ปป\.|ปรับปรุง|Reclass', t, re.I) else 'act'
        flag = 'ข้อความเป็นภาษีที่ดิน แต่ลงบัญชีซ่อมแซม — ให้บัญชีตรวจ' if 'ภาษีที่ดิน' in t else None
        maint_ledger.append({'date': l['date'], 'ym': l['ym'], 'acc': l['acc'], 'ref': l['ref'], 'kind': kind, 'net': l['dr'] - l['cr'], 'note': l['note'][:140], 'flag': flag})
    flagged = [x for x in maint_ledger if x['flag']]
    if flagged: checks.append(('warn', f'บัญชีซ่อมบำรุงมี {len(flagged)} บรรทัดที่ข้อความไม่ตรงประเภทค่าใช้จ่าย (เช่น ภาษีที่ดิน) — แสดงในหน้า Maintenance'))

    # ---------- จัดซื้อ: PO (ภาระผูกพัน) / AP (P5) / EXP (X3) แยกฐาน ----------
    po = [{'doc': r['document'], 'date': r['issue_date'], 'vendor': r['organization'], 'status': r['status'], 'pr': r.get('pr') or '', 'acc': r.get('product_id') or '',
           'name': re.sub(r'\s+', ' ', r['product_name'] or '')[:120], 'amt': sat(r['before_vat']), 'backlog': sat(r.get('backlog_ap')) if D(r.get('backlog_ap')) is not None else None,
           'status_ap': r.get('status_ap')} for r in rows_of(calls, 'get_po3_purchase_order_report')]
    ap = [{'doc': r['document'], 'date': r['issue_date'], 'vendor': r['organization'], 'acc': r.get('product_id') or '', 'name': re.sub(r'\s+', ' ', r['product_name'] or '')[:120],
           'amt': sat(r['before_vat']), 'vat': sat(r['vat']), 'po': r.get('po') or '', 'status': r['status']} for r in rows_of(calls, 'get_p5_purchase_report')]
    ex = [{'doc': r['document'], 'date': r['issue_date'], 'vendor': r['organization'] or r.get('vendor') or '', 'acc': r.get('acc_code') or '', 'acc_name': r.get('acc_th') or '',
           'name': re.sub(r'\s+', ' ', r.get('description') or '')[:120], 'amt': sat(r['before_vat']), 'status': r['status']} for r in rows_of(calls, 'get_x3_expense_report')]
    for a in ap + ex: a['bs'] = a['acc'][:1] in ('1', '2', '3')     # บรรทัดงบดุล (สินทรัพย์/หนี้สิน) — ไม่ใช่ค่าใช้จ่าย
    cip = [dict(a, src='AP') for a in ap if a['acc'].startswith('1701')] + [dict(a, src='EXP') for a in ex if a['acc'].startswith('1701')]
    pay = [{'doc': r['document'], 'conv': r['conversion'], 'vendor': r['organization'], 'type': r['contact_type'], 'date': r['issue_date'], 'due': r['due_date'],
            'overdue': int(r['overdue'] or 0), 'amount': sat(r['amount']), 'opening': r['doc_type'] == 'ยกยอด', 'ref': r['reference'] or '', 'status': r['status']}
           for r in rows_of(calls, 'get_payable_due')]
    banks = rows_of(calls, 'search_bank')

    # ---------- ซ่อมบำรุง: ใบงาน ----------
    mp = os.path.join(DATA, 'maintenance.json')
    maint = json.load(open(mp, encoding='utf-8')) if os.path.exists(mp) else None
    wo_text = ' '.join(p['name'] + ' ' + p['pr'] for p in po) + ' '.join(a['name'] for a in ap)
    links = []
    if maint:
        for w in maint['rows']:
            if w['wo'] and w['wo'] in wo_text: links.append({'wo': w['wo'], 'basis': 'อ้างเลขใบงานในเอกสารจัดซื้อ', 'status': 'รอผู้ยืนยัน'})
    lp = os.path.join(CFG, 'wo_po_links.json')
    confirmed = json.load(open(lp, encoding='utf-8')) if os.path.exists(lp) else []

    # ---------- ตรวจความสอดคล้อง ----------
    tot_bl = sum(s['amt'] for s in sales if s['kind'] == 'bl')
    checks.append(('pass', f'ยอดขายใช้ BL {len([s for s in sales if s["kind"] == "bl"])} ใบ เป็นฐาน (IV/RV ใช้ติดตามรับชำระเท่านั้น ไม่บวกซ้ำ)'))
    checks.append(('pass', 'P&L มาจาก Ledger เท่านั้น — AP/EXP/PO แสดงแยก ไม่บวกเพิ่ม'))
    if any(a['bs'] for a in ap + ex): checks.append(('pass', f'AP/EXP ที่ลงบัญชีงบดุล {sum(1 for a in ap + ex if a["bs"])} บรรทัด ถูกแยกออกจากค่าใช้จ่าย'))
    bal0 = all(not D(b.get('balance')) for b in banks) if banks else True
    if bal0: checks.append(('warn', 'ยอดคงเหลือในทะเบียนธนาคาร (search_bank) เป็น 0 ทุกบัญชี — ไม่ใช้สรุปเงินสด'))
    dw = [c for c in calls if c['tool'] in ('get_balance_sheet', 'get_trial_balance') and not c['ok']]
    if dw: checks.append(('warn', 'API งบดุล/งบทดลองตอบ 402 (ต้องใช้แพ็กเกจ Data Warehouse) — ไม่มียอดเงินสดและยอดคงเหลือบัญชีงบดุล'))

    datasets = []
    for c in calls:
        datasets.append({'tool': c['tool'], 'params': {k: v for k, v in c['params'].items() if k in ('acc_code', 'date-from', 'date-to', 'start', 'date', 'note')},
                         'rows': c['rows'], 'ok': c['ok'], 'http': c.get('http'), 'fetched_at': c['fetched_at']})
    snap = {
        'meta': {'asof': asof, 'built': datetime.datetime.now(BKK).isoformat(timespec='seconds'), 'company': 'บริษัท พระแสงกรีน พาวเวอร์ จำกัด (PSG)',
                 'system': 'PSG Executive Dashboard', 'pnl_months': months, 'pnl_last': last_m, 'pnl_after': after,
                 'mapping_version': cfg['version'], 'material_rules': cfg['material_rules']['rules'], 'pnl_groups': [{k: g[k] for k in ('key', 'label', 'prefixes')} for g in cfg['pnl_groups']],
                 'kwh_rule': KWH_RULE, 'pm_rules': [PMONTH_RULE_TEXT, PMONTH_RULE_NUM]},
        'pnl': {'accounts': accounts, 'lines': pnl},
        'revenue': {m: v for m, v in sorted(rev.items())},
        'sales': sales, 'prod': prod, 'coll': coll, 'ar_open': ar_open, 'ar_due_api': len(rdue),
        'mat_lines': mat_lines, 'mat_cats': mat_cats, 'om_check': om_check,
        'maint_ledger': maint_ledger, 'maint_acc': {k: v for k, v in macc.items() if not k.startswith('_')},
        'po': po, 'ap': ap, 'ex': ex, 'cip': cip, 'pay': pay, 'banks': [{'name': b['bank_name'], 'acc': b['acc_code'], 'balance': sat(b.get('balance'))} for b in banks],
        'maint': maint, 'wo_links': {'suggested': links, 'confirmed': confirmed},
        'checks': [{'level': a, 'msg': b} for a, b in checks], 'notes': notes, 'datasets': datasets,
    }
    return snap


if __name__ == '__main__':
    asof = sys.argv[sys.argv.index('--asof') + 1] if '--asof' in sys.argv else datetime.datetime.now(BKK).date().isoformat()
    s = build(asof)
    os.makedirs(DATA, exist_ok=True)
    json.dump(s, open(os.path.join(DATA, 'snapshot.json'), 'w', encoding='utf-8'), ensure_ascii=False)
    L = s['pnl']['lines']; ms = s['meta']['pnl_months']
    print('P&L', ms[0], '–', ms[-1], '· รายได้ขาย', sum(L['rev_sales'].values()) / 100, '· กำไรก่อนภาษี', sum(L['ebt'].values()) / 100)
    print('BL', len(s['sales']), '· ใบงาน', len((s['maint'] or {}).get('rows', [])))
    for c in s['checks']: print(' ', c['level'].upper(), c['msg'])
