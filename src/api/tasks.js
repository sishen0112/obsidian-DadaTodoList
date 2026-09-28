// 任务数据层（Obsidian vault 版）。
// 数据来源：每日笔记正文中的 Markdown 复选框（- [ ] / - [x]）。
// 三个数据位置均为动态解析：
//   1. 每日笔记：跟随核心「日记」插件的 folder / format 配置（社区 Periodic Notes 兜底）
//   2. 收件箱（无日期任务）：设置项 inboxFile，默认库根目录 DadaTodoList.md
//   3. 清单：设置项 checklistTag（默认 todoList）——frontmatter tags 含该标签的笔记即清单文件
// 与网页版 tasks-server.js 语义一致：guid = `日期键#行号`，日期跨文件移动整块。
import { moment, TFile } from 'obsidian';
import {
  INBOX_KEY, CHILD_INDENT,
  parseTasks, toRecord, serializeBlock, serializeTaskLine,
  nodeFromTask, locateNode, collectLineNos, todayKey, parseGuid, msToTime, dateToMs, flattenTasks
} from '../composables/tasks-logic.js';

let plugin = null;
export function initTasksApi(p) { plugin = p; }

// 自写标记：插件自身的写操作也会触发 vault / metadataCache 事件，
// 视图层的「外部变更自动刷新」据此跳过自身引起的变更，避免无谓的重复加载。
let lastSelfWriteAt = 0;
function noteSelfWrite() { lastSelfWriteAt = Date.now(); }
export function isExternalChange() { return Date.now() - lastSelfWriteAt > 1200; }

// 清单键前缀：键形如 `cl:<相对路径（不含 .md）>`，guid 形如 `cl:路径#行号`
const CL_PREFIX = 'cl:';
const isListKey = (k) => String(k || '').indexOf(CL_PREFIX) === 0;
const listRelOf = (k) => String(k || '').slice(CL_PREFIX.length).replace(/^\/+|\/+$/g, '');
// 清单显示名 = 路径去目录、去扩展名
const listNameOf = (k) => listRelOf(k).split('/').pop();

// ---------- 数据位置解析 ----------

const normFolder = (p) => String(p || '').replace(/^\/+|\/+$/g, '');

// 核心插件「日记」配置（folder + format）；社区 Periodic Notes 兜底；均不可用返回 null
function dailyNotesConfig() {
  try {
    const ip = plugin.app.internalPlugins;
    let inst = null;
    // 首选 getEnabledPluginById：仅在插件处于「启用」状态时返回实例（未启用返回 undefined 或抛错）。
    // 注意不能只判 getPluginById().instance —— 未启用的内部插件其 instance 也存在。
    try { inst = (ip.getEnabledPluginById && ip.getEnabledPluginById('daily-notes')) || null; } catch (e) { inst = null; }
    // 版本差异兜底：wrapper.enabled 明确为真时才采用 instance
    if (!inst && ip.getPluginById) {
      const core = ip.getPluginById('daily-notes');
      inst = (core && core.enabled === true && core.instance) || null;
    }
    const o = inst && inst.options;
    if (o) {
      return {
        folder: typeof o.folder === 'string' ? normFolder(o.folder) : '',
        format: typeof o.format === 'string' && o.format ? o.format : 'YYYY-MM-DD'
      };
    }
  } catch (e) { /* 忽略 */ }
  try {
    const pn = plugin.app.plugins && plugin.app.plugins.getPlugin('periodic-notes');
    const d = pn && pn.settings && pn.settings.daily;
    if (d) {
      return {
        folder: typeof d.folder === 'string' ? normFolder(d.folder) : '',
        format: typeof d.format === 'string' && d.format ? d.format : 'YYYY-MM-DD'
      };
    }
  } catch (e) { /* 忽略 */ }
  // 均不可用：视为未启用日记插件（有日期任务不可用，启动时 Notice 引导开启）
  return null;
}

/** 核心日记插件是否可用（决定有日期任务的读写能力） */
export function hasDailyNotesConfig() {
  return !!dailyNotesConfig();
}

function inboxPath() {
  const p = String((plugin.settings && plugin.settings.inboxFile) || 'DadaTodoList.md').replace(/^\/+|\/+$/g, '');
  return p || 'DadaTodoList.md';
}

function checklistTags() {
  const s = plugin.settings && plugin.settings.checklistTags;
  const arr = Array.isArray(s) ? s.map((x) => String(x).trim()).filter(Boolean) : [];
  return arr.length ? arr : ['todoList'];
}

// 收件箱文件不存在时创建（含 frontmatter），启动时调用
export async function ensureInboxFile() {
  const path = inboxPath();
  const v = vault();
  if (v.getAbstractFileByPath(path)) return;
  await ensureFolder(path.split('/').slice(0, -1).join('/'));
  await v.create(path, INBOX_HEAD);
}

// 统计收件箱文件中的任务块数（换路径时的迁移提示用）
export async function countInboxTasks(path) {
  if (!path) return 0;
  const v = vault();
  if (!(v.getAbstractFileByPath(path) instanceof TFile)) return 0;
  const doc = await readTasks(path, INBOX_KEY);
  return doc.roots.length;
}

// 一次性迁移：把旧收件箱的全部任务块（含子任务/描述）追加到新收件箱，旧文件仅保留 frontmatter
export async function migrateInboxTasks(fromPath, toPath) {
  if (!fromPath || !toPath || fromPath === toPath) return 0;
  const v = vault();
  if (!(v.getAbstractFileByPath(fromPath) instanceof TFile)) return 0;
  const from = await readTasks(fromPath, INBOX_KEY);
  if (!from.roots.length) return 0;
  const to = await readTasks(toPath, INBOX_KEY);
  const out = to.lines.slice();
  while (out.length && !out[out.length - 1].trim()) out.pop();
  if (out.length) out.push('');
  for (const node of from.roots) out.push(...serializeBlock(node, ''));
  await writeTasks(toPath, to.head, out);
  await writeTasks(fromPath, from.head, []);
  noteSelfWrite();
  return from.roots.length;
}

// 新建笔记时的 frontmatter（与 vault 既有模板一致的最小集）
const DAILY_HEAD = '---\ntags:\n  - journal\n---\n\n';
const INBOX_HEAD = '---\ntags:\n  - task\n---\n\n';

const DATE_FILE_RE = /^\d{4}-\d{2}-\d{2}\.md$/;

function defaultHead(dateKey) {
  return (dateKey === INBOX_KEY || isListKey(dateKey)) ? INBOX_HEAD : DAILY_HEAD;
}

function res(status, body) { return { status, body }; }

function vault() { return plugin.app.vault; }

// 某日期（或收件箱 / 清单）对应的 vault 内路径；非法键返回 null
export function taskFilePath(dateKey) {
  if (isListKey(dateKey)) {
    const rel = listRelOf(dateKey);
    if (!rel || /(^|\/)\.\.(\/|$)/.test(rel)) return null;
    return `${rel}.md`;
  }
  if (dateKey === INBOX_KEY) return inboxPath();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ''));
  if (!m) return null;
  // 每日笔记路径 = 日记插件 folder + moment(dateKey).format(日记格式)
  // （格式中可含字面量目录，如 YYYY/Daily/MM/YYYY-MM-DD）
  const cfg = dailyNotesConfig();
  if (!cfg) return null; // 未启用日记插件：有日期任务不可用
  const rel = moment(dateKey).format(cfg.format);
  const full = rel.indexOf(dateKey) >= 0 ? rel : `${rel}/${dateKey}`;
  return cfg.folder ? `${cfg.folder}/${full}.md` : `${full}.md`;
}

function splitDoc(raw) {
  const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(raw || '');
  if (!m) return { head: '', body: raw || '' };
  return { head: m[0], body: raw.slice(m[0].length) };
}

// 读取并解析任务文件（不存在时返回空结构，不建文件）
async function readTasks(path, dateKey) {
  const file = vault().getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return { head: defaultHead(dateKey), lines: [], roots: [] };
  const { head, body } = splitDoc(await vault().cachedRead(file));
  const parsed = parseTasks(body);
  return { head, lines: parsed.lines, roots: parsed.roots };
}

async function writeTasks(path, head, lines) {
  const v = vault();
  const file = v.getAbstractFileByPath(path);
  const doc = head + lines.join('\n');
  if (file instanceof TFile) {
    await v.modify(file, doc);
  } else {
    await ensureFolder(path.split('/').slice(0, -1).join('/'));
    await v.create(path, doc);
  }
}

async function ensureFolder(pathWithoutFile) {
  // 空路径 = 库根目录：无需创建（启动早期文件树缓存未就绪时，
  // getAbstractFileByPath('') 会返回 null，进而 createFolder('') 抛 "Folder already exists"）
  if (!pathWithoutFile) return;
  const v = vault();
  let cur = '';
  for (const seg of pathWithoutFile.split('/')) {
    if (!seg) continue;
    cur = cur ? `${cur}/${seg}` : seg;
    if (!v.getAbstractFileByPath(cur)) await v.createFolder(cur);
  }
}

// 加载窗口（天）：'all' 或数字，控制每日笔记的读取范围（以今天为中心的对称窗口，默认 'all'，大库可调小）
function loadWindowDays() {
  const v = plugin.settings && plugin.settings.dailyLoadWindow;
  if (v === 'all' || v == null) return 'all';
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 'all';
}

// 收集全部每日笔记：日记文件夹（含子目录）下、文件名为 YYYY-MM-DD.md 的笔记，
// 且日期落在以今天为中心的对称窗口内 [今天-win天, 今天+win天]（设置 dailyLoadWindow，默认全部；大库可调小避免全量读取）
function listDailyFiles() {
  const cfg = dailyNotesConfig();
  if (!cfg) return [];
  const folder = cfg.folder;
  const re = /^\d{4}-\d{2}-\d{2}\.md$/;
  const win = loadWindowDays();
  const lower = win === 'all' ? null : todayKey(Date.now() - Number(win) * 86400000);
  const upper = win === 'all' ? null : todayKey(Date.now() + Number(win) * 86400000);
  const all = vault().getMarkdownFiles()
    .filter((f) => (folder ? f.path.indexOf(folder + '/') === 0 : f.path.indexOf('/') < 0) && re.test(f.name))
    .map((f) => ({ key: f.name.replace(/\.md$/, ''), path: f.path }));
  const filtered = all.filter((e) => (lower == null || (e.key >= lower && e.key <= upper)));
  return filtered;
}

// 全库扫描：frontmatter tags 含任一「清单标记」的 md 文件 → [{ key: 'cl:<相对路径>', path, name }]
// 注意：tags 数组可能含 null 项（YAML 空值），匹配前先归一化为字符串
function checklistFileEntries() {
  const wanted = checklistTags();
  if (!wanted.length) return [];
  const mc = plugin.app.metadataCache;
  const out = [];
  for (const f of vault().getMarkdownFiles()) {
    const cache = mc.getFileCache(f);
    const fm = cache && cache.frontmatter;
    if (!fm) continue;
    const raw = fm.tags;
    const tags = Array.isArray(raw)
      ? raw.filter((x) => x != null).map((x) => String(x))
      : (typeof raw === 'string' ? raw.split(',').map((s) => s.trim()) : []);
    const hit = tags.some((x) => wanted.some((t) => x === t || x.indexOf(t + '/') === 0));
    if (!hit) continue;
    const rel = f.path.replace(/\.md$/i, '');
    out.push({ key: CL_PREFIX + rel, path: f.path, name: f.name.replace(/\.md$/i, '') });
  }
  return out;
}

// ---------- 读 ----------
// 列出全部清单（文件名即清单名，附任务统计）
async function listChecklists() {
  const items = [];
  for (const e of checklistFileEntries()) {
    const doc = await readTasks(e.path, e.key);
    const all = flattenTasks(doc.roots);
    items.push({ key: e.key, name: e.name, total: all.length, done: all.filter((n) => n.completed).length });
  }
  items.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
  return res(200, { ok: true, count: items.length, items });
}

// 读取单个清单，并按 ### 三级标题分组（清单文件支持用 ### 标题 作为分组分隔）。
// 任务归属到其之前最近的一个 ### 标题；标题前的任务归入「未分组」。
export async function loadChecklistGroups(listKey) {
  const path = taskFilePath(listKey);
  if (!path) return res(400, { ok: false, reason: 'bad_list' });
  const doc = await readTasks(path, listKey);
  // 收集 ### 标题的行号与文字（仅三级标题，与用户约定一致）
  const headings = [];
  doc.lines.forEach((line, idx) => {
    const m = /^###\s+(.+?)\s*$/.exec(line);
    if (m) headings.push({ lineNo: idx, title: m[1].trim() });
  });
  const records = flattenTasks(doc.roots).map((n) => toRecord(listKey, n));
  const titled = headings.map((h) => ({ title: h.title, tasks: [] }));
  const ungrouped = [];
  for (const t of records) {
    let gi = -1;
    for (let i = 0; i < headings.length; i++) {
      if (headings[i].lineNo < t.lineNo) gi = i; else break;
    }
    if (gi < 0) ungrouped.push(t); else titled[gi].tasks.push(t);
  }
  const groups = [];
  if (ungrouped.length) groups.push({ title: '', tasks: ungrouped });
  groups.push(...titled);
  const done = records.filter((t) => t.completed && !t.cancelled).length;
  return res(200, { ok: true, key: listKey, name: listNameOf(listKey), groups, total: records.length, done });
}
async function listTasks(opts = {}) {
  let files;
  if (opts.list) {
    const path = taskFilePath(opts.list);
    if (!path) return res(400, { ok: false, reason: 'bad_list' });
    files = [{ key: opts.list, path }];
  } else if (opts.date) {
    const path = taskFilePath(opts.date);
    if (!path) return res(400, { ok: false, reason: 'bad_date' });
    files = [{ key: opts.date, path }];
  } else {
    files = listDailyFiles();
    files.push({ key: INBOX_KEY, path: taskFilePath(INBOX_KEY) });
    // 清单文件参与默认聚合，但仅汇入含 📅 日期的任务；无日期任务只在清单视图出现
    files.push(...checklistFileEntries().map((e) => Object.assign(e, { aggregateOnly: true })));
  }
  const items = [];
  for (const f of files) {
    const doc = await readTasks(f.path, f.key);
    for (const node of doc.roots) {
      if (f.aggregateOnly && !node.due) continue;
      items.push(toRecord(f.key, node));
    }
  }
  return res(200, { ok: true, count: items.length, items });
}

// ---------- 便捷导出（useTasks 直接消费，签名对齐网页版 useTasks 的网络函数） ----------
export const loadAll = () => listTasks();
export const loadByDate = (dateKey) => listTasks({ date: dateKey });
export const loadByList = (listKey) => listTasks({ list: listKey });
export async function getDetail(guid) {
  const g = parseGuid(guid);
  if (!g) return null;
  const r = await loadByDate(g.dateKey);
  return r.body.items.find((t) => t.guid === guid) || null;
}
export const loadChecklists = () => listChecklists();

// 列出某任务的子任务
export async function listSubtasks(parentGuid) {
  const g = parseGuid(parentGuid);
  if (!g) return res(400, { ok: false, reason: 'bad_guid' });
  const path = taskFilePath(g.dateKey);
  if (!path) return res(400, { ok: false, reason: 'bad_guid' });
  const doc = await readTasks(path, g.dateKey);
  const node = locateNode(doc.roots, { lineNo: g.lineNo });
  if (!node) return res(404, { ok: false, reason: 'not_found' });
  const items = node.children.map((c) => toRecord(g.dateKey, c, { parentGuid }));
  return res(200, { ok: true, count: items.length, items });
}

// ---------- 写 ----------
// 追加到文件末尾（去掉尾部空行后补一个空行）
function appendLines(lines, node, indentStr) {
  const out = lines.slice();
  while (out.length && !out[out.length - 1].trim()) out.pop();
  if (out.length) out.push('');
  const lineNo = out.length;
  out.push(...serializeBlock(node, indentStr));
  return { out, lineNo };
}

// 新建任务：有日期写入该日每日笔记，无日期写入收件箱；指定清单则写入该清单文件
export async function createTask(task) {
  noteSelfWrite();
  const t = task || {};
  if (!String(t.summary || '').trim()) return res(400, { ok: false, reason: 'missing_summary' });
  const listKey = isListKey(t.list) ? String(t.list) : '';
  const dateKey = listKey || (t.dueAt ? todayKey(Number(t.dueAt)) : INBOX_KEY);
  const path = taskFilePath(dateKey);
  if (!path) return res(400, { ok: false, reason: 'bad_date' });
  const doc = await readTasks(path, dateKey);
  const node = nodeFromTask(t, dateKey);
  // 清单文件没有「文件日期」，任务日期写进行内 📅 标记
  if (listKey && t.dueAt) node.due = todayKey(Number(t.dueAt));
  const { out, lineNo } = appendLines(doc.lines, node, '');
  await writeTasks(path, doc.head, out);
  return res(201, { ok: true, task: toRecord(dateKey, Object.assign({}, node, { lineNo })) });
}

// 在清单指定分组的最后一行追加任务。
// groupTitle 为空串 → 未分组（追加到首个 ### 之前；无 ### 则文件末尾）；
// 否则定位 ### groupTitle 标题，插入到下一个 ### 之前（无下一个 ### 则文件末尾）。
export async function createChecklistTask(listKey, groupTitle, task) {
  noteSelfWrite();
  const t = task || {};
  if (!String(t.summary || '').trim()) return res(400, { ok: false, reason: 'missing_summary' });
  if (!isListKey(listKey)) return res(400, { ok: false, reason: 'bad_list' });
  const path = taskFilePath(listKey);
  if (!path) return res(400, { ok: false, reason: 'bad_list' });
  const doc = await readTasks(path, listKey);
  const node = nodeFromTask(t, listKey);
  if (t.dueAt) node.due = todayKey(Number(t.dueAt));
  const newLine = serializeTaskLine(node, '');

  const headings = [];
  doc.lines.forEach((line, idx) => {
    const m = /^###\s+(.+?)\s*$/.exec(line);
    if (m) headings.push({ idx, title: m[1].trim() });
  });

  let insertAt;
  if (!groupTitle) {
    insertAt = headings.length ? headings[0].idx : doc.lines.length;
  } else {
    const h = headings.find((x) => x.title === groupTitle);
    if (!h) return res(404, { ok: false, reason: 'group_not_found' });
    const next = headings.find((x) => x.idx > h.idx);
    insertAt = next ? next.idx : doc.lines.length;
  }

  const lines = doc.lines.slice();
  lines.splice(insertAt, 0, newLine);
  await writeTasks(path, doc.head, lines);
  const created = Object.assign({}, node, { lineNo: insertAt });
  return res(201, { ok: true, task: toRecord(listKey, created) });
}

// 将清单内任务移动到另一个分组（同文件内移动整块：删旧块 + 插入到目标分组末尾）。
// targetGroupTitle 为空串 → 未分组（首个 ### 之前；无 ### 则文件末尾）；
// 否则定位 ### targetGroupTitle 标题，插入到下一个 ### 之前（无下一个则文件末尾）。
export async function moveChecklistTask(listKey, guid, targetGroupTitle) {
  noteSelfWrite();
  const g = parseGuid(guid);
  if (!g) return res(400, { ok: false, reason: 'bad_guid' });
  if (!isListKey(listKey)) return res(400, { ok: false, reason: 'bad_list' });
  const path = taskFilePath(listKey);
  if (!path) return res(400, { ok: false, reason: 'bad_list' });
  const doc = await readTasks(path, listKey);
  const node = locateNode(doc.roots, { lineNo: g.lineNo });
  if (!node) return res(404, { ok: false, reason: 'not_found' });

  // 删除原任务整块（含描述行与子任务）
  const removed = new Set(collectLineNos(node));
  const keep = doc.lines.filter((_, i) => !removed.has(i));

  // 计算目标插入位置（与 createChecklistTask 同规则）
  const headings = [];
  keep.forEach((line, idx) => {
    const m = /^###\s+(.+?)\s*$/.exec(line);
    if (m) headings.push({ idx, title: m[1].trim() });
  });
  let insertAt;
  if (!targetGroupTitle) {
    insertAt = headings.length ? headings[0].idx : keep.length;
  } else {
    const h = headings.find((x) => x.title === targetGroupTitle);
    if (!h) return res(404, { ok: false, reason: 'group_not_found' });
    const next = headings.find((x) => x.idx > h.idx);
    insertAt = next ? next.idx : keep.length;
  }

  keep.splice(insertAt, 0, ...serializeBlock(node, node.indentStr));
  await writeTasks(path, doc.head, keep);
  return res(200, { ok: true, task: toRecord(listKey, node) });
}

// 新建子任务：插入到父任务块之后，缩进一级
export async function createSubtask(parentGuid, task) {
  noteSelfWrite();
  const g = parseGuid(parentGuid);
  if (!g) return res(400, { ok: false, reason: 'bad_guid' });
  const t = task || {};
  if (!String(t.summary || '').trim()) return res(400, { ok: false, reason: 'missing_summary' });
  const path = taskFilePath(g.dateKey);
  if (!path) return res(400, { ok: false, reason: 'bad_guid' });
  const doc = await readTasks(path, g.dateKey);
  const parent = locateNode(doc.roots, { lineNo: g.lineNo });
  if (!parent) return res(404, { ok: false, reason: 'not_found' });

  const child = nodeFromTask(t, g.dateKey);
  child.indentStr = (parent.indentStr || '') + CHILD_INDENT;
  child.indent = child.indentStr.length;
  const insertAt = Math.max(...collectLineNos(parent)) + 1;
  const lines = doc.lines.slice();
  lines.splice(insertAt, 0, serializeTaskLine(child, child.indentStr));
  await writeTasks(path, doc.head, lines);
  const created = Object.assign({}, child, { lineNo: insertAt });
  return res(201, { ok: true, task: toRecord(g.dateKey, created, { parentGuid }) });
}

// 修改任务（标题/描述/完成态/日期）。日期跨文件时移动整块。
export async function updateTask(guid, patch) {
  noteSelfWrite();
  const g = parseGuid(guid);
  if (!g) return res(400, { ok: false, reason: 'bad_guid' });
  const p = patch || {};
  const path = taskFilePath(g.dateKey);
  if (!path) return res(400, { ok: false, reason: 'bad_guid' });
  const doc = await readTasks(path, g.dateKey);
  const node = locateNode(doc.roots, { lineNo: g.lineNo, summary: p.expectSummary, completed: p.expectCompleted });
  if (!node) {
    // 诊断：定位失败时输出文件现状，便于排查行号/内容失配
    console.warn('[myLife] updateTask 定位失败', {
      guid, patch: p,
      file: path,
      fileTasks: flattenTasks(doc.roots).map((n) => ({ lineNo: n.lineNo, summary: n.summary, completed: n.completed }))
    });
    return res(404, { ok: false, reason: 'not_found' });
  }

  if (p.summary != null) node.summary = String(p.summary).trim();
  if (p.description != null) {
    node.descTexts = String(p.description).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  }
  if (p.completed != null) {
    node.completed = !!p.completed;
    node.done = node.completed ? (node.done || todayKey()) : '';
  }
  // 取消 / 恢复：- [-] 标记 + ❌ 取消日期；取消时清除完成态与 ✅
  if (p.cancelled != null) {
    if (p.cancelled) {
      node.cancelMark = true;
      node.cancelled = node.cancelled || todayKey();
      node.completed = false;
      node.done = '';
    } else {
      node.cancelMark = false;
      node.cancelled = '';
    }
  }

  let targetKey = g.dateKey;
  if (Object.prototype.hasOwnProperty.call(p, 'dueAt')) {
    // 时间段结束时间：
    // - 传入了 dueEndAt 键（含 null）→ 显式以该值覆盖，null 表示清空结束时间（单时间 / 全天）；
    // - 未传入 dueEndAt 键 → 保留笔记中原有 timeEnd。
    const hasEnd = Object.prototype.hasOwnProperty.call(p, 'dueEndAt');
    const endMs = hasEnd
      ? (p.dueEndAt != null ? Number(p.dueEndAt) : null)
      : (node.timeEnd ? dateToMs(node.due || g.dateKey, node.timeEnd) : null);
    const endTime = (p.dueAllDay || !endMs) ? '' : (Number.isFinite(endMs) ? msToTime(endMs) : '');
    if (isListKey(g.dateKey)) {
      // 清单内任务：日期写进行内 📅 标记，任务保留在清单文件中
      node.due = p.dueAt == null ? '' : todayKey(Number(p.dueAt));
      node.time = (p.dueAt == null || p.dueAllDay) ? '' : msToTime(Number(p.dueAt));
      node.timeEnd = endTime;
    } else if (p.dueAt == null) {
      targetKey = INBOX_KEY;
      node.time = '';
      node.timeEnd = '';
    } else {
      targetKey = todayKey(Number(p.dueAt));
      node.time = p.dueAllDay ? '' : msToTime(Number(p.dueAt));
      node.timeEnd = endTime;
    }
  }

  const removed = new Set(collectLineNos(node));
  const keep = doc.lines.filter((_, i) => !removed.has(i));

  if (targetKey === g.dateKey) {
    keep.splice(node.lineNo, 0, ...serializeBlock(node, node.indentStr));
    await writeTasks(path, doc.head, keep);
    return res(200, { ok: true, task: toRecord(g.dateKey, node) });
  }

  // 跨文件移动：先写回源文件，再追加到目标文件末尾
  await writeTasks(path, doc.head, keep);
  const dstPath = taskFilePath(targetKey);
  if (!dstPath) return res(400, { ok: false, reason: 'bad_date' });
  const dst = await readTasks(dstPath, targetKey);
  const { out, lineNo } = appendLines(dst.lines, node, '');
  await writeTasks(dstPath, dst.head, out);
  return res(200, { ok: true, task: toRecord(targetKey, Object.assign({}, node, { lineNo })) });
}

// 删除任务（连同其描述行与子任务）
export async function deleteTask(guid) {
  noteSelfWrite();
  const g = parseGuid(guid);
  if (!g) return res(400, { ok: false, reason: 'bad_guid' });
  const path = taskFilePath(g.dateKey);
  if (!path) return res(400, { ok: false, reason: 'bad_guid' });
  const doc = await readTasks(path, g.dateKey);
  const node = locateNode(doc.roots, { lineNo: g.lineNo });
  if (!node) return res(404, { ok: false, reason: 'not_found' });
  const removed = new Set(collectLineNos(node));
  await writeTasks(path, doc.head, doc.lines.filter((_, i) => !removed.has(i)));
  return res(200, { ok: true });
}

// 勾选 / 取消勾选
export async function toggleTask(guid, done) {
  noteSelfWrite();
  const g = parseGuid(guid);
  if (!g) return res(400, { ok: false, reason: 'bad_guid' });
  const path = taskFilePath(g.dateKey);
  if (!path) return res(400, { ok: false, reason: 'bad_guid' });
  const doc = await readTasks(path, g.dateKey);
  const node = locateNode(doc.roots, { lineNo: g.lineNo });
  if (!node) return res(404, { ok: false, reason: 'not_found' });
  node.completed = !!done;
  node.done = node.completed ? (node.done || todayKey()) : '';
  if (done) { node.cancelMark = false; node.cancelled = ''; } // 勾选完成视为恢复，清除取消态
  const lines = doc.lines.slice();
  lines.splice(node.lineNo, 1, serializeTaskLine(node, node.indentStr));
  await writeTasks(path, doc.head, lines);
  return res(200, { ok: true, task: toRecord(g.dateKey, node) });
}
