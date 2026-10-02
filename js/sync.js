/* ================= 云同步核心（js/sync.js） =================
   Gitee OpenAPI v5 直连同步（设计 §2）：状态机 §2.3 / 数据流 §2.4 / LWW+确认 §2.5 /
   首次迁移 §2.6 / syncMeta 侧键 §2.7 / 注入缝 §2.8。无 DOM 依赖：浏览器全局只在函数内
   取用，Sync.inject({storage, confirm, now}) 注入假实现可 node --test 单测，缺省 null
   回退生产实现（localStorage / window.confirm / Date.now）。浏览器挂 window.Sync，node CJS 导出。 */
'use strict';
(function (global) {
  /* —— 常量 —— */
  const API_BASE = 'https://gitee.com/api/v5';
  const FILE_PATH = 'data/sync.json'; // 私有仓库数据文件（§2.1）
  const ROOT_PATH = 'sync.json';      // 新仓库无 data/ 目录时回退仓库根（§2.1 未验证注记兜底）
  const META_KEY = 'syncMeta';        // 同步元数据侧键（§2.7），与 js/store.js 一致
  const CONFIG_KEY = 'syncConfig';    // 令牌+仓库配置，仅存本机 localStorage（R18）
  const BACKUP_PREFIX = 'syncBackup_'; // 覆盖前备份键前缀（§2.4）
  const BACKUP_KEEP = 3;               // 备份轮换保留最近 3 份（§2.4）
  const LS_KEY = 'healthAppV1';        // 业务数据键（结构不改，需求 §三.8）
  /* —— 状态机（§2.3） —— */
  const STATE = { UNCONFIGURED: 'unconfigured', CONFIGURING: 'configuring', CONNECTED: 'connected', SYNCING: 'syncing', CONFLICT: 'conflict', OFFLINE: 'offline', ERROR: 'error' };
  /* —— 注入缝（§2.8）：模块级 setter，缺省 null → 生产实现 —— */
  /* 声明必须先于下方 state 初始化：浏览器（无 module）分支在模块顶层调用 getConfig() → storage() 读 _storage，
     let 声明在后会触发 TDZ（ReferenceError: Cannot access '_storage' before initialization）→ 整模块加载失败 */
  let _storage = null, _confirm = null, _now = null;
  let state = STATE.UNCONFIGURED; if (typeof module === 'undefined' && getConfig()) state = STATE.CONNECTED; // 浏览器：已配置设备加载即已连接
  function inject(deps) { deps = deps || {}; _storage = deps.storage ?? null; _confirm = deps.confirm ?? null; _now = deps.now ?? null; }
  function storage() { if (_storage) return _storage; return (typeof localStorage !== 'undefined') ? localStorage : null; }
  function confirmFn() {
    if (_confirm) return _confirm;
    if (typeof window !== 'undefined' && typeof window.confirm === 'function') return (msg) => Promise.resolve(window.confirm(msg) ? 'remote' : 'cancel');
    return () => Promise.resolve('cancel');
  }
  function currentTime() { return (_now || Date.now)(); }
  /* —— 小工具 —— */
  const pad2 = (n) => String(n).padStart(2, '0');
  function err(code, message, extra) { const e = new Error(message); e.code = code; if (extra) Object.assign(e, extra); return e; }
  function utf8ToBytes(s) { return new TextEncoder().encode(s); }
  function bytesToUtf8(b) { return new TextDecoder().decode(b); }
  function bytesToB64(bytes) { let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(bin); }
  function b64ToBytes(b64) { const bin = atob(b64); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
  /* 仓库路径分段编码（缺陷修复）：整体 encodeURIComponent 会把 'lml_888/health-data' 编成
     'lml_888%2Fhealth-data'，Gitee API 不认编码斜杠 → 读/写两路径全 404。按 '/' 切分逐段编码、
     字面 '/' 连接：分隔符保持字面，段内特殊字符（空格/非 ASCII）仍被编码 */
  function repoPath(repo) { return String(repo).split('/').map(encodeURIComponent).join('/'); }
  /* —— 载荷编码（§2.2）：gzip+base64；无 CompressionStream 回退明文（用例 C17） —— */
  async function encodePayload(db) {
    const json = JSON.stringify(db); if (typeof CompressionStream !== 'undefined') try {
      const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'));
      const buf = await new Response(stream).arrayBuffer();
      return { b64: bytesToB64(new Uint8Array(buf)), gzip: true };
    } catch { /* 压缩失败 → 回退明文 */ }
    return { b64: bytesToB64(utf8ToBytes(json)), gzip: false };
  }
  /* 解码：gzip 魔数（1f 8b）自动识别压缩/明文，两种历史载荷都兼容 */
  async function decodePayload(b64) {
    let bytes; try { bytes = b64ToBytes(b64); } catch { throw err('api', '云端数据解码失败'); }
    const isGzip = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
    if (isGzip) {
      if (typeof DecompressionStream === 'undefined') throw err('api', '此浏览器不支持读取压缩后的云端数据');
      try {
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
        const buf = await new Response(stream).arrayBuffer();
        return JSON.parse(bytesToUtf8(new Uint8Array(buf)));
      } catch { throw err('api', '云端数据解压失败'); }
    }
    try { return JSON.parse(bytesToUtf8(bytes)); } catch { throw err('api', '云端数据解析失败'); }
  }
  /* —— API 封装（§2.1） —— */
  let serverOffset = 0; // 时钟偏差缓解（§2.5）：API Date 头估算本机偏移，CORS 未暴露时自动失效
  function applyOffset(remoteTs) { return (typeof remoteTs === 'number' && Number.isFinite(remoteTs)) ? remoteTs + serverOffset : remoteTs; }
  async function apiFetch(path, options) {
    let resp; try { resp = await fetch(API_BASE + path, options); }
    catch (e) { throw err('network', '网络不可用，改动已暂存，联网后会自动补传'); }
    try { const d = resp.headers.get('date'); if (d) { const t = Date.parse(d); if (Number.isFinite(t)) serverOffset = t - currentTime(); } } catch { /* 偏差估算失败不阻塞同步 */ }
    if (resp.status === 401) throw err('unauthorized', '令牌无效或被撤销，请到 Gitee 重新生成');
    if (resp.status === 429) throw err('ratelimit', '请求太频繁，请稍后再试');
    return resp;
  }
  async function verifyToken(token) {
    const resp = await apiFetch('/user?access_token=' + encodeURIComponent(token)); if (resp.ok) return true;
    if (resp.status === 403) throw err('unauthorized', '令牌无效，请核对后重新填写');
    throw err('api', '令牌验证失败（HTTP ' + resp.status + '）');
  }
  /* 读云端：data/sync.json → 404 回退仓库根 sync.json；都无 → null（云端无文件） */
  async function readRemote() {
    const cfg = getConfig(); if (!cfg) return null;
    for (const p of [FILE_PATH, ROOT_PATH]) {
      const resp = await apiFetch('/repos/' + repoPath(cfg.repo) + '/contents/' + p + '?access_token=' + encodeURIComponent(cfg.token));
      if (resp.status === 404) continue;
      if (!resp.ok) throw err('repo404', '读不到云端仓库（HTTP ' + resp.status + '），请核对仓库名');
      let j; try { j = await resp.json(); } catch { throw err('api', '云端数据读取失败'); }
      if (!j || typeof j.content !== 'string') throw err('api', '云端数据文件格式不正确');
      return { path: p, sha: j.sha, content: j.content };
    }
    return null;
  }
  /* 写云端：PUT 带 sha 乐观锁；422 = sha 失效，由调用方重走冲突流程 */
  async function writeRemote(remote, file) {
    const cfg = getConfig();
    const paths = (remote && remote.path) ? [remote.path] : [FILE_PATH, ROOT_PATH];
    let lastErr = null;
    for (const p of paths) {
      const body = { access_token: cfg.token, content: bytesToB64(utf8ToBytes(JSON.stringify(file))), message: '健康记录同步', branch: 'master' };
      if (remote && remote.sha) body.sha = remote.sha;
      const resp = await apiFetch('/repos/' + repoPath(cfg.repo) + '/contents/' + p, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (resp.status === 422) throw err('conflict', '云端文件刚被其他设备修改');
      if (resp.status === 404) { lastErr = err('repo404', '云端仓库不存在或无法写入 ' + p + '，请核对仓库名'); continue; }
      if (!resp.ok) { lastErr = err('api', '写入云端失败（HTTP ' + resp.status + '）'); continue; }
      let j = {}; try { j = await resp.json(); } catch { /* 响应体可选 */ }
      return { path: p, sha: (j && j.content && j.content.sha) || '' };
    }
    throw lastErr || err('api', '写入云端失败');
  }
  /* —— 本地存储访问（业务数据 + 侧键，全部经注入的 storage） —— */
  function getDB() {
    const st = storage(); if (!st) return null;
    try {
      const raw = st.getItem(LS_KEY); if (!raw) return null; const d = JSON.parse(raw); if (d && Array.isArray(d.persons) && d.data && typeof d.data === 'object') return d;
    } catch {}
    return null;
  }
  function setDB(db) { const st = storage(); if (!st) throw err('storage', '本机存储不可用'); st.setItem(LS_KEY, JSON.stringify(db)); }
  function readMeta() {
    const st = storage(); if (!st) return {};
    try { const m = JSON.parse(st.getItem(META_KEY) || 'null'); return (m && typeof m === 'object') ? m : {}; } catch { return {}; }
  }
  function writeMeta(m) { const st = storage(); if (st) { try { st.setItem(META_KEY, JSON.stringify(m)); } catch {} } }
  function lastUpdated() { return Number(readMeta().lastUpdated) || 0; }
  function setLastUpdated(ts) { const m = readMeta(); m.lastUpdated = ts; writeMeta(m); }
  function markSynced() { const m = readMeta(); m.lastSyncAt = currentTime(); writeMeta(m); }
  function getConfig() {
    const st = storage(); if (!st) return null;
    try { const c = JSON.parse(st.getItem(CONFIG_KEY) || 'null'); return (c && typeof c === 'object' && c.token && c.repo) ? c : null; } catch { return null; }
  }
  function writeConfig(c) { const st = storage(); if (st) { try { st.setItem(CONFIG_KEY, JSON.stringify(c)); } catch {} } }
  function deviceId() { const c = getConfig(); return (c && c.deviceId) || ''; }
  function genId() { return 'dev-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  /* —— 暂存队列（§2.3/§2.7：网络失败入队，online 事件或手动重试重放） —— */
  function pendingOps() { return readMeta().pending || []; }
  function addPending(op) {
    const m = readMeta();
    m.pending = m.pending || []; m.pending.push({ op, at: currentTime() });
    if (m.pending.length > 20) m.pending = m.pending.slice(-20);
    writeMeta(m);
  }
  function clearPending() { const m = readMeta(); if (m.pending && m.pending.length) { m.pending = []; writeMeta(m); } }
  function pendingCount() { return pendingOps().length; }
  /* —— 覆盖前备份 + 轮换（§2.4：syncBackup_<日期>，保留最近 3 份，写新前删最旧） —— */
  function storageKeys(st) {
    if (typeof st.length === 'number' && typeof st.key === 'function') {
      const out = []; for (let i = 0; i < st.length; i++) out.push(st.key(i)); return out;
    }
    return Object.keys(st);
  }
  function backupLocal() {
    const st = storage(); const db = getDB();
    if (!st || !db) return null;
    const d = new Date(currentTime());
    const dateStr = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    const timeStr = `${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
    let key = BACKUP_PREFIX + dateStr;
    if (st.getItem(key) !== null) key = BACKUP_PREFIX + dateStr + '_' + timeStr; // 同日多份不互相覆盖
    try { st.setItem(key, JSON.stringify(db)); } catch { return null; }
    rotateBackups();
    return key;
  }
  /* 覆盖云端前把远端（败者）备份到本机（§2.6「败者备份」；本机胜/冲突选本机时调用） */
  async function backupRemotePayload(remoteFile) {
    const st = storage(); if (!st || !remoteFile) return null;
    const db = await decodePayloadDB(remoteFile).catch(() => null); if (!db) return null;
    const d = new Date(currentTime());
    const dateStr = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    const timeStr = `${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
    let key = BACKUP_PREFIX + 'remote_' + dateStr;
    if (st.getItem(key) !== null) key = BACKUP_PREFIX + 'remote_' + dateStr + '_' + timeStr;
    try { st.setItem(key, JSON.stringify(db)); } catch { return null; }
    rotateBackups();
    return key;
  }
  function rotateBackups() {
    const st = storage(); if (!st) return;
    const keys = storageKeys(st).filter((k) => String(k).indexOf(BACKUP_PREFIX) === 0).sort();
    while (keys.length > BACKUP_KEEP) { const oldest = keys.shift(); try { st.removeItem(oldest); } catch {} }
  }
  /* —— 冲突确认（§2.5：三选一由 js/sync-ui.js 注入；缺省回退 window.confirm） —— */
  function askConflict(newerSide) {
    const side = newerSide === 'remote' ? '云端数据比本机新' : '本机数据比云端新';
    return Promise.resolve(confirmFn()(side + '。覆盖前会把另一边数据备份到本机，是否继续？'))
      .then((choice) => ((choice === 'remote' || choice === 'local' || choice === 'cancel') ? choice : 'cancel'));
  }
  function remoteWins(remoteTs, localTs) { return applyOffset(remoteTs) > localTs; }
  /* —— 远端文件解析/构建（§2.2 载荷 {v, updatedAt, rev, deviceId, payload}） —— */
  async function parseRemoteFile(remote) {
    let text; try { text = bytesToUtf8(b64ToBytes(remote.content)); } catch { throw err('api', '云端数据解码失败'); }
    let f; try { f = JSON.parse(text); } catch { throw err('api', '云端数据文件损坏'); }
    if (!f || typeof f !== 'object' || typeof f.payload !== 'string') throw err('api', '云端数据文件格式不正确');
    return { path: remote.path, sha: remote.sha, v: f.v, updatedAt: Number(f.updatedAt) || 0, rev: Number(f.rev) || 0, deviceId: f.deviceId || '', payload: f.payload };
  }
  async function buildRemoteFile(db, remoteFile) {
    const enc = await encodePayload(db);
    return { v: 1, updatedAt: lastUpdated() || currentTime(), rev: ((remoteFile && remoteFile.rev) || 0) + 1, deviceId: deviceId(), payload: enc.b64 };
  }
  function decodePayloadDB(remoteFile) { return decodePayload(remoteFile.payload); }
  function countPersons(db) { return (db && Array.isArray(db.persons)) ? db.persons.length : 0; }
  function minimalDB() { return { persons: [], current: '', data: {} }; }
  /* —— 首启判定：本机是否「无实际数据」（新设备自动播种的空默认库不算数据） —— */
  function isEmptyUserDB(db) {
    if (!db || typeof db.data !== 'object') return true;
    for (const pid of Object.keys(db.data)) {
      const c = db.data[pid] || {};
      if ((c.records || []).length || (c.periods || []).length) return false; if ((c.items || []).some((i) => !i.key)) return false;
      if (c.bpNote || c.gluNote) return false;
      if (c.ins && (c.ins.insurer || c.ins.plan || c.ins.coverage || c.ins.phone || c.ins.notes)) return false;
    }
    return true;
  }
  function localIsVirgin(db) {
    if (db === null) return true;                             // 本机无数据（§2.6 情形二）
    if (typeof DB_AUTOSEEDED === 'undefined') return false;   // 单测/独立环境：交由测试控制
    return DB_AUTOSEEDED && isEmptyUserDB(db);                // 本次会话自动播种且尚无用户数据
  }
  /* —— 共享动作：远端数据落地（备份本机 → 覆盖 → lastUpdated 重置 → 标记已同步） —— */
  async function applyRemote(remoteFile) {
    const hadLocal = !!getDB();
    const backupKey = backupLocal();
    if (hadLocal && !backupKey) throw err('storage', '本机存储已满，无法先备份旧数据，已停止覆盖以免丢失');
    const db = await decodePayloadDB(remoteFile);
    setDB(db); setLastUpdated(remoteFile.updatedAt);
    setState(STATE.CONNECTED); markSynced();
    return { backupKey, persons: countPersons(db) };
  }
  /* 共享动作：本机数据上传（构建载荷 → PUT → lastUpdated 落定 → 清队列 → 标记已同步） */
  async function putLocalFile(remoteFile, db) {
    const file = await buildRemoteFile(db, remoteFile); const wrote = await writeRemote(remoteFile, file);
    setLastUpdated(file.updatedAt); clearPending();
    setState(STATE.CONNECTED); markSynced();
    return wrote;
  }
  /* 共享动作：冲突三选一（§2.5）；选「用云端」已在此落地（备份+覆盖） */
  async function resolveConflict(remoteFile, newerSide) {
    setState(STATE.CONFLICT);
    const choice = await askConflict(newerSide || 'remote');
    if (choice === 'remote') return { choice, applied: await applyRemote(remoteFile) };
    setState(STATE.CONNECTED); return { choice };
  }
  /* —— 失败归位（§2.3：网络失败 → 离线+入队；限流 → 错误+入队稍后重试；其余 → 错误） —— */
  function fail(e) {
    if (e && (e.code === 'network' || e.code === 'ratelimit')) {
      setState(e.code === 'network' ? STATE.OFFLINE : STATE.ERROR); addPending('push');
      return { ok: false, code: e.code === 'network' ? 'offline' : 'ratelimit', pending: pendingCount(), message: e.message };
    }
    setState(STATE.ERROR);
    return { ok: false, code: (e && e.code) || 'error', message: (e && e.message) || '同步失败' };
  }
  /* —— push（§2.4.2：远端新 → 冲突弹窗；本机新 → PUT 带 sha；422 → 重读重走，用例 C7） —— */
  async function push() {
    const cfg = getConfig(); if (!cfg) return { ok: false, code: 'unconfigured', message: '尚未配置云同步' };
    setState(STATE.SYNCING);
    try {
      const remote = await readRemote();
      const remoteFile = remote ? await parseRemoteFile(remote) : null;
      if (remoteFile && remoteWins(remoteFile.updatedAt, lastUpdated())) {
        const r = await resolveConflict(remoteFile, 'remote');
        if (r.choice === 'remote') return { ok: true, action: 'pulled', backupKey: r.applied.backupKey, persons: r.applied.persons };
        if (r.choice === 'cancel') return { ok: false, code: 'cancelled', message: '已取消' };
        // choice === 'local' → 继续下方 PUT（本机覆盖云端，覆盖前备份云端败者）
      }
      const db = getDB(); if (!db) { setState(STATE.CONNECTED); return { ok: true, code: 'nodata' }; }
      if (remoteFile) await backupRemotePayload(remoteFile); // 本机覆盖云端前备份败者
      const wrote = await putLocalFile(remoteFile, db);
      return { ok: true, action: 'pushed', path: wrote.path };
    } catch (e) {
      if (e && e.code === 'conflict') { // PUT 422：sha 失效 → 重读远端 → 冲突弹窗，绝不静默覆盖
        let freshFile = null;
        try { const fresh = await readRemote(); freshFile = fresh ? await parseRemoteFile(fresh) : null; } catch (e2) { return fail(e2); }
        const side = (freshFile && remoteWins(freshFile.updatedAt, lastUpdated())) ? 'remote' : 'local';
        const r = await resolveConflict(freshFile, side);
        if (r.choice === 'remote') return { ok: true, action: 'pulled', backupKey: r.applied.backupKey, persons: r.applied.persons };
        if (r.choice === 'local') { // 用本机：先备份云端败者，再带上新 sha 写一次
          try { if (freshFile) await backupRemotePayload(freshFile); await putLocalFile(freshFile, getDB()); return { ok: true, action: 'pushed' }; } catch (e2) { return fail(e2); }
        }
        return { ok: false, code: 'cancelled', message: '已取消' };
      }
      return fail(e);
    }
  }
  /* —— pull（§2.4.3：远端新 → 自动备份+覆盖+重置 lastUpdated；否则不动） —— */
  async function pull() {
    const cfg = getConfig(); if (!cfg) return { ok: false, code: 'unconfigured', message: '尚未配置云同步' };
    setState(STATE.SYNCING);
    try {
      const remote = await readRemote();
      if (!remote) { setState(STATE.CONNECTED); markSynced(); return { ok: true, code: 'nomote' }; }
      const remoteFile = await parseRemoteFile(remote);
      if (remoteWins(remoteFile.updatedAt, lastUpdated())) {
        const a = await applyRemote(remoteFile);
        return { ok: true, action: 'pulled', backupKey: a.backupKey, persons: a.persons };
      }
      setState(STATE.CONNECTED); markSynced();
      return { ok: true, code: 'uptodate' };
    } catch (e) { return fail(e); }
  }
  /* —— 立即同步：先拉后推；拉到新数据就跳过推（避免无意义回写） —— */
  async function syncNow() {
    const p = await pull();
    if (p.ok && p.action === 'pulled') return { ok: true, pulled: true, result: p };
    const q = await push(); return { ok: q.ok, pulled: false, pushed: q };
  }
  /* —— 连接并首次同步（R18/R20，§2.6 迁移三情形） —— */
  async function connect(token, repo) {
    token = String(token || '').trim(); repo = String(repo || '').trim();
    if (!token || !repo) return { ok: false, code: 'invalid', message: '请填写令牌和仓库名' };
    setState(STATE.CONFIGURING);
    try { await verifyToken(token); } catch (e) { return fail(e); }
    const prev = getConfig(); writeConfig({ token, repo, deviceId: (prev && prev.deviceId) || genId() });
    setState(STATE.CONNECTED);
    return firstSync();
  }
  async function firstSync() {
    const db = getDB();
    const virgin = localIsVirgin(db); // 新设备自动播种的空默认库按「本机无」处理（防覆盖云端真实数据）
    let remote = null, remoteFile = null;
    try { remote = await readRemote(); remoteFile = remote ? await parseRemoteFile(remote) : null; } catch (e) { return fail(e); }
    const localTs = lastUpdated();
    if (!remoteFile && db) { // 情形一：云端无 + 本机有 → 上传本机（迁移完成）
      try { await putLocalFile(null, db); return { ok: true, code: 'uploaded', persons: countPersons(db) }; } catch (e) { return fail(e); }
    }
    if (!remoteFile && !db) { // 用例 C8：两边都无 → 上传空初始状态，无报错
      try { await putLocalFile(null, minimalDB()); return { ok: true, code: 'uploaded-empty', persons: 0 }; } catch (e) { return fail(e); }
    }
    if (remoteFile && virgin) { // 情形二 + 新设备空库：云端有 → 下载，提示「已从云端恢复数据」
      const a = await applyRemote(remoteFile);
      return { ok: true, code: 'restored', persons: a.persons };
    }
    if (remoteWins(remoteFile.updatedAt, localTs)) { // 情形三（远端新）：新者胜+败者备份（§2.6）
      const a = await applyRemote(remoteFile);
      return { ok: true, code: 'migrated-remote-won', backupKey: a.backupKey, persons: a.persons };
    }
    const remoteBackupKey = await backupRemotePayload(remoteFile); // 情形三（本机新）：云端败者先备份
    try { await putLocalFile(remoteFile, db); return { ok: true, code: 'migrated-local-won', remoteBackupKey, persons: countPersons(db) }; } catch (e) { return fail(e); }
  }
  /* —— 重放暂存队列（§2.3） —— */
  async function replayPending() {
    if (!getConfig()) return { ok: false, code: 'unconfigured', message: '尚未配置云同步' };
    if (!pendingCount()) return { ok: true, code: 'empty' };
    return push();
  }
  /* —— 状态与文案（§8 UI#2） —— */
  function getState() { return state; }
  function setState(s) { state = s; }
  function statusText() {
    const meta = readMeta(); switch (state) {
      case STATE.UNCONFIGURED: return '❌ 未设置（点此配置）';
      case STATE.CONFIGURING: return '🔄 正在验证令牌…';
      case STATE.SYNCING: return '🔄 同步中…';
      case STATE.CONFLICT: return '⚠️ 数据冲突，等待选择';
      case STATE.OFFLINE: return '⚠️ 离线，改动已暂存';
      case STATE.CONNECTED: { if (meta.lastSyncAt) { const d = new Date(meta.lastSyncAt); return '✅ 已同步 ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()); } return '✅ 已连接'; }
      default: return '❌ 同步出错';
    }
  }
  /* —— 导出 —— */
  const API = {
    inject, getState, statusText, STATE, connect, syncNow, push, pull, replayPending, pendingCount,
    verifyToken, getConfig, lastUpdated, setLastUpdated, getDB, setDB, backupLocal, rotateBackups, deviceId,
    META_KEY, CONFIG_KEY, LS_KEY, FILE_PATH, isEmptyUserDB, localIsVirgin,
  };
  global.Sync = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
