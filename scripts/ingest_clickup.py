"""Source adapter (session mode) สำหรับ ClickUp: เก็บผลดิบจาก ClickUp MCP ที่เรียกใน session ของผู้ช่วย → raw/clickup/
ใช้เมื่อเว็บ/เครื่อง build เรียก MCP เองไม่ได้ (GitHub Pages ไม่เรียก MCP) — อ่าน transcript ของ session แล้วบันทึก response ดิบ
ใช้: python3 scripts/ingest_clickup.py <transcript.jsonl>
     python3 scripts/ingest_clickup.py --check            (ตรวจไฟล์ใน raw/clickup ว่าครบสำหรับ build_projects.py)
กติกา
- รับเฉพาะเครื่องมืออ่านอย่างเดียว (get_*, filter_tasks, search, execute_operator ที่ operator เป็น get/get_many/list) — เจอเครื่องมือเขียนข้อมูลหยุดทันที
- filter_tasks ต้องกรอง PSG Space (901811857778) และเก็บทุกหน้า pagination · build_projects.py จะปฏิเสธถ้าหน้าสุดท้ายยัง has_more=true
- ผลลัพธ์: filter_tasks__space<ID>__p<n>.json · task_get_many__<n>.json (รูปแบบย่อ) · meta.json"""
import json, sys, os, re, glob
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'raw', 'clickup'); os.makedirs(OUT, exist_ok=True)
SPACE = '901811857778'
NAME = re.compile(r'^mcp__[^_].*?clickup.*?__clickup_(\w+)$', re.I)
READ = re.compile(r'^(get_\w+|filter_tasks|search|find_member_by_name|resolve_assignees)$')


def compact(d):
    """task (เต็มจาก get_many) → รูปแบบย่อที่ build_projects.py ใช้"""
    tm, own = d.get('time_mgmt') or {}, d.get('ownership') or {}
    return {'oid': d['id'], 'st': 'found', 'id': d['id'], 'name': d['name'], 'txt': d.get('text_content'), 'status': (d.get('status') or {}).get('status'),
            'list': d.get('subcategory'), 'parent': d.get('direct_parent'), 'root': d.get('root_parent'), 'subs': d.get('subtask_ids') or [],
            'start': tm.get('start_date'), 'due': tm.get('due_date'), 'due_time': tm.get('due_date_time'), 'created': tm.get('date_created'), 'updated': tm.get('date_updated'),
            'closed': tm.get('date_closed'), 'done': tm.get('date_done'), 'est': tm.get('time_estimate'), 'spent': tm.get('time_spent'), 'fields': d.get('fields') or [],
            'owner': own.get('owner'), 'users': d.get('users') or [], 'archived': (d.get('states') or {}).get('is_archived'), 'deleted': (d.get('states') or {}).get('is_deleted'),
            'prio': d.get('priority'), 'checklists': d.get('checklists') or []}


def check():
    ok = True
    for f in ('meta.json',):
        if not os.path.exists(os.path.join(OUT, f)): print('ขาด', f); ok = False
    pages = glob.glob(os.path.join(OUT, f'filter_tasks__space{SPACE}__p*.json'))
    print('filter_tasks', len(pages), 'หน้า'); ok = ok and bool(pages)
    print('task_get_many', len(glob.glob(os.path.join(OUT, 'task_get_many__*.json'))), 'ไฟล์')
    sys.exit(0 if ok else 1)


def ingest(tp):
    uses, meta = {}, json.load(open(os.path.join(OUT, 'meta.json'), encoding='utf-8')) if os.path.exists(os.path.join(OUT, 'meta.json')) else {'calls': []}
    meta['calls'] = []; nget = 0
    for line in open(tp, encoding='utf-8'):
        try: o = json.loads(line)
        except Exception: continue
        c = (o.get('message') or {}).get('content')
        if not isinstance(c, list): continue
        for b in c:
            if not isinstance(b, dict): continue
            if b.get('type') == 'tool_use':
                m = NAME.match(b.get('name', ''))
                if not m: continue
                tool, inp = m.group(1), b.get('input') or {}
                if tool == 'execute_operator':
                    if inp.get('operator') not in ('get', 'get_many', 'list'): raise SystemExit('พบการเรียก ClickUp แบบเขียนข้อมูล: execute_operator ' + str(inp.get('operator')))
                elif not READ.match(tool): raise SystemExit('พบการเรียก ClickUp แบบเขียนข้อมูล: ' + tool)
                uses[b['id']] = (tool, inp, o.get('timestamp'))
            if b.get('type') == 'tool_result' and b.get('tool_use_id') in uses:
                tool, inp, ts = uses[b['tool_use_id']]
                cc = b.get('content'); txt = cc if isinstance(cc, str) else ''.join(x.get('text', '') for x in cc if isinstance(x, dict))
                try: data = json.loads(txt)
                except Exception: continue
                meta['calls'].append({'tool': 'clickup_' + tool, 'params': inp, 'fetched_at': ts})
                if tool == 'filter_tasks':
                    if SPACE not in (inp.get('space_ids') or []): raise SystemExit('filter_tasks ต้องกรอง PSG Space ' + SPACE)
                    json.dump(data, open(os.path.join(OUT, f'filter_tasks__space{SPACE}__p{int(inp.get("page") or 0)}.json'), 'w', encoding='utf-8'), ensure_ascii=False)
                elif tool == 'execute_operator' and inp.get('model') == 'task' and inp.get('operator') == 'get_many':
                    rows = data if isinstance(data, list) else [compact(x['data']) for x in data.get('tasks', []) if x.get('status') == 'found']
                    json.dump(rows, open(os.path.join(OUT, f'task_get_many__{nget}.json'), 'w', encoding='utf-8'), ensure_ascii=False); nget += 1
                elif tool == 'get_user':
                    meta['user'] = {k: data.get(k) for k in ('timezone', 'current_time', 'utc_offset')}
                elif tool == 'get_workspace_hierarchy':
                    sp = next(x for x in data['hierarchy']['root']['children'] if x['id'] == SPACE)
                    lists = []
                    def walk(n):
                        for ch in n.get('children', []):
                            if ch.get('type') == 'list': lists.append({'id': ch['id'], 'name': ch['name']})
                            walk(ch)
                    walk(sp)
                    meta['hierarchy'] = {'workspace_id': data['hierarchy']['root']['id'], 'space': {'id': SPACE, 'name': sp['name']}, 'lists': lists, 'has_more': data.get('has_more')}
                elif tool == 'get_list' and data.get('statuses'):
                    meta['statuses'] = [{'status': s['status'], 'type': s['type']} for s in data['statuses']]
                elif tool == 'get_custom_fields':
                    meta['custom_fields'] = [{'id': f['id'], 'name': f['name'], 'type': f['type']} for f in (data.get('list_fields') or []) + (data.get('space_fields') or [])]
    json.dump(meta, open(os.path.join(OUT, 'meta.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    for c in meta['calls']: print(c['tool'], json.dumps(c['params'], ensure_ascii=False)[:90], c['fetched_at'])


if __name__ == '__main__':
    if len(sys.argv) < 2: print(__doc__); sys.exit(1)
    check() if sys.argv[1] == '--check' else ingest(sys.argv[1])
