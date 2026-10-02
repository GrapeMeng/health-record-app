/* ================= 应用骨架（js/app.js · 基线 515–660 行区段迁移） =================
   toast / modal / 保险理赔注意事项面板 / 日期与迷你图工具 / 页签与成员条 / 启动。
   本批新增（R16/R17/R18 脚手架）：
   - APP_VERSION 版本号（设置页显示，R17）；
   - setHeaderSyncStatus() 头部同步状态行（设计 §8 UI#2，文案由 js/sync-ui.js 提供）；
   - online 事件 → 同步层重放暂存队列（设计 §2.3）；
   - SW 更新成功后 toast「已更新到新版本」（§8 UI#6）。 */
'use strict';
const APP_VERSION = '2.0.0';

/* ================= 工具 ================= */
let toastTimer = null;
function toast(msg) {
  let t = $('#toastEl');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; t.id = 'toastEl'; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2200);
}
function openModal(html) {
  $('#modalBox').innerHTML = html;
  $('#modalMask').classList.remove('hidden');
}
function closeModal() { $('#modalMask').classList.add('hidden'); }
$('#modalMask').addEventListener('click', (e) => { if (e.target === $('#modalMask')) closeModal(); });

/* ================= 保险理赔注意事项（R12） ================= */
function insBoardHtml(b) {
  b = b || {};
  const fields = [
    ['保险公司', b.insurer],
    ['险种 / 产品', b.plan],
    ['保障内容与保额', b.coverage],
    ['理赔电话', b.phone, true],
    ['理赔注意事项', b.notes],
  ].filter((f) => f[1] && String(f[1]).trim());
  if (!fields.length) {
    return '<p class="muted" style="line-height:1.7;">暂未填写保险信息。<br>点右上角 ⚙️ 设置 → 「保险理赔注意事项」填写后，这里会显示保障内容。</p>';
  }
  return fields.map(([label, text, isPhone]) =>
    `<div class="ins-field"><div class="ins-label">${label}</div><div class="ins-text${isPhone ? ' ins-phone' : ''}">${esc(String(text))}</div></div>`
  ).join('');
}
function insOn() {
  const c = cur();
  return !!(c.ins && c.ins.on);
}
function updateInsLayout() {
  const showIns = currentTab === 'records' && insOn();
  const layout = document.querySelector('.layout');
  const left = document.querySelector('.layout-left');
  if (layout) layout.classList.toggle('noleft', !showIns);
  if (left) left.classList.toggle('hidden', !showIns);
}
function renderInsPanels() {
  const c = cur();
  const on = insOn();
  $('#insPanel').innerHTML = on
    ? `<div class="card ins-card"><h2>📋 保险理赔注意事项</h2><div>${insBoardHtml(c.ins)}</div></div>`
    : '';
  $('#insHandle').classList.toggle('hidden', !on);
  if (!on) closeInsDrawer();
  $('#insDrawer').innerHTML = on
    ? `<div class="ins-head"><b>📋 保险理赔注意事项</b><button class="ghost" id="insDrawerClose">✕</button></div><div class="ins-body">${insBoardHtml(c.ins)}</div>`
    : '';
  const dc = $('#insDrawerClose');
  if (dc) dc.onclick = closeInsDrawer;
  updateInsLayout();
}
function openInsDrawer() {
  $('#insDrawer').classList.add('open');
  $('#insMask').classList.remove('hidden');
}
function closeInsDrawer() {
  $('#insDrawer').classList.remove('open');
  $('#insMask').classList.add('hidden');
}
function showInsPopup() {
  const c = cur();
  if (!c.ins || !c.ins.on) return;
  openModal(`<h3>📋 保险理赔注意事项</h3>
    <div class="ins-body" style="padding:4px 0 6px;">${insBoardHtml(c.ins)}</div>
    <div class="modal-actions"><button class="primary" id="insPopupClose">知道了，关闭</button></div>`);
  $('#insPopupClose').onclick = closeModal;
}

/* ================= 日期与图表工具 ================= */
function dayDiff(a, b) { return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000); }
function addDays(d, n) {
  const t = new Date(d + 'T00:00:00');
  t.setDate(t.getDate() + n);
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
}
function sparkline(values) {
  if (!values || values.length < 2) return '';
  const W = 120, H = 28;
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * W},${H - 3 - ((v - min) / span) * (H - 6)}`).join(' ');
  return `<svg viewBox="0 0 ${W} ${H}" class="spark"><polyline points="${pts}" fill="none" stroke="#2f9e6e" stroke-width="2"/></svg>`;
}

/* ================= 渲染骨架 ================= */
let currentTab = 'records';
let openHistory = new Set();

function periodEnabled(p) { return !p || p.gender !== 'male'; }

function renderAll() {
  renderPersons();
  renderTabbar();
  renderTab();
  renderInsPanels();
}

function renderTabbar() {
  const on = periodEnabled(person(DB.current));
  const btn = $('#periodTabBtn');
  if (btn) btn.classList.toggle('hidden', !on);
  $$('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === currentTab));
  if (currentTab === 'periods' && !on) currentTab = 'records';
}

function renderPersons() {
  const bar = $('#personBar');
  bar.innerHTML = DB.persons.map((p) =>
    `<button class="chip${p.id === DB.current ? ' active' : ''}" data-pid="${p.id}">${esc(p.name)}</button>`
  ).join('') + `<button class="chip add" id="addPersonBtn">＋ 成员</button>`;
  bar.querySelectorAll('.chip[data-pid]').forEach((b) => {
    b.onclick = () => { DB.current = b.dataset.pid; openHistory.clear(); save(); renderAll(); };
  });
  $('#addPersonBtn').onclick = addPerson;
}

function switchTab(tab) {
  if (tab === 'periods' && !periodEnabled(person(DB.current))) return;
  currentTab = tab;
  $$('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  ['records', 'periods', 'items'].forEach((t) => $('#tab-' + t).classList.toggle('hidden', t !== tab));
  updateInsLayout();
  renderTab();
}
function renderTab() {
  if (currentTab === 'records') renderItems();
  else if (currentTab === 'periods') renderPeriods();
  else if (currentTab === 'items') renderItemsManage();
}

/* ---- 记录页特殊项目定义（供 js/records.js 使用） ---- */
const SPECIAL = {
  height: { name: '身高', type: 'num', unit: 'cm' },
  weight: { name: '体重', type: 'num', unit: 'kg' },
  bpHigh: { name: '血压·高压', type: 'num', unit: 'mmHg' },
  bpLow: { name: '血压·低压', type: 'num', unit: 'mmHg' },
  glucose: { name: '血糖', type: 'num', unit: 'mmol/L' },
  allergy: { name: '过敏药物', type: 'text', unit: '' },
};

/* ================= 本批新增：同步与更新脚手架 ================= */
/* 头部同步状态行（设计 §8 UI#2；文案由 js/sync-ui.js 提供，点按进入设置） */
function setHeaderSyncStatus(text) {
  const el = document.getElementById('syncStatus');
  if (!el) return;
  if (!text) { el.classList.add('hidden'); el.textContent = ''; return; }
  el.textContent = text;
  el.classList.remove('hidden');
}
/* 网络恢复：通知同步层重放暂存队列（设计 §2.3「online 事件重放」） */
window.addEventListener('online', () => {
  try { if (typeof window.__syncOnlineHook === 'function') window.__syncOnlineHook(); } catch {}
});
/* SW 更新成功后提示（设计 §8 UI#6） */
let swToastShown = false;
function watchServiceWorkerUpdates() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (swToastShown || !navigator.serviceWorker.controller) return;
    swToastShown = true;
    toast('已更新到新版本 ✨');
  });
}

/* ================= 启动 ================= */
function initApp() {
  renderAll();
  showInsPopup();
  watchServiceWorkerUpdates();
}
initApp();
