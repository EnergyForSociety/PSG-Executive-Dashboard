"""ทดสอบหน้าโครงการ (ClickUp + TRCLOUD) — รัน: python3 -m unittest tests/test_projects.py
ชุด Synthetic ใช้ข้อมูลสมมติในโฟลเดอร์ชั่วคราว (ไม่ต้องมีข้อมูลจริง) · ชุด RealData รันเมื่อมี raw/clickup และ data/snapshot.json ในเครื่อง"""
import os, sys, json, copy, tempfile, shutil, unittest, datetime
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
import build_projects as BP

BKK = datetime.timezone(datetime.timedelta(hours=7))
def ms(y, m, d, h=0):     # เวลา Bangkok → epoch ms (string แบบ ClickUp)
    return str(int(datetime.datetime(y, m, d, h, tzinfo=BKK).timestamp() * 1000))
LISTS = [{'id': 'L1', 'name': 'ขอ BOI'}, {'id': 'L2', 'name': 'PM'}, {'id': 'L3', 'name': 'การจ่ายเงินปันผล'}, {'id': 'L4', 'name': 'ว่าง'}]
META = {'hierarchy': {'workspace_id': 'W', 'space': {'id': BP.SPACE_ID, 'name': 'PSG'}, 'lists': LISTS, 'has_more': False},
        'user': {'timezone': 'Asia/Bangkok', 'current_time': '2026-11-21T05:49:05+07:00', 'utc_offset': '+07:00'},
        'statuses': [{'status': 'not started', 'type': 'open'}, {'status': 'in progress', 'type': 'custom'}, {'status': 'complete', 'type': 'done'}, {'status': 'cancelled', 'type': 'closed'}],
        'custom_fields': [{'id': 'RF', 'name': 'Remark', 'type': 'text'}], 'calls': []}
# BOI 4 ชั้น: A → (B ยกเลิก, C รอบใหม่) ; C → (C1 ยื่น complete, C2 อนุมัติ in progress) ; C2 → (C2a, C2b)
TASKS = [  # id, name, status, list, parent, due(ms), updated
    ('A', 'ขอรับการส่งเสริมการลงทุน (BOI)', 'in progress', 'L1', None, ms(2027, 4, 1), ms(2026, 7, 10)),
    ('B', 'ยกเลิกบัตรเดิม', 'in progress', 'L1', 'A', ms(2026, 12, 1), ms(2026, 9, 16)),
    ('B1', 'ยื่นขอยกเลิกบัตรเดิม', 'complete', 'L1', 'B', ms(2026, 6, 17), ms(2026, 7, 18)),
    ('C', 'ขอรับการส่งเสริม รอบใหม่', 'in progress', 'L1', 'A', ms(2027, 4, 1), ms(2026, 7, 10)),
    ('C1', 'ยื่นเอกสาร ครั้งที่ 1', 'complete', 'L1', 'C', ms(2026, 9, 1), ms(2026, 9, 2)),
    ('C2', 'BOI อนุมัติให้การส่งเสริม (บัตรใหม่)', 'in progress', 'L1', 'C', ms(2027, 4, 1), ms(2026, 7, 18)),
    ('C2a', 'ยื่นตอบรับมติ', 'not started', 'L1', 'C2', None, ms(2026, 7, 18)),
    ('C2b', 'ยื่นขอรับบัตร', 'cancelled', 'L1', 'C2', None, ms(2026, 7, 18)),
    ('PM', 'การทำ PM เครื่องจักร', 'not started', 'L2', None, None, ms(2026, 7, 15)),
    ('DV', 'กำหนดชำระเงินปันผล', 'in progress', 'L3', None, ms(2026, 9, 1), ms(2026, 7, 20)),
    ('MT', 'ประชุม BOD', 'in progress', 'L3', None, None, ms(2026, 11, 20)),
    ('NEW', 'งานใหม่ที่ยังไม่จำแนก', 'not started', 'L1', None, ms(2026, 11, 21, 10), ms(2026, 11, 20)),
]
REG = {'version': 't', 'project_types': ['investment_delivery', 'feasibility_development', 'regulatory_approval'], 'settings': {'stale_days': 60},
       'items': [{'project_id': 'P-BOI', 'name': 'BOI', 'type': 'regulatory_approval', 'clickup_tasks': ['A'], 'status': 'confirmed', 'confirmed_by': None, 'confirmed_at': None},
                 {'project_id': 'O-PM', 'name': 'PM', 'type': 'recurring_operation', 'clickup_tasks': ['PM'], 'status': 'proposed'},
                 {'project_id': 'G-DV', 'name': 'ปันผล', 'type': 'corporate_governance', 'clickup_tasks': ['DV', 'MT'], 'status': 'proposed'}],
       'task_roles': {'B1': {'role': 'submission', 'label': 'ยื่น'}, 'C1': {'role': 'submission', 'label': 'ยื่น 1', 'outcome_note': 'ถูกตีกลับ', 'outcome_kind': 'returned'}, 'C2': {'role': 'decision', 'label': 'ผล'}}}
SNAP = {'meta': {'asof': '2026-11-15'},
        'po': [{'doc': 'PO1', 'date': '2026-01-01', 'vendor': 'V1', 'status': 'Partial', 'acc': '1701010', 'name': 'งาน 1', 'amt': 100000, 'backlog': 30000},
               {'doc': 'PO1', 'date': '2026-01-01', 'vendor': 'V1', 'status': 'Partial', 'acc': '1701010', 'name': 'งาน 1b', 'amt': 50000, 'backlog': 0},
               {'doc': 'PO2', 'date': '2026-02-01', 'vendor': 'V2', 'status': 'New', 'acc': '1701004', 'name': 'งาน 2', 'amt': 70000, 'backlog': 70000},
               {'doc': 'PO9', 'date': '2026-02-01', 'vendor': 'V9', 'status': 'New', 'acc': '5101000', 'name': 'ค่าใช้จ่าย', 'amt': 999, 'backlog': 0}],
        'cip': [{'date': '2026-03-01', 'doc': 'RR1', 'src': 'AP', 'vendor': 'V1', 'acc': '1701010', 'name': 'งาน 1', 'po': 'PO1', 'amt': 80000},
                {'date': '2026-04-01', 'doc': 'RR2', 'src': 'AP', 'vendor': 'V1', 'acc': '1701010', 'name': 'งาน 1b', 'po': 'PO1', 'amt': 40000},
                {'date': '2026-05-01', 'doc': 'RR3', 'src': 'EXP', 'vendor': 'V3', 'acc': '1701010', 'name': 'ไม่มี PO', 'po': None, 'amt': 25000}]}


class Synthetic(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp(); self.raw = os.path.join(self.d, 'raw'); self.intake = os.path.join(self.d, 'intake')
        os.makedirs(self.raw); os.makedirs(self.intake)
        self.write_raw(TASKS)
        json.dump(REG, open(os.path.join(self.intake, 'project_registry.json'), 'w'))
        json.dump({'links': []}, open(os.path.join(self.intake, 'project_links.json'), 'w'))
    def tearDown(self): shutil.rmtree(self.d)
    def write_raw(self, tasks, pages=None, last_more=False):
        json.dump(META, open(os.path.join(self.raw, 'meta.json'), 'w'))
        rows = [{'id': i, 'name': n, 'status': s, 'url': 'https://app.clickup.com/t/' + i, 'priority': None, 'assignees': [{'id': 1, 'username': 'ผู้ใช้'}], 'tags': [],
                 'due_date': du, 'date_updated': up, 'date_closed': None, 'list': {'id': l, 'name': ''}} for i, n, s, l, p, du, up in tasks]
        pages = pages or [rows]
        for k, pg in enumerate(pages):
            json.dump({'tasks': pg, 'page': k, 'has_more': last_more if k == len(pages) - 1 else True, 'next_page': k + 1}, open(os.path.join(self.raw, f'filter_tasks__space{BP.SPACE_ID}__p{k}.json'), 'w'))
        det = [{'oid': i, 'st': 'found', 'id': i, 'name': n, 'txt': '', 'status': s, 'list': l, 'parent': p, 'subs': [], 'start': None, 'due': du, 'created': up, 'updated': up,
                'closed': None, 'done': None, 'est': None, 'spent': None, 'fields': []} for i, n, s, l, p, du, up in tasks]
        json.dump(det, open(os.path.join(self.raw, 'task_get_many__0.json'), 'w'))
    def run_build(self, snap=None):
        return BP.build(copy.deepcopy(snap or SNAP), raw_dir=self.raw, intake=self.intake)

    def test_pagination_incomplete_rejected(self):
        self.write_raw(TASKS, last_more=True)
        with self.assertRaises(SystemExit): self.run_build()
    def test_pagination_multi_page_and_dedupe(self):
        rows = TASKS[:7], TASKS[5:]            # C2 ซ้ำในสองหน้า (เหมือนงานย่อยโผล่ทั้งผลค้นและ subtasks)
        self.write_raw(TASKS)
        full = [{'id': i, 'name': n, 'status': s, 'url': 'u', 'priority': None, 'assignees': [], 'tags': [], 'due_date': du, 'date_updated': up, 'date_closed': None, 'list': {'id': l, 'name': ''}} for i, n, s, l, p, du, up in TASKS]
        for k, pg in enumerate((full[:7], full[5:])):
            json.dump({'tasks': pg, 'page': k, 'has_more': k == 0}, open(os.path.join(self.raw, f'filter_tasks__space{BP.SPACE_ID}__p{k}.json'), 'w'))
        P = self.run_build()
        self.assertEqual(len(P['tasks']), len(TASKS)); self.assertEqual(P['meta']['dup'], 2); self.assertEqual(P['meta']['pages'], 2)
    def test_hierarchy_recursive_four_levels(self):
        P = self.run_build(); T = {t['id']: t for t in P['tasks']}
        self.assertEqual((T['A']['depth'], T['C']['depth'], T['C2']['depth'], T['C2a']['depth']), (0, 1, 2, 3))
        self.assertEqual(T['C2a']['root'], 'A'); self.assertEqual(T['C2a']['item'], 'P-BOI')
        self.assertEqual(sorted(T['C2']['children']), ['C2a', 'C2b'])
    def test_main_sub_project_counts_not_mixed(self):
        P = self.run_build(); tops = [t for t in P['tasks'] if t['depth'] == 0]
        self.assertEqual(len(tops), 5); self.assertEqual(len(P['tasks']) - len(tops), 7)
        boi = next(i for i in P['items'] if i['project_id'] == 'P-BOI')
        self.assertEqual((boi['n_tasks'], boi['n_sub']), (8, 7))
        self.assertEqual(sum(1 for i in P['items'] if i['is_project']), 1)
    def test_proposed_not_auto_confirmed(self):
        P = self.run_build()
        boi = next(i for i in P['items'] if i['project_id'] == 'P-BOI')
        self.assertEqual(boi['status'], 'proposed')       # ตั้ง confirmed แต่ไม่มีผู้ยืนยัน
        self.assertTrue(all(i['status'] != 'confirmed' for i in P['items']))
    def test_confirmed_requires_confirmer(self):
        reg = copy.deepcopy(REG); reg['items'][0].update(confirmed_by='ผู้จัดการ', confirmed_at='2026-11-25')
        json.dump(reg, open(os.path.join(self.intake, 'project_registry.json'), 'w'))
        self.assertEqual(next(i for i in self.run_build()['items'] if i['project_id'] == 'P-BOI')['status'], 'confirmed')
    def test_pm_meeting_dividend_not_investment_projects(self):
        P = self.run_build(); I = {i['project_id']: i for i in P['items']}
        self.assertFalse(I['O-PM']['is_project']); self.assertFalse(I['G-DV']['is_project'])
    def test_unregistered_top_task_goes_to_needs_review(self):
        I = {i['project_id']: i for i in self.run_build()['items']}
        self.assertEqual(I['AUTO-NEW']['type'], 'needs_review'); self.assertEqual(I['AUTO-NEW']['status'], 'unclassified'); self.assertFalse(I['AUTO-NEW']['is_project'])
    def test_approval_name_not_approval(self):
        T = {t['id']: t for t in self.run_build()['tasks']}
        self.assertTrue(any('ไม่ใช่หลักฐาน' in f for f in T['C2']['flags'])); self.assertTrue(any('รอผลพิจารณา' in f for f in T['C2']['flags']))
    def test_submission_complete_not_success(self):
        P = self.run_build(); T = {t['id']: t for t in P['tasks']}
        self.assertTrue(any('ยื่นเอกสารเสร็จ ≠' in f for f in T['C1']['flags'])); self.assertEqual(T['C1']['outcome_kind'], 'returned')
        boi = next(i for i in P['items'] if i['project_id'] == 'P-BOI')
        self.assertEqual(boi['main_status'], 'in progress')   # งานย่อย complete ไม่ทำให้ทั้งโครงการสำเร็จ
    def test_subtask_ratio_leaf_only_cancelled_separate(self):
        boi = next(i for i in self.run_build()['items'] if i['project_id'] == 'P-BOI')
        # ใบ: B1(complete) C1(complete) C2a(not started) C2b(cancelled) → 2/(4−1)
        self.assertEqual(boi['sub'], {'leaves': 4, 'done': 2, 'cancelled': 1, 'open': 1, 'pct': 2 / 3 * 100})
    def test_no_subtasks_is_na_not_zero(self):
        pm = next(i for i in self.run_build()['items'] if i['project_id'] == 'O-PM')
        self.assertIsNone(pm['sub']['pct']); self.assertIsNone(pm['physical'])
    def test_due_date_timezone_rule(self):
        T = {t['id']: t for t in self.run_build()['tasks']}
        self.assertEqual(T['DV']['due'], '2026-08-31')       # 00:00 1 ก.ย. (Bangkok) = กำหนดส่ง 31 ส.ค.
        self.assertEqual(T['NEW']['due'], '2026-11-21')      # มีเวลา 10:00 → วันเดียวกัน
        self.assertEqual(BP.ms_date(ms(2026, 6, 17, 17), BP.tz_of('+07:00')), '2026-06-17')
    def test_overdue_uses_clickup_today(self):
        T = {t['id']: t for t in self.run_build()['tasks']}
        self.assertTrue(T['DV']['overdue']); self.assertFalse(T['NEW']['overdue'])  # ครบกำหนดวันนี้ยังไม่เลย
        self.assertFalse(T['B1']['overdue'])                 # complete ไม่ถือว่าเลยกำหนด
    def test_no_utilization_data(self):
        self.assertTrue(any('ไม่คำนวณ Utilization' in c['msg'] for c in self.run_build()['checks']))
    def test_investments_po_and_booked_not_added(self):
        P = self.run_build(); I = {i['inv_id']: i for i in P['investments']}
        self.assertEqual((I['INV-PO1']['po_amt'], I['INV-PO1']['booked_amt']), (150000, 120000))
        self.assertNotIn('total', I['INV-PO1'])
        self.assertEqual(I['INV-RR3']['po_amt'], None); self.assertEqual(I['INV-RR3']['booked_amt'], 25000)
        self.assertNotIn('INV-PO9', I)                       # PO ค่าใช้จ่าย (ไม่ใช่ 1701) ไม่ใช่รายการลงทุน
        self.assertEqual(sum(i['booked_amt'] or 0 for i in P['investments']), sum(c['amt'] for c in SNAP['cip']))
    def test_unlinked_investments_still_listed(self):
        P = self.run_build()
        self.assertEqual({i['map'] for i in P['investments']}, {'unlinked'}); self.assertEqual(len(P['investments']), 3)
        self.assertTrue(any(i['kind'] == 'inv_unlinked' for i in P['insights']))
    def test_links_many_to_many_and_confirmer_rule(self):
        json.dump({'links': [{'project_id': 'P-BOI', 'inv_id': 'INV-PO1', 'relation': 'confirmed', 'allocation_pct': 50, 'confirmed_by': 'x', 'confirmed_at': '2026-11-25'},
                             {'project_id': 'O-PM', 'doc': 'PO1', 'relation': 'proposed'},
                             {'project_id': 'P-BOI', 'inv_id': 'INV-PO2', 'relation': 'confirmed'}]}, open(os.path.join(self.intake, 'project_links.json'), 'w'))
        P = self.run_build(); I = {i['inv_id']: i for i in P['investments']}; boi = next(i for i in P['items'] if i['project_id'] == 'P-BOI')
        self.assertEqual(I['INV-PO1']['map'], 'confirmed'); self.assertEqual(I['INV-PO1']['projects'], ['O-PM', 'P-BOI'])
        self.assertEqual(I['INV-PO2']['map'], 'proposed')    # confirmed ไม่มีผู้ยืนยัน → เสนอ
        self.assertEqual((boi['fin']['confirmed_booked'], boi['fin']['confirmed_po']), (60000, 75000))
    def test_empty_list_reported(self):
        self.assertEqual([l['name'] for l in self.run_build()['meta']['empty_lists']], ['ว่าง'])
    def test_foreign_list_excluded(self):
        t = TASKS + [('X', 'งานบริษัทอื่น', 'in progress', 'OTHER', None, None, ms(2026, 7, 1))]
        self.write_raw(t)
        det = json.load(open(os.path.join(self.raw, 'task_get_many__0.json')))
        self.assertNotIn('X', {x['id'] for x in self.run_build()['tasks']}); self.assertEqual(len(det), len(t))


@unittest.skipUnless(os.path.exists(os.path.join(ROOT, 'raw', 'clickup', 'meta.json')) and os.path.exists(os.path.join(ROOT, 'data', 'snapshot.json')), 'ไม่มีข้อมูลจริงในเครื่อง')
class RealData(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.snap = json.load(open(os.path.join(ROOT, 'data', 'snapshot.json'), encoding='utf-8')); cls.P = BP.build(cls.snap)
    def test_space_only_and_unique(self):
        ids = [t['id'] for t in self.P['tasks']]; self.assertEqual(len(ids), len(set(ids)))
    def test_boi_multi_level(self):
        T = {t['id']: t for t in self.P['tasks']}
        boi = [t for t in self.P['tasks'] if t['item'] == 'PSG-P-BOI']
        self.assertGreaterEqual(max(t['depth'] for t in boi), 3)
        self.assertTrue(all(T[t['parent']]['item'] == 'PSG-P-BOI' for t in boi if t['parent']))
    def test_non_investment_types(self):
        I = {i['project_id']: i for i in self.P['items']}
        for k in ('PSG-O-PM', 'PSG-G-DIVIDEND', 'PSG-G-MEETINGS', 'PSG-W-FINANCE', 'PSG-S-VALUATION'): self.assertFalse(I[k]['is_project'], k)
    def test_cip_total_unchanged(self):
        self.assertEqual(sum(i['booked_amt'] or 0 for i in self.P['investments']), sum(c['amt'] for c in self.snap['cip']))
    def test_nothing_confirmed_without_confirmer(self):
        for i in self.P['items']:
            if i['status'] == 'confirmed': self.assertTrue(i['confirmed_by'] and i['confirmed_at'])


if __name__ == '__main__': unittest.main()
