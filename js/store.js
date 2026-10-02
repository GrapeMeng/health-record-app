/* ================= 数据层（js/store.js · 基线 360–514 行区段迁移） =================
   DB = { persons:[{id,name,gender}], current: 当前成员id,
          data: { [成员id]: { items:[{id,name,type:'num'|'text',unit}],
                              records:[{id,ts,date,itemId,value,note}],
                              periods:[{id,start,end}], ins:{...} } } }
   新增成员时自动按 defaultItems() 建一套空数据。
   本批新增：save() 同步更新 syncMeta 侧键（设计 §2.7）+ 触发同步钩子（§2.4）；
   reloadFromStorage() 供云端覆盖后重载内存数据。 */
'use strict';
const LS_KEY = 'healthAppV1';
const SYNC_META_KEY = 'syncMeta';
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const pad = (n) => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function defaultItems() {
  return [
    { id: uid(), key: 'weight', name: '体重', type: 'num', unit: 'kg' },
    { id: uid(), key: 'height', name: '身高', type: 'num', unit: 'cm' },
    { id: uid(), key: 'bpHigh', name: '血压·高压', type: 'num', unit: 'mmHg' },
    { id: uid(), key: 'bpLow', name: '血压·低压', type: 'num', unit: 'mmHg' },
    { id: uid(), key: 'glucose', name: '血糖', type: 'num', unit: 'mmol/L' },
    { id: uid(), key: 'allergy', name: '过敏药物', type: 'text', unit: '' },
  ];
}

function load() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (d && Array.isArray(d.persons) && d.data && typeof d.data === 'object') return d;
    }
  } catch {}
  return null;
}
const storedDB = load();
const DB_AUTOSEEDED = !storedDB; // 本次会话本机无数据 → 自动播种默认库（供 js/sync.js 首启判定：不把空默认库当用户数据）
let DB = storedDB || (() => {
  const pid = uid();
  return { persons: [{ id: pid, name: '我' }], current: pid, data: { [pid]: { items: defaultItems(), records: [], periods: [] } } };
})();
let storageOK = true;
function save() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(DB)); storageOK = true; }
  catch {
    if (storageOK) {
      storageOK = false;
      if (typeof toast === 'function') toast('⚠️ 本机存储不可用，请及时导出备份');
    }
  }
  /* —— 同步元数据侧键（设计 §2.7）：save() 是业务写入唯一入口，同步更新 lastUpdated —— */
  try {
    let meta = {};
    const raw = localStorage.getItem(SYNC_META_KEY);
    if (raw) { try { meta = JSON.parse(raw) || {}; } catch { meta = {}; } }
    meta.lastUpdated = Date.now();
    localStorage.setItem(SYNC_META_KEY, JSON.stringify(meta));
  } catch { /* 元数据写入失败不影响业务数据 */ }
  /* —— 同步触发钩子：由 js/sync-ui.js 注册（5 秒防抖 push，设计 §2.4） —— */
  try { if (typeof window.__syncHook === 'function') window.__syncHook(); } catch {}
}
/* —— 本机数据被云端覆盖后重载（js/sync-ui.js 在 pull/冲突选云端/迁移下载后调用） —— */
function reloadFromStorage() {
  const d = load();
  if (d) DB = d;
}
function cur() {
  if (!DB.data[DB.current]) DB.data[DB.current] = { items: defaultItems(), records: [], periods: [], ins: { on: false, insurer: '', plan: '', coverage: '', phone: '', notes: '' } };
  return DB.data[DB.current];
}
function person(id) { return DB.persons.find((p) => p.id === id); }

// 旧数据清理：删除已废弃的默认项目及其记录，"用药"改名为"过敏药物"（只跑一次）
function migrateV2() {
  if (DB.migratedV2) return;
  const REMOVED = ['心率', '体温', '睡眠时长', '运动', '身体症状'];
  for (const pid of Object.keys(DB.data)) {
    const c = DB.data[pid];
    const removedIds = c.items.filter((i) => !i.key && REMOVED.includes(i.name)).map((i) => i.id);
    if (removedIds.length) {
      c.items = c.items.filter((i) => !removedIds.includes(i.id));
      c.records = c.records.filter((r) => !removedIds.includes(r.itemId));
    }
    const med = c.items.find((i) => !i.key && i.name === '用药');
    if (med) med.name = '过敏药物';
  }
  DB.migratedV2 = true;
  save();
}
migrateV2();

// 给已有数据中的"过敏药物"打上 key（只跑一次）
function migrateV3() {
  if (DB.migratedV3) return;
  for (const pid of Object.keys(DB.data)) {
    const c = DB.data[pid];
    const it = c.items.find((i) => !i.key && i.name === '过敏药物');
    if (it) it.key = 'allergy';
  }
  DB.migratedV3 = true;
  save();
}
migrateV3();

// 老数据：给已有成员补上 gender 字段（默认未设置，经期照旧可见）
function migrateV4() {
  if (DB.migratedV4) return;
  for (const p of DB.persons) if (p.gender === undefined) p.gender = '';
  DB.migratedV4 = true;
  save();
}
migrateV4();

// 保险理赔注意事项默认结构
function migrateV5() {
  if (!DB.board) { DB.board = { insurer: '', plan: '', coverage: '', phone: '', notes: '' }; save(); }
}
migrateV5();

// 保险信息改为每个成员各自一份（继承全局已填内容，默认启用）
function migrateV6() {
  if (DB.migratedV6) return;
  const legacy = DB.board || null;
  for (const pid of Object.keys(DB.data)) {
    const c = DB.data[pid];
    if (!c.ins) {
      c.ins = {
        on: true,
        insurer: legacy ? (legacy.insurer || '') : '',
        plan: legacy ? (legacy.plan || '') : '',
        coverage: legacy ? (legacy.coverage || '') : '',
        phone: legacy ? (legacy.phone || '') : '',
        notes: legacy ? (legacy.notes || '') : '',
      };
    }
  }
  if (legacy) delete DB.board;
  DB.migratedV6 = true;
  save();
}
migrateV6();

// 去除迁移时复制给每个成员的旧全局内容：只保留第一个成员的，其余重置（内容不同者不动）
function migrateV7() {
  if (DB.migratedV7) return;
  const firstId = DB.persons.length ? DB.persons[0].id : null;
  const first = firstId ? DB.data[firstId] : null;
  const firstIns = first && first.ins;
  if (firstIns) {
    for (const pid of Object.keys(DB.data)) {
      const c = DB.data[pid];
      if (c === first || !c.ins) continue;
      const same = c.ins.insurer === firstIns.insurer && c.ins.plan === firstIns.plan &&
        c.ins.coverage === firstIns.coverage && c.ins.phone === firstIns.phone && c.ins.notes === firstIns.notes;
      if (same) c.ins = { on: false, insurer: '', plan: '', coverage: '', phone: '', notes: '' };
    }
  }
  DB.migratedV7 = true;
  save();
}
migrateV7();

// 经期升级为时间段：旧单日期记录 {date} → {start, end}（默认同一天）
function migrateV8() {
  if (DB.migratedV8) return;
  for (const pid of Object.keys(DB.data)) {
    const c = DB.data[pid];
    c.periods = (c.periods || []).map((p) => (p.start ? p : { id: p.id, start: p.date, end: p.date }));
  }
  DB.migratedV8 = true;
  save();
}
migrateV8();
