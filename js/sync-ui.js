/* ================= 同步界面（js/sync-ui.js） =================
   云同步设置区 / 头部与设置区状态行 / 冲突与迁移弹窗 / 安装引导卡 / 自动同步触发（设计 §8）。
   注入：Sync.inject({confirm}) 提供三选一冲突弹窗（§2.8 注入缝；storage/now 缺省回退生产实现）。
   触发：save() 钩子 5 秒防抖 push（§2.4）；打开页面 2 秒后自动 pull（§2.4.3）；online 重放（§2.3）。 */
'use strict';
(function () {
  const Sync = window.Sync;
  if (!Sync) return;
  const GUIDE_KEY = 'healthGuideSeen';

  /* —— 三选一冲突弹窗（设计 §8 UI#3），经注入缝交给 sync.js（§2.8） —— */
  function domConfirm(msg) {
    return new Promise((resolve) => {
      openModal(`<h3>⚠️ 数据冲突</h3>
        <p class="note" style="margin-bottom:8px;font-size:14px;">${esc(msg)}</p>
        <p class="note" style="margin-bottom:12px;">覆盖前会把另一边数据备份到本机（设置 → 备份与恢复可导出找回）。</p>
        <div class="modal-actions">
          <button class="primary" id="cfRemote">用云端</button>
          <button id="cfLocal">用本机</button>
          <button id="cfCancel">取消</button>
        </div>`);
      $('#cfRemote').onclick = () => { closeModal(); resolve('remote'); };
      $('#cfLocal').onclick = () => { closeModal(); resolve('local'); };
      $('#cfCancel').onclick = () => { closeModal(); resolve('cancel'); };
      // 点遮罩关闭 = 取消（避免 Promise 永不 resolve 导致同步挂起）
      const mask = document.getElementById('modalMask');
      mask.addEventListener('click', (e) => { if (e.target === mask) resolve('cancel'); }, { once: true });
    });
  }
  Sync.inject({ confirm: domConfirm });

  /* —— 数据被云端覆盖后刷新界面（store.js 内存 DB 重载；打开中的录入弹窗先关掉，防止写到旧数据） —— */
  function applyPull() {
    const mask = document.getElementById('modalMask');
    if (mask && !mask.classList.contains('hidden')) {
      if (typeof closeModal === 'function') closeModal();
      toast('已同步到新数据，刚才的输入已取消，请重新操作');
    }
    if (typeof reloadFromStorage === 'function') reloadFromStorage();
    if (typeof renderAll === 'function') renderAll();
    if (typeof renderSettings === 'function' && !document.getElementById('settingsOverlay').classList.contains('hidden')) renderSettings();
  }

  /* —— 状态行（设计 §8 UI#2：头部 + 设置区两处） —— */
  function renderStatus() {
    const text = Sync.statusText();
    if (typeof setHeaderSyncStatus === 'function') setHeaderSyncStatus(text);
    const el = document.getElementById('syncStatusLine');
    if (el) el.textContent = text;
  }

  /* —— 数据体积显示（R22 / 用例 C11） —— */
  function renderSize() {
    const el = document.getElementById('syncSize');
    if (!el) return;
    let kb = 0;
    try { kb = Math.round(new Blob([localStorage.getItem(Sync.LS_KEY) || '']).size / 1024); } catch {}
    el.textContent = '当前数据体积：约 ' + kb + ' KB（云端以压缩形式存储）';
  }

  /* —— 迁移提示弹窗（设计 §8 UI#4） —— */
  function showMigrateModal(msg) {
    openModal(`<h3>☁️ 同步完成</h3>
      <p class="note" style="font-size:15px;line-height:1.8;">${esc(msg)}</p>
      <div class="modal-actions"><button class="primary" id="migOk">知道了</button></div>`);
    $('#migOk').onclick = closeModal;
  }

  /* —— 连接并同步（R18/R20） —— */
  async function doConnect() {
    const token = document.getElementById('syncToken').value.trim();
    const repo = document.getElementById('syncRepo').value.trim();
    if (!token || !repo) { toast('请先填写私人令牌和仓库名（格式：用户名/仓库名）'); return; }
    const r = await Sync.connect(token, repo);
    if (r.ok) {
      toast('连接成功 ✅');
      if (r.code === 'uploaded') showMigrateModal('已把本机数据上传到云端（共 ' + r.persons + ' 位成员）。以后本机改动会自动同步。');
      else if (r.code === 'uploaded-empty') showMigrateModal('已创建云端数据文件，开始记录后会自动同步。');
      else if (r.code === 'restored') { applyPull(); showMigrateModal('已从云端恢复数据（共 ' + r.persons + ' 位成员）。'); }
      else if (r.code === 'migrated-remote-won') { applyPull(); showMigrateModal('云端数据较新，已用云端覆盖本机（共 ' + r.persons + ' 位成员）。本机旧数据已备份到本机存储：' + r.backupKey); }
      else if (r.code === 'migrated-local-won') showMigrateModal('本机数据较新，已上传到云端（共 ' + r.persons + ' 位成员）。云端旧数据已备份到本机存储：' + r.remoteBackupKey);
      else showMigrateModal('同步完成。');
    } else {
      toast(r.message || '连接失败，请检查令牌、仓库名和网络');
    }
    renderStatus();
  }

  /* —— 立即同步（用例 C3） —— */
  async function doSyncNow() {
    renderStatus();
    const r = await Sync.syncNow();
    if (r.ok) {
      if (r.pulled) { applyPull(); toast('已从云端更新 ✅'); }
      else toast('已是最新数据 ✅');
    } else if (r.pushed) {
      if (r.pushed.action === 'pulled') { applyPull(); toast('已采用云端数据 ✅'); }
      else if (r.pushed.code === 'cancelled') { toast('已取消，数据未改动'); }
      else toast(r.pushed.message || '同步失败');
    } else {
      toast(r.message || '同步失败');
    }
    renderStatus();
  }

  /* —— push 结果统一处理（冲突弹窗里选了「用云端」时同样要刷新界面） —— */
  function handlePushResult(r) {
    if (!r) return;
    if (r.ok && r.action === 'pulled') { applyPull(); toast('已采用云端数据 ✅'); }
    else if (r.code === 'cancelled') { toast('已取消，数据未改动'); }
    else if (r.code === 'ratelimit') { toast(r.message); setTimeout(() => { Sync.replayPending().then(handlePushResult).catch(() => {}).finally(renderStatus); }, 60000); } // C15：稍后自动重试
    else if (!r.ok && r.message) { toast(r.message); }
  }

  /* —— 自动同步触发（设计 §2.4：save 后 5 秒防抖 push；打开 2 秒后 pull；online 重放 §2.3） —— */
  let debounceTimer = null;
  function schedulePush() {
    if (!Sync.getConfig()) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      Sync.push().then(handlePushResult).catch(() => {}).finally(renderStatus);
    }, 5000);
  }
  window.__syncHook = schedulePush;
  window.__syncOnlineHook = () => {
    if (Sync.pendingCount() > 0) {
      Sync.replayPending().then(handlePushResult).catch(() => {}).finally(renderStatus);
    }
  };
  setTimeout(() => {
    if (!Sync.getConfig()) return;
    Sync.pull().then((r) => {
      if (r && r.ok && r.action === 'pulled') { applyPull(); toast('已从云端更新 ✅'); }
    }).catch(() => {}).finally(renderStatus);
  }, 2000);

  /* —— 安装引导卡（设计 §8 UI#5；静态内容在 index.html 壳内，此处只管显隐与按钮） —— */
  function showGuide() {
    const el = document.getElementById('guideMask');
    if (!el) return;
    el.classList.remove('hidden');
  }
  function closeGuide() {
    document.getElementById('guideMask').classList.add('hidden');
    try { localStorage.setItem(GUIDE_KEY, '1'); } catch {}
  }
  function openSettings() {
    if (typeof renderSettings === 'function') renderSettings();
    document.getElementById('settingsOverlay').classList.remove('hidden');
  }
  document.getElementById('guideMask').addEventListener('click', (e) => {
    if (e.target === document.getElementById('guideMask')) closeGuide();
  });
  document.getElementById('syncStatus').addEventListener('click', openSettings);

  /* —— 启动 —— */
  function init() {
    const cfg = Sync.getConfig();
    const tok = document.getElementById('syncToken');
    const rep = document.getElementById('syncRepo');
    if (tok && cfg) tok.value = cfg.token;
    if (rep && cfg) rep.value = cfg.repo;
    document.getElementById('syncConnectBtn').onclick = doConnect;
    document.getElementById('syncNowBtn').onclick = doSyncNow;
    document.getElementById('syncGuideBtn').onclick = showGuide;
    document.getElementById('guideOk').onclick = closeGuide;
    document.getElementById('guideConfig').onclick = () => { closeGuide(); openSettings(); };
    renderStatus();
    renderSize();
    let seen = false;
    try { seen = localStorage.getItem(GUIDE_KEY) === '1'; } catch {}
    if (!seen) setTimeout(showGuide, 600);
  }
  init();
})();
