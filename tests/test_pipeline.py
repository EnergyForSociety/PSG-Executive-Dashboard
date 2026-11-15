"""ทดสอบ pipeline ของ PSG — รัน: python3 -m unittest tests/test_pipeline.py (ต้องมี raw/ และ data/maintenance.json ในเครื่อง)"""
import os, sys, json, re, unittest, subprocess, glob
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
import build_snapshot as B

class Parse(unittest.TestCase):
    def test_prod_month_thai_name(self):
        self.assertEqual(B.prod_month('ค่าไฟฟ้า ประจำเดือน เมษายน 2569\n( จำนวน 631,575 หน่วย )'), ('2026-04', 'thai_month_name'))
    def test_prod_month_mm_yy(self):
        self.assertEqual(B.prod_month('รายได้จากการขายไฟฟ้า 12/68-การไฟฟ้าส่วนภูมิภาค')[0], '2025-12')
    def test_prod_month_none(self):
        self.assertEqual(B.prod_month('ไม่มีเดือน'), (None, None))
    def test_kwh_from_text_only(self):
        self.assertEqual(B.parse_kwh('( จำนวน 1,234 หน่วย )')[0], 1234)
        self.assertIsNone(B.parse_kwh('quantity 1')[0])

class Snapshot(unittest.TestCase):
    @classmethod
    def setUpClass(cls): cls.S = B.build('2026-11-15')
    def test_no_balance_sheet_in_pnl(self):
        self.assertFalse([a for a in self.S['pnl']['accounts'] if a['acc'][0] in '123'])
    def test_pnl_identities(self):
        L = self.S['pnl']['lines']
        for m in self.S['meta']['pnl_months']:
            self.assertEqual(L['gp'][m], L['rev_sales'][m] - L['cos'][m])
            self.assertEqual(L['ebt'][m], L['ebitda'][m] - L['dep'][m] - L['int'][m])
            self.assertEqual(L['np'][m], L['ebt'][m] - L['tax'][m])
    def test_accounts_sum_to_groups(self):
        L = self.S['pnl']['lines']
        for g in ('rev_sales', 'cos', 'admin', 'dep', 'int'):
            for m in self.S['meta']['pnl_months']:
                self.assertEqual(L[g][m], sum(a['m'][m] for a in self.S['pnl']['accounts'] if a['group'] == g))
    def test_revenue_reversal_logic(self):
        """เดือนบัญชี M = ประมาณการ M + (จริง M−1 − ประมาณการ M−1) + รายการปรับปรุง (กลับรายการไม่ถูกนับซ้ำ)"""
        R, L = self.S['revenue'], self.S['pnl']['lines']['rev_sales']
        for m, p in (('2026-03', '2026-02'), ('2026-06', '2026-05'), ('2026-09', '2026-08')):
            exp = R[m]['est'] + R[p]['actual'] - R[p]['rev_reversal'] + R.get(m, {}).get('adj', 0)
            self.assertEqual(L[m], exp)
    def test_sales_bl_basis_not_doubled(self):
        s = self.S['sales']
        self.assertEqual(len(s), len({x['doc'] for x in s}))
        for x in s:
            if x['iv_amt'] is not None: self.assertEqual(x['iv_amt'], x['amt'])     # IV ใช้ติดตามชำระ ไม่บวกเพิ่ม
    def test_quantity_one_not_kwh(self):
        for x in self.S['sales']:
            if x['kwh'] is None: self.assertIsNone(x['price'])
            else: self.assertIn(str(f"{x['kwh']:,}"), x['kwh_src'])
    def test_ap_exp_balance_sheet_flag(self):
        for a in self.S['ap'] + self.S['ex']:
            self.assertEqual(a['bs'], a['acc'][:1] in ('1', '2', '3'))
    def test_cash_not_from_bank_register(self):
        self.assertTrue(any('ไม่ใช้สรุปเงินสด' in c['msg'] for c in self.S['checks']))
    def test_om_fee_not_hardcoded(self):
        for f in glob.glob(os.path.join(ROOT, 'scripts', '*.py')) + glob.glob(os.path.join(ROOT, 'web', '*.js')):
            self.assertNotIn('242990', open(f, encoding='utf-8').read().replace(',', ''), f)
    def test_no_real_doc_numbers_in_code(self):
        for f in glob.glob(os.path.join(ROOT, 'web', '*.js')) + glob.glob(os.path.join(ROOT, 'web', '*.html')):
            self.assertFalse(re.search(r'\b(?:BL|IV|RV|RR|PO|JV)\d{10}\b', open(f, encoding='utf-8').read()), f)

class Maintenance(unittest.TestCase):
    def test_reimport_same_file_idempotent(self):
        xl = glob.glob(os.path.join(ROOT, 'om', '*.xlsx'))
        if not xl: self.skipTest('ไม่มีไฟล์ใบงาน')
        hp = os.path.join(ROOT, 'data', 'maintenance_history.json')
        subprocess.run([sys.executable, os.path.join(ROOT, 'scripts', 'import_maintenance.py'), xl[0]], check=True, capture_output=True)
        n1 = len(json.load(open(hp))); r1 = len(json.load(open(os.path.join(ROOT, 'data', 'maintenance.json')))['rows'])
        subprocess.run([sys.executable, os.path.join(ROOT, 'scripts', 'import_maintenance.py'), xl[0]], check=True, capture_output=True)
        self.assertEqual(n1, len(json.load(open(hp)))); self.assertEqual(r1, len(json.load(open(os.path.join(ROOT, 'data', 'maintenance.json')))['rows']))
    def test_no_person_names_stored(self):
        d = json.load(open(os.path.join(ROOT, 'data', 'maintenance.json')))
        for r in d['rows']:
            for k in ('reporter', 'owner', 'comment'): self.assertNotIn(k, r)
    def test_done_times_only_for_done(self):
        d = json.load(open(os.path.join(ROOT, 'data', 'maintenance.json')))
        for r in d['rows']:
            if r['state'] != 'done': self.assertIsNone(r['done_at']); self.assertIsNone(r['min_done'])

if __name__ == '__main__': unittest.main()
