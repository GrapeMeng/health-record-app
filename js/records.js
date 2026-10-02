/* ================= 记录页（js/records.js · 基线 661–984 行区段迁移） =================
   身体常驻卡 / 过敏警示卡 / 身高体重趋势卡 / 血压血糖双图卡 / 明细 / 录入弹窗 / lineChartSVG。
   依赖：store.js（cur/save/uid/pad/today/esc/$）与 app.js（toast/openModal/closeModal/SPECIAL/openHistory/dayDiff/sparkline）。 */
'use strict';
const RESIDENT_KEYS = ['height', 'weight'];
const BP_RANGES = { '7d': '一周', '15d': '半个月', '30d': '一个月', '180d': '半年' };
let bpRange = '30d';
let gluRange = '30d';
let hwRange = '30d';

// 老数据迁移：给默认五项打上 key（只跑一次，之后用户删除不自动重建）
function ensureKeyedItems(c) {
  if (c.migratedSpecial) return;
  for (const [key, def] of Object.entries(SPECIAL)) {
    if (c.items.some((i) => i.key === key)) continue;
    const existing = c.items.find((i) => !i.key && i.name === def.name && i.type === def.type);
    if (existing) { existing.key = key; if (!existing.unit) existing.unit = def.unit; }
    else c.items.push({ id: uid(), key, name: def.name, type: def.type, unit: def.unit });
  }
  c.migratedSpecial = true;
  save();
}
function getItemByKey(c, key) { return c.items.find((i) => i.key === key); }
function recordsOf(c, itemId) {
  return c.records.filter((r) => r.itemId === itemId)
    .sort((a, b) => ((b.date + b.ts) < (a.date + a.ts) ? -1 : 1));
}
function fmtTs(t) { const d = new Date(t); return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function historyHtml(recs, it) {
  if (!recs.length) return '<p class="muted" style="padding:6px 0;">暂无历史记录</p>';
  return `<div class="history">${recs.map((r) =>
    `<div class="rec"><span class="v">${esc(String(r.value))}${it.unit ? ' ' + esc(it.unit) : ''}</span><span class="d">${r.date}${r.note ? ' · ' + esc(r.note) : ''}</span><button class="ghost danger" data-delrec="${r.id}">删</button></div>`
  ).join('')}</div>`;
}

function renderItems() {
  const c = cur();
  ensureKeyedItems(c);
  const general = c.items.filter((i) => !SPECIAL[i.key]);
  const box = $('#itemsList');
  const genHtml = general.length
    ? general.map((it) => {
        const recs = recordsOf(c, it.id);
        const last = recs[0];
        const nums = recs.slice(0, 12).map((r) => parseFloat(r.value)).filter((v) => Number.isFinite(v)).reverse();
        return `<div class="card">
          <div class="item-row">
            <div class="item-info">
              <div class="item-name">${esc(it.name)}</div>
              ${last
                ? `<div class="mid-value">${esc(String(last.value))}${it.unit ? ' <span class="unit">' + esc(it.unit) + '</span>' : ''}</div>
                   <div class="item-last">记录于 ${last.date}</div>`
                : '<div class="mid-value empty-v">还没有记录</div>'}
            </div>
            ${it.type === 'num' ? sparkline(nums) : ''}
            <button class="small primary" data-add="${it.id}">＋记</button>
          </div>
          ${recs.length ? `<button class="ghost" data-hist="${it.id}">历史记录 (${recs.length}) ${openHistory.has(it.id) ? '▴' : '▾'}</button>` : ''}
          ${openHistory.has(it.id) ? historyHtml(recs, it) : ''}
        </div>`;
      }).join('')
    : '<div class="card"><p class="muted">没有其他项目，去「项目」页添加</p></div>';
  box.innerHTML = renderResident(c) + renderHwCard(c) + renderAllergyCard(c) +
    `<div class="charts-grid">${renderBpCard(c)}${renderGluCard(c)}</div>` +
    `<div class="gen-grid">${genHtml}</div>`;

  box.querySelectorAll('[data-add]').forEach((b) => b.onclick = () => openRecordModal(b.dataset.add));
  box.querySelectorAll('[data-hist]').forEach((b) => b.onclick = () => {
    const id = b.dataset.hist;
    if (openHistory.has(id)) openHistory.delete(id); else openHistory.add(id);
    renderItems();
  });
  box.querySelectorAll('[data-delrec]').forEach((b) => b.onclick = () => {
    if (!confirm('删除这条记录？')) return;
    cur().records = cur().records.filter((r) => r.id !== b.dataset.delrec);
    save(); renderItems(); toast('已删除');
  });
  const addBp = $('#addBpBtn'); if (addBp) addBp.onclick = openBpModal;
  const addGlu = $('#addGluBtn'); if (addGlu) addGlu.onclick = openGluModal;
  box.querySelectorAll('[data-bpr]').forEach((b) => b.onclick = () => { bpRange = b.dataset.bpr; renderItems(); });
  box.querySelectorAll('[data-glur]').forEach((b) => b.onclick = () => { gluRange = b.dataset.glur; renderItems(); });
  box.querySelectorAll('[data-hwr]').forEach((b) => b.onclick = () => { hwRange = b.dataset.hwr; renderItems(); });
  const bns = $('#bpNoteSave');
  if (bns) bns.onclick = () => { cur().bpNote = $('#bpNoteInput').value.trim(); save(); toast('备注已保存 ✅'); };
  const gns = $('#gluNoteSave');
  if (gns) gns.onclick = () => { cur().gluNote = $('#gluNoteInput').value.trim(); save(); toast('备注已保存 ✅'); };
  const bpd = $('#bpDetailBtn');
  if (bpd) bpd.onclick = () => {
    if (openHistory.has('bpDetail')) openHistory.delete('bpDetail'); else openHistory.add('bpDetail');
    renderItems();
  };
  const gd = $('#gluDetailBtn');
  if (gd) gd.onclick = () => {
    if (openHistory.has('gluDetail')) openHistory.delete('gluDetail'); else openHistory.add('gluDetail');
    renderItems();
  };
}

function renderAllergyCard(c) {
  const it = getItemByKey(c, 'allergy');
  if (!it) return '';
  const recs = recordsOf(c, it.id);
  const last = recs[0];
  return `<div class="card allergy-card">
    <h2>⚠️ 过敏药物</h2>
    <div class="item-row">
      <div class="item-info">
        ${last
          ? `<div class="big-value">${esc(String(last.value))}</div>
             <div class="item-last">记录于 ${last.date}${last.note ? ' · ' + esc(last.note) : ''}</div>`
          : '<div class="big-value empty-v">未填写</div><div class="item-last">如有过敏史请务必填写</div>'}
      </div>
      <button class="add-btn" data-add="${it.id}">＋记</button>
      <button class="ghost" data-hist="${it.id}">历史${recs.length ? '(' + recs.length + ')' : ''} ${openHistory.has(it.id) ? '▴' : '▾'}</button>
    </div>
    ${openHistory.has(it.id) ? historyHtml(recs, it) : ''}
    <p class="note">过敏信息关乎用药安全，就诊时请主动告知医生。</p>
  </div>`;
}

function renderResident(c) {
  const rows = RESIDENT_KEYS.map((k) => {
    const it = getItemByKey(c, k);
    if (!it) return '';
    const recs = recordsOf(c, it.id);
    const last = recs[0];
    return `<div class="res-row">
      <div class="item-row">
        <div class="item-info">
          <div class="item-name">${esc(it.name)}</div>
          ${last
            ? `<div class="big-value">${esc(String(last.value))}${it.unit ? ' <span class="unit">' + esc(it.unit) + '</span>' : ''}</div>
               <div class="item-last">记录于 ${last.date}</div>`
            : '<div class="big-value empty-v">未填写</div><div class="item-last">点右侧「＋记」填写</div>'}
        </div>
        <button class="add-btn" data-add="${it.id}">＋记</button>
        <button class="ghost" data-hist="${it.id}">历史${recs.length ? '(' + recs.length + ')' : ''} ${openHistory.has(it.id) ? '▴' : '▾'}</button>
      </div>
      ${openHistory.has(it.id) ? historyHtml(recs, it) : ''}
    </div>`;
  }).join('');
  return `<div class="card"><h2>身体常驻数据</h2><div class="res-grid">${rows}</div><p class="note">身高、体重固定显示在这里；点「历史」可查看以往记录。</p></div>`;
}

function bpSeries(c, key, cutoff) {
  const it = getItemByKey(c, key);
  if (!it) return [];
  return recordsOf(c, it.id)
    .map((r) => ({ t: r.ts || Date.parse(r.date + 'T00:00:00'), v: parseFloat(r.value) }))
    .filter((p) => Number.isFinite(p.v) && p.t >= cutoff)
    .reverse();
}
function renderHwCard(c) {
  const cutoff = Date.now() - parseInt(hwRange || '30d') * 86400000;
  const w = bpSeries(c, 'weight', cutoff);
  const h = bpSeries(c, 'height', cutoff);
  const rangesHtml = Object.keys(BP_RANGES).map((k) =>
    `<button class="mini-tab${k === hwRange ? ' active' : ''}" data-hwr="${k}">${BP_RANGES[k]}</button>`).join('');
  return `<div class="card">
    <h2>身高 · 体重趋势</h2>
    <div class="mini-tabs">${rangesHtml}</div>
    <div class="chart-title">体重（kg）</div>
    ${lineChartSVG([{ name: '体重', color: '#2f9e6e', points: w }], 'kg')}
    <div class="chart-title">身高（cm）</div>
    ${lineChartSVG([{ name: '身高', color: '#4a90a4', points: h }], 'cm')}
  </div>`;
}
function renderBpCard(c) {
  const cutoff = Date.now() - parseInt(bpRange || '30d') * 86400000;
  const hi = bpSeries(c, 'bpHigh', cutoff);
  const lo = bpSeries(c, 'bpLow', cutoff);
  const rangesHtml = Object.keys(BP_RANGES).map((k) =>
    `<button class="mini-tab${k === bpRange ? ' active' : ''}" data-bpr="${k}">${BP_RANGES[k]}</button>`).join('');
  return `<div class="card">
    <h2>血压</h2>
    <div class="mini-tabs">${rangesHtml}</div>
    <div class="row" style="margin-bottom:10px;">
      <button class="small primary" id="addBpBtn">＋记血压</button>
    </div>
    ${lineChartSVG([{ name: '高压', color: '#257a55', points: hi }, { name: '低压', color: '#d9a441', points: lo }], 'mmHg')}
    <div class="chart-title">💊 常用药物备注</div>
    <textarea id="bpNoteInput" rows="2" placeholder="如：降压药 硝苯地平，早晚各一片">${esc(c.bpNote || '')}</textarea>
    <button class="small" id="bpNoteSave" style="margin-top:6px;">保存备注</button>
    <button class="ghost" id="bpDetailBtn">明细 ${openHistory.has('bpDetail') ? '▴' : '▾'}</button>
    ${openHistory.has('bpDetail') ? bpDetailHtml(c) : ''}
  </div>`;
}
function renderGluCard(c) {
  const cutoff = Date.now() - parseInt(gluRange || '30d') * 86400000;
  const glu = bpSeries(c, 'glucose', cutoff);
  const rangesHtml = Object.keys(BP_RANGES).map((k) =>
    `<button class="mini-tab${k === gluRange ? ' active' : ''}" data-glur="${k}">${BP_RANGES[k]}</button>`).join('');
  return `<div class="card">
    <h2>血糖</h2>
    <div class="mini-tabs">${rangesHtml}</div>
    <div class="row" style="margin-bottom:10px;">
      <button class="small primary" id="addGluBtn">＋记血糖</button>
    </div>
    ${lineChartSVG([{ name: '血糖', color: '#4a90a4', points: glu }], 'mmol/L')}
    <div class="chart-title">💊 常用药物备注</div>
    <textarea id="gluNoteInput" rows="2" placeholder="如：降糖药 二甲双胍，随餐服用">${esc(c.gluNote || '')}</textarea>
    <button class="small" id="gluNoteSave" style="margin-top:6px;">保存备注</button>
    <button class="ghost" id="gluDetailBtn">明细 ${openHistory.has('gluDetail') ? '▴' : '▾'}</button>
    ${openHistory.has('gluDetail') ? gluDetailHtml(c) : ''}
  </div>`;
}
function bpDetailHtml(c) {
  const rows = [];
  for (const [key, label] of [['bpHigh', '高压'], ['bpLow', '低压']]) {
    const it = getItemByKey(c, key);
    if (it) rows.push(...recordsOf(c, it.id).map((r) => ({ ...r, label })));
  }
  rows.sort((a, b) => ((b.date + b.ts) < (a.date + a.ts) ? -1 : 1));
  if (!rows.length) return '<p class="muted" style="padding:6px 0;">暂无明细</p>';
  return `<div class="history">${rows.map((r) =>
    `<div class="rec"><span class="v">${r.label} ${esc(String(r.value))}</span><span class="d">${r.date}</span><button class="ghost danger" data-delrec="${r.id}">删</button></div>`
  ).join('')}</div>`;
}
function gluDetailHtml(c) {
  const it = getItemByKey(c, 'glucose');
  if (!it) return '<p class="muted" style="padding:6px 0;">暂无明细</p>';
  const rows = recordsOf(c, it.id);
  if (!rows.length) return '<p class="muted" style="padding:6px 0;">暂无明细</p>';
  return `<div class="history">${rows.map((r) =>
    `<div class="rec"><span class="v">血糖 ${esc(String(r.value))}</span><span class="d">${r.date}</span><button class="ghost danger" data-delrec="${r.id}">删</button></div>`
  ).join('')}</div>`;
}

/* 线性图：多系列共轴（血压高压/低压同图） */
function lineChartSVG(series, unit) {
  const all = series.flatMap((s) => s.points);
  if (all.length < 2) return '<p class="muted" style="padding:10px 0;">该时间段暂无数据</p>';
  let min = Math.min(...all.map((p) => p.v));
  let max = Math.max(...all.map((p) => p.v));
  const pad = (max - min) * 0.15 || 5;
  min -= pad; max += pad;
  const W = 600, H = 150, PADL = 46, PADR = 12, PADT = 10, PADB = 22;
  const t0 = Math.min(...all.map((p) => p.t));
  const t1 = Math.max(...all.map((p) => p.t));
  const tspan = t1 - t0;
  const X = (t) => PADL + (tspan === 0 ? (W - PADL - PADR) / 2 : ((t - t0) / tspan) * (W - PADL - PADR));
  const Y = (v) => PADT + (1 - (v - min) / (max - min)) * (H - PADT - PADB);
  let grid = '';
  for (let i = 0; i <= 4; i++) {
    const gy = PADT + (i / 4) * (H - PADT - PADB);
    const gv = max - (i / 4) * (max - min);
    grid += `<line x1="${PADL}" y1="${gy}" x2="${W - PADR}" y2="${gy}" stroke="#e5e7eb" stroke-dasharray="4,4"/><text x="${PADL - 6}" y="${gy + 4}" text-anchor="end" font-size="10" fill="#7c8c81">${gv.toFixed(gv < 10 ? 1 : 0)}</text>`;
  }
  const xlabels = [t0, (t0 + t1) / 2, t1].map((t) =>
    `<text x="${X(t)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="#7c8c81">${fmtTs(t)}</text>`).join('');
  const lines = series.filter((s) => s.points.length >= 2).map((s) => {
    const pts = s.points.map((p) => `${X(p.t)},${Y(p.v)}`).join(' ');
    const dots = s.points.map((p) =>
      `<circle cx="${X(p.t)}" cy="${Y(p.v)}" r="3" fill="${s.color}"><title>${fmtTs(p.t)} ${p.v}</title></circle>`).join('');
    return `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2.2"/>${dots}`;
  }).join('');
  const legend = series.filter((s) => s.points.length).map((s) =>
    `<span><i class="dot" style="background:${s.color}"></i>${s.name}</span>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;">${grid}${lines}${xlabels}</svg><div class="legend">${legend}</div>`;
}

function openBpModal() {
  openModal(`<h3>记血压</h3>
    <div class="row"><label>日期</label></div>
    <div class="row"><input type="date" id="mDate" value="${today()}"></div>
    <div class="row"><label>高压 / 低压（mmHg）</label></div>
    <div class="row">
      <input type="number" id="mHigh" step="any" inputmode="decimal" placeholder="高压，如 120">
      <input type="number" id="mLow" step="any" inputmode="decimal" placeholder="低压，如 80">
    </div>
    <div class="modal-actions"><button id="mCancel">取消</button><button class="primary" id="mSave">保存</button></div>`);
  $('#mCancel').onclick = closeModal;
  $('#mSave').onclick = () => {
    const hi = parseFloat($('#mHigh').value), lo = parseFloat($('#mLow').value);
    if (!Number.isFinite(hi) || !Number.isFinite(lo)) { toast('请填写高压和低压两个数值'); return; }
    const c = cur();
    const date = $('#mDate').value || today();
    const ts = Date.now();
    c.records.push({ id: uid(), ts, date, itemId: getItemByKey(c, 'bpHigh').id, value: String(hi) });
    c.records.push({ id: uid(), ts, date, itemId: getItemByKey(c, 'bpLow').id, value: String(lo) });
    save(); closeModal(); renderItems(); toast('血压已记录 ✅');
  };
}
function openGluModal() {
  openModal(`<h3>记血糖</h3>
    <div class="row"><label>日期</label></div>
    <div class="row"><input type="date" id="mDate" value="${today()}"></div>
    <div class="row"><label>血糖（mmol/L）</label></div>
    <div class="row"><input type="number" id="mGlu" step="any" inputmode="decimal" placeholder="如 5.6"></div>
    <div class="modal-actions"><button id="mCancel">取消</button><button class="primary" id="mSave">保存</button></div>`);
  $('#mCancel').onclick = closeModal;
  $('#mSave').onclick = () => {
    const v = parseFloat($('#mGlu').value);
    if (!Number.isFinite(v)) { toast('请填写血糖数值'); return; }
    const c = cur();
    c.records.push({ id: uid(), ts: Date.now(), date: $('#mDate').value || today(), itemId: getItemByKey(c, 'glucose').id, value: String(v) });
    save(); closeModal(); renderItems(); toast('血糖已记录 ✅');
  };
}

function openRecordModal(itemId) {
  const c = cur();
  const it = c.items.find((x) => x.id === itemId);
  if (!it) return;
  openModal(`
    <h3>记一笔 · ${esc(it.name)}</h3>
    <div class="row"><label>日期</label></div>
    <div class="row"><input type="date" id="mDate" value="${today()}"></div>
    <div class="row"><label>${it.type === 'num' ? '数值' : '内容'}${it.unit ? '（' + esc(it.unit) + '）' : ''}</label></div>
    <div class="row">${it.type === 'num'
      ? '<input type="number" id="mValue" step="any" inputmode="decimal" placeholder="请输入数值">'
      : '<input type="text" id="mValue" placeholder="如：跑步30分钟">'}</div>
    <div class="row"><label>备注（可选）</label></div>
    <div class="row"><input type="text" id="mNote" maxlength="50" placeholder=""></div>
    <div class="modal-actions">
      <button id="mCancel">取消</button>
      <button class="primary" id="mSave">保存</button>
    </div>`);
  $('#mCancel').onclick = closeModal;
  $('#mSave').onclick = () => {
    const v = $('#mValue').value.trim();
    if (!v) { toast('请填写内容'); return; }
    if (it.type === 'num' && !Number.isFinite(parseFloat(v))) { toast('请输入有效数字'); return; }
    c.records.push({ id: uid(), ts: Date.now(), date: $('#mDate').value || today(), itemId: it.id, value: v, note: $('#mNote').value.trim() });
    save(); closeModal(); renderItems(); toast('已记录 ✅');
  };
}
