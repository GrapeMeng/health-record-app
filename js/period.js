/* ================= 经期页 + 项目页（js/period.js · 基线 986–1106 行区段迁移） =================
   经期日历（三色标记/翻月/点选填表）/ 统计五项 / 按月缺失提醒 / 经期录入表单（基线 1255–1277 区段
   移入：表单提交 + >7 天实时红框警示，归属「经期录入」）。
   项目页管理（renderItemsManage / openEditItem，基线 1089–1126 区段）随本文件一起：两者同属
   「项目」页签的渲染与管理，配对迁移保持内聚。
   依赖：store.js（cur/save/uid/pad/today/esc/$）与 app.js（toast/openModal/closeModal/dayDiff/addDays）。 */
'use strict';
/* ---- 经期页 ---- */
let calYear = new Date().getFullYear();
let calMonth = new Date().getMonth();
function renderCalendar(periods, predicted) {
  const now = new Date();
  const curY = now.getFullYear(), curM = now.getMonth();
  const firstDow = (new Date(calYear, calMonth, 1).getDay() + 6) % 7; // 周一开头
  const daysIn = new Date(calYear, calMonth + 1, 0).getDate();
  const pad2 = (n) => String(n).padStart(2, '0');
  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push('<div class="cal-cell empty"></div>');
  for (let d = 1; d <= daysIn; d++) {
    const ds = `${calYear}-${pad2(calMonth + 1)}-${pad2(d)}`;
    const p = periods.find((x) => ds >= x.start && ds <= x.end);
    const isStart = p && ds === p.start;
    const isToday = ds === today();
    const isPred = ds === predicted;
    let cls = 'cal-cell';
    if (isStart) cls += ' period-start';
    else if (p) cls += ' in-period';
    if (isToday) cls += ' today';
    if (isPred) cls += ' predicted';
    cells.push(`<div class="${cls}" data-day="${ds}"${isPred ? ' title="预计经期开始，点击可直接填入"' : ''}>${isPred ? `<div>${d}</div><div class="pd-tag">预计</div>` : d}</div>`);
  }
  const todayBtn = (calYear === curY && calMonth === curM) ? '' : '<button class="nav" id="calTodayBtn">回到今天</button>';
  return `<div class="cal-head">
      <button class="nav" id="calPrevBtn">◀</button>
      <span class="cal-title">${calYear} 年 ${calMonth + 1} 月</span>
      <button class="nav" id="calNextBtn">▶</button>
      ${todayBtn}
    </div>
    <div class="cal-dow-row">${['一', '二', '三', '四', '五', '六', '日'].map((w) => `<div class="cal-dow">${w}</div>`).join('')}</div>
    <div class="cal">${cells.join('')}</div>`;
}
function bindCalNav() {
  const pv = $('#calPrevBtn'), nx = $('#calNextBtn'), td = $('#calTodayBtn');
  if (pv) pv.onclick = () => { calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; } renderPeriods(); };
  if (nx) nx.onclick = () => { calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; } renderPeriods(); };
  if (td) td.onclick = () => { const n = new Date(); calYear = n.getFullYear(); calMonth = n.getMonth(); renderPeriods(); };
  // 点击日历某天 → 自动填入表单（开始=结束=那天）
  document.querySelectorAll('#calBox .cal-cell[data-day]').forEach((el) => {
    el.onclick = () => {
      const ds = el.dataset.day;
      $('#periodStart').value = ds;
      $('#periodEnd').value = ds;
      refreshPeriodWarn();
      $('#periodForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
      toast('已填入 ' + ds + '，确认后点「记录本次」');
    };
  });
}
function periodStats(periods) {
  const starts = periods.map((p) => p.start).sort();
  const last = starts.length ? starts[starts.length - 1] : null;
  const intervals = [];
  for (let i = 1; i < starts.length; i++) intervals.push(dayDiff(starts[i - 1], starts[i]));
  const avg = intervals.length ? intervals.reduce((a, b) => a + b, 0) / intervals.length : null;
  const minC = intervals.length ? Math.min(...intervals) : null;
  const maxC = intervals.length ? Math.max(...intervals) : null;
  return { last, intervals, avg, minC, maxC, next: last && avg ? addDays(last, Math.round(avg)) : null };
}
function renderPeriods() {
  const c = cur();
  const st = periodStats(c.periods);
  $('#periodStats').innerHTML = `
    <div class="stat"><div class="n">${st.intervals.length ? st.intervals[st.intervals.length - 1] + ' 天' : '—'}</div><div class="l">最近周期</div></div>
    <div class="stat"><div class="n">${st.avg ? st.avg.toFixed(1) + ' 天' : '—'}</div><div class="l">平均周期</div></div>
    <div class="stat"><div class="n">${st.minC ? st.minC + ' 天' : '—'}</div><div class="l">最短周期</div></div>
    <div class="stat"><div class="n">${st.maxC ? st.maxC + ' 天' : '—'}</div><div class="l">最长周期</div></div>
    <div class="stat"><div class="n">${st.next || '—'}</div><div class="l">预计下次</div></div>`;
  $('#calBox').innerHTML = renderCalendar(c.periods, st.next);
  bindCalNav();
  // 提醒：日历查看的月份在"首次记录～最近记录"之间且无记录时提示；超过最近记录的月份不提醒
  const viewYm = `${calYear}-${pad(calMonth + 1)}`;
  const ymList = c.periods.length ? [...c.periods].map((p) => String(p.start || '').slice(0, 7)).sort() : [];
  const firstRecYm = ymList[0] || null;
  const lastRecYm = ymList[ymList.length - 1] || null;
  const hasRec = c.periods.some((p) => String(p.start || '').slice(0, 7) === viewYm);
  const showWarn = firstRecYm !== null && !hasRec && viewYm >= firstRecYm && viewYm <= lastRecYm;
  const ow = $('#periodOverdueWarn');
  if (ow) {
    ow.classList.toggle('hidden', !showWarn);
    if (showWarn) $('#overdueWarnText').textContent = `${calYear} 年 ${calMonth + 1} 月没有经期记录，注意身体`;
  }
  const sorted = [...c.periods].sort((a, b) => (a.start > b.start ? 1 : -1));
  $('#periodList').innerHTML = sorted.length ? sorted.map((p, i) => {
    const prev = sorted[i - 1];
    const gap = prev ? dayDiff(prev.start, p.start) : null;
    const days = dayDiff(p.start, p.end) + 1;
    const warn = days > 7;
    return `<div class="rec${warn ? ' rec-warn' : ''}">
      <span><span class="${warn ? 'date-warn' : ''}">${p.start}${p.end && p.end !== p.start ? ' ~ ' + p.end : ''}</span> <span class="tag${warn ? ' tag-warn' : ''}">${days} 天</span>${warn ? ' <span class="tag tag-warn">⚠️ 注意身体</span>' : ''}${i === sorted.length - 1 ? ' <span class="tag">最近</span>' : ''}</span>
      <span class="muted">${gap ? '距上次 ' + gap + ' 天' : '第一次记录'}</span>
      <button class="ghost danger" data-pdel="${p.id}">删</button></div>`;
  }).join('') : '<p class="muted">还没有经期记录，从下次开始日期记起</p>';
  $('#periodList').querySelectorAll('[data-pdel]').forEach((b) => b.onclick = () => {
    if (!confirm('删除这条经期记录？')) return;
    cur().periods = cur().periods.filter((p) => p.id !== b.dataset.pdel);
    save(); renderPeriods(); toast('已删除');
  });
  $('#periodStart').value = today();
  $('#periodEnd').value = today();
}

/* ---- 经期录入（R8：>7 天实时红框警示；基线事件绑定区段移入） ---- */
function refreshPeriodWarn() {
  const start = $('#periodStart').value;
  const end = $('#periodEnd').value || start;
  const days = start && end >= start ? dayDiff(start, end) + 1 : 0;
  const warn = days > 7;
  $('#periodWarn').classList.toggle('hidden', !warn);
  $('#periodStart').classList.toggle('warn-input', warn);
  $('#periodEnd').classList.toggle('warn-input', warn);
}
function bindPeriodForm() {
  $('#periodForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const start = $('#periodStart').value;
    const end = $('#periodEnd').value || start;
    if (!start) return;
    if (end < start) { toast('结束日期不能早于开始日期'); return; }
    const days = dayDiff(start, end) + 1;
    cur().periods.push({ id: uid(), start, end });
    save(); renderPeriods();
    toast(days > 7 ? '已记录 ⚠️ 超过 7 天，请注意身体' : '已记录 ✅');
  });
  $('#periodStart').addEventListener('change', refreshPeriodWarn);
  $('#periodEnd').addEventListener('change', refreshPeriodWarn);
}
bindPeriodForm();

/* ---- 项目管理页（「项目」页签） ---- */
function renderItemsManage() {
  const c = cur();
  $('#itemsManage').innerHTML = c.items.map((it) => `
    <div class="rec" style="display:flex;align-items:center;justify-content:space-between;padding:7px 0;border-bottom:1px solid #f0f5f1;">
      <span>${esc(it.name)}${it.unit ? ' <span class="muted">(' + esc(it.unit) + ')</span>' : ''} <span class="tag">${it.type === 'num' ? '数值' : '文字'}</span></span>
      <span><button class="ghost" data-edit="${it.id}">改</button><button class="ghost danger" data-delitem="${it.id}">删</button></span>
    </div>`).join('') || '<p class="muted">暂无项目</p>';
  $('#itemsManage').querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => openEditItem(b.dataset.edit));
  $('#itemsManage').querySelectorAll('[data-delitem]').forEach((b) => b.onclick = () => {
    const it = cur().items.find((x) => x.id === b.dataset.delitem);
    if (!confirm(`删除项目「${it.name}」及其全部记录？`)) return;
    const c = cur();
    c.items = c.items.filter((x) => x.id !== it.id);
    c.records = c.records.filter((r) => r.itemId !== it.id);
    save(); renderItemsManage(); toast('已删除');
  });
}
function openEditItem(id) {
  const it = cur().items.find((x) => x.id === id);
  if (!it) return;
  openModal(`
    <h3>编辑项目</h3>
    <div class="row"><input type="text" id="eiName" value="${esc(it.name)}"></div>
    <div class="row"><select id="eiType">
      <option value="num"${it.type === 'num' ? ' selected' : ''}>数值型</option>
      <option value="text"${it.type === 'text' ? ' selected' : ''}>文字型</option>
    </select></div>
    <div class="row"><input type="text" id="eiUnit" value="${esc(it.unit || '')}" placeholder="单位（可选）"></div>
    <div class="modal-actions"><button id="eCancel">取消</button><button class="primary" id="eSave">保存</button></div>`);
  $('#eCancel').onclick = closeModal;
  $('#eSave').onclick = () => {
    const name = $('#eiName').value.trim();
    if (!name) { toast('项目名不能为空'); return; }
    it.name = name; it.type = $('#eiType').value; it.unit = $('#eiUnit').value.trim();
    save(); closeModal(); renderItemsManage(); toast('已保存');
  };
}
