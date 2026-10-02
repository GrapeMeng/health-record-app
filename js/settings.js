/* ================= 设置页（js/settings.js · 基线 1107–1324 行区段迁移） =================
   人员管理（改名/改性别/删除）/ 添加成员 / 保险表单 / 备份导出导入 / 恢复默认 / 清空数据 / 事件绑定。
   基线 1255–1277 区段（经期录入表单提交 + >7 天实时警示）已移入 js/period.js（归「经期录入」）；
   基线 1089–1126 区段（项目页管理 renderItemsManage / openEditItem）随 js/period.js（同属「项目」页签）。
   本批新增：设置页底部版本号显示（R17）。
   依赖：store.js（cur/save/uid/pad/today/esc/$/DB/defaultItems/person）、app.js（toast/openModal/closeModal/renderAll 等）；
   本文件在 js/sync-ui.js 之前加载，供其调用的 renderSettings 为全局函数。 */
'use strict';
/* ---- 设置页 ---- */
function renderSettings() {
  const ins = cur().ins || { on: true };
  $('#insOwner').textContent = '正在编辑：' + (person(DB.current) ? person(DB.current).name : '') + ' 的保险信息（每人各自独立，互不共享）';
  $('#insInsurer').value = ins.insurer || '';
  $('#insPlan').value = ins.plan || '';
  $('#insCoverage').value = ins.coverage || '';
  $('#insPhone').value = ins.phone || '';
  $('#insNotes').value = ins.notes || '';
  $('#insStatus').textContent = ins.on ? '状态：已启用（显示在「记录」页左侧）' : '状态：已停用（不显示）';
  $('#insToggleBtn').textContent = ins.on ? '停用此板块' : '启用此板块';
  $('#insToggleBtn').className = ins.on ? 'danger' : 'primary';
  $('#personsManage').innerHTML = DB.persons.map((p) => `
    <div class="rec" style="display:flex;align-items:center;justify-content:space-between;padding:7px 0;border-bottom:1px solid #f0f5f1;">
      <span>${esc(p.name)}${p.id === DB.current ? ' <span class="tag">当前</span>' : ''}</span>
      <span>
        <button class="ghost" data-gender="${p.id}">${p.gender === 'female' ? '🚺 女' : p.gender === 'male' ? '🚹 男' : '性别未设'}</button>
        <button class="ghost" data-rename="${p.id}">改名</button>
        ${DB.persons.length > 1 ? `<button class="ghost danger" data-delperson="${p.id}">删</button>` : ''}
      </span>
    </div>`).join('');
  $('#personsManage').querySelectorAll('[data-gender]').forEach((b) => b.onclick = () => openGenderModal(b.dataset.gender));
  $('#personsManage').querySelectorAll('[data-rename]').forEach((b) => b.onclick = () => {
    const p = person(b.dataset.rename);
    const name = prompt('新名字：', p.name);
    if (name && name.trim()) { p.name = name.trim(); save(); renderPersons(); renderSettings(); toast('已改名'); }
  });
  $('#personsManage').querySelectorAll('[data-delperson]').forEach((b) => b.onclick = () => {
    const p = person(b.dataset.delperson);
    if (!confirm(`删除成员「${p.name}」及其全部数据？`)) return;
    DB.persons = DB.persons.filter((x) => x.id !== p.id);
    delete DB.data[p.id];
    if (DB.current === p.id) DB.current = DB.persons[0].id;
    save(); renderPersons(); renderSettings(); toast('已删除');
  });
}

/* ---- 成员：添加与性别（R1/R13） ---- */
function addPerson() {
  openModal(`<h3>添加成员</h3>
    <div class="row"><label>名字</label></div>
    <div class="row"><input type="text" id="npName" placeholder="如：妈妈" maxlength="20"></div>
    <div class="row"><label>性别（女性自动启用「经期」记录）</label></div>
    <div class="row" style="gap:6px;">
      <button class="mini-tab active" id="npFemale">🚺 女</button>
      <button class="mini-tab" id="npMale">🚹 男</button>
    </div>
    <div class="modal-actions"><button id="npCancel">取消</button><button class="primary" id="npSave">添加</button></div>`);
  let gender = 'female';
  const setActive = () => {
    $('#npFemale').classList.toggle('active', gender === 'female');
    $('#npMale').classList.toggle('active', gender === 'male');
  };
  $('#npFemale').onclick = () => { gender = 'female'; setActive(); };
  $('#npMale').onclick = () => { gender = 'male'; setActive(); };
  $('#npCancel').onclick = closeModal;
  $('#npSave').onclick = () => {
    const name = $('#npName').value.trim();
    if (!name) { toast('请填写名字'); return; }
    const pid = uid();
    DB.persons.push({ id: pid, name, gender });
    DB.data[pid] = { items: defaultItems(), records: [], periods: [], ins: { on: false, insurer: '', plan: '', coverage: '', phone: '', notes: '' } };
    DB.current = pid;
    save(); closeModal(); renderAll(); toast('已添加「' + name + '」');
  };
}
function openGenderModal(pid) {
  const p = person(pid);
  if (!p) return;
  openModal(`<h3>选择性别</h3>
    <p class="muted" style="margin-bottom:10px;">女性会自动启用「经期」记录，男性不显示经期</p>
    <div class="row" style="gap:6px;">
      <button class="mini-tab${p.gender === 'female' ? ' active' : ''}" id="gF">🚺 女</button>
      <button class="mini-tab${p.gender === 'male' ? ' active' : ''}" id="gM">🚹 男</button>
      <button class="mini-tab${p.gender === '' ? ' active' : ''}" id="gU">未设置</button>
    </div>
    <div class="modal-actions"><button id="gCancel">取消</button><button class="primary" id="gSave">保存</button></div>`);
  let g = p.gender;
  const setActive = () => {
    $('#gF').classList.toggle('active', g === 'female');
    $('#gM').classList.toggle('active', g === 'male');
    $('#gU').classList.toggle('active', g === '');
  };
  $('#gF').onclick = () => { g = 'female'; setActive(); };
  $('#gM').onclick = () => { g = 'male'; setActive(); };
  $('#gU').onclick = () => { g = ''; setActive(); };
  $('#gCancel').onclick = closeModal;
  $('#gSave').onclick = () => {
    p.gender = g;
    save(); closeModal(); renderPersons(); renderTabbar(); renderSettings(); renderTab(); toast('已保存');
  };
}

/* ---- 备份（R14：导出 / 导入 / 清空；同步冲突的败者备份也可在此导出找回） ---- */
function exportData() {
  const blob = new Blob([JSON.stringify(DB, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '健康记录备份_' + today().replace(/-/g, '') + '.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  toast('备份文件已生成 ⬇');
}
function importFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const d = JSON.parse(reader.result);
      if (!d || !Array.isArray(d.persons) || typeof d.data !== 'object' || !d.current) throw new Error('文件格式不正确');
      if (!confirm(`导入将替换当前全部数据（${d.persons.length} 位成员），确定继续？`)) return;
      DB = d;
      if (!DB.data[DB.current]) DB.current = DB.persons[0].id;
      for (const pid of Object.keys(DB.data)) {
        const c = DB.data[pid];
        if (!c.ins) c.ins = { on: false, insurer: '', plan: '', coverage: '', phone: '', notes: '' };
      }
      openHistory.clear();
      save(); renderAll(); toast('✅ 导入成功');
    } catch (e) {
      alert('导入失败：' + e.message);
    }
  };
  reader.readAsText(file);
}

/* ---- 事件绑定 ---- */
$$('.tabbar button').forEach((b) => b.onclick = () => switchTab(b.dataset.tab));
$('#itemForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('#niName').value.trim();
  if (!name) return;
  cur().items.push({ id: uid(), name, type: $('#niType').value, unit: $('#niUnit').value.trim() });
  $('#niName').value = ''; $('#niUnit').value = '';
  save(); renderItemsManage(); toast('项目已添加');
});
$('#exportBtn').onclick = exportData;
$('#settingsOpenBtn').onclick = () => { renderSettings(); $('#settingsOverlay').classList.remove('hidden'); };
$('#settingsCloseBtn').onclick = () => $('#settingsOverlay').classList.add('hidden');
$('#insHandle').onclick = openInsDrawer;
$('#insMask').onclick = closeInsDrawer;
/* ---- 保险表单事件（R12：启停/保存） ---- */
$('#insSaveBtn').onclick = () => {
  const c = cur();
  c.ins = Object.assign(c.ins || { on: true }, {
    insurer: $('#insInsurer').value.trim(),
    plan: $('#insPlan').value.trim(),
    coverage: $('#insCoverage').value.trim(),
    phone: $('#insPhone').value.trim(),
    notes: $('#insNotes').value.trim(),
  });
  save(); renderInsPanels(); toast('已保存 ✅');
};
$('#insToggleBtn').onclick = () => {
  const c = cur();
  c.ins = c.ins || { on: true };
  c.ins.on = !c.ins.on;
  save(); renderInsPanels(); renderSettings(); toast(c.ins.on ? '已启用 ✅' : '已停用');
};
$('#exportBtn2').onclick = exportData;
$('#importBtn').onclick = () => $('#importFile').click();
$('#importFile').addEventListener('change', (e) => {
  if (e.target.files && e.target.files[0]) importFile(e.target.files[0]);
  e.target.value = '';
});
/* ---- 数据维护事件（R13/R14：恢复默认/清空） ---- */
$('#resetItemsBtn').onclick = () => {
  if (!confirm('把当前成员的项目列表恢复成默认 6 项？（已有记录不受影响）')) return;
  cur().items = defaultItems();
  save(); renderItemsManage(); renderItems(); toast('已恢复默认项目');
};
$('#clearAllBtn').onclick = () => {
  if (!confirm('清空当前成员的全部记录和经期数据？此操作不可恢复，建议先导出备份。')) return;
  const c = cur();
  c.records = []; c.periods = [];
  save(); renderItems(); renderPeriods(); toast('已清空');
};

/* ---- 版本号显示（R17：设置页底部） ---- */
const verEl = document.getElementById('appVersion');
if (verEl) verEl.textContent = APP_VERSION;
