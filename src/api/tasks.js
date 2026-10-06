// 任务数据层（Obsidian vault 版）。
// 数据来源：每日笔记正文中的 Markdown 复选框（- [ ] / - [x]）。
// 三个数据位置均为动态解析：
//   1. 每日笔记：跟随「日记文件夹」设置（journalFolder，默认库根 /）扫描文件名含日期的 .md；
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

// 取核心「日记 / Daily Notes」内部插件实例；非硬依赖，异常或缺失时返回 null。
function legacyDailyNotesInstance() {
  try {
    const ip = plugin.app.internalPlugins;
    if (ip.getEnabledPluginById) {
      const inst = ip.getEnabledPluginById('daily-notes');
      if (inst) return inst;
    }
    if (ip.getPluginById) {
      const core = ip.getPluginById('daily-notes');
      if (core && core.enabled === true && core.instance) return core.instance;
    }
  } catch (e) { /* 忽略 */ }
  return null;
}

// 取 Periodic Notes 插件的 daily 配置段；缺失时返回 null。
function periodicDailyConfig() {
  try {
    const pn = plugin.app.plugins && plugin.app.plugins.getPlugin('periodic-notes');
    return (pn && pn.settings && pn.settings.daily) || null;
  } catch (e) { return null; }
}

// 兼容性兜底：读取核心「日记」插件 / Periodic Notes 配置的日记文件夹（仅作未配置时的兜底，非硬依赖）
function legacyDailyFolder() {
  const o = legacyDailyNotesInstance() && legacyDailyNotesInstance().options;
  if (o && typeof o.folder === 'string' && o.folder) return normFolder(o.folder);
  const d = periodicDailyConfig();
  if (d && typeof d.folder === 'string' && d.folder) return normFolder(d.folder);
  return '';
}

// 兼容性兜底：读取核心「日记」插件 / Periodic Notes 配置的日记文件名格式（如 'YYYY-MM-DD'、'YYYY-MM-DD-ddd'）。
// 仅作未匹配到已有文件时的命名兜底，非硬依赖；未配置或格式非法时返回 ''。
function legacyDailyFormat() {
  const o = legacyDailyNotesInstance() && legacyDailyNotesInstance().options;
  let fmt = (o && typeof o.format === 'string' && o.format) ? o.format : '';
  if (!fmt) {
    const d = periodicDailyConfig();
    if (d && typeof d.format === 'string' && d.format) fmt = d.format;
  }
  if (!fmt) return '';
  // 校验格式可用，避免 moment 报错
  const probe = moment('2026-10-03', 'YYYY-MM-DD', true).format(fmt);
  return probe && probe !== 'Invalid date' ? fmt : '';
}

// 用户配置的「日记文件夹」（设置项 journalFolder，默认 '/' = 库根目录）；归一化为相对路径（库根为 ''）。
// 未显式配置（仍为默认 '/'）时，沿用日记插件的文件夹作为兼容兜底，避免老用户升级后日记丢失。
function journalFolder() {
  const set = String((plugin.settings && plugin.settings.journalFolder) || '/').trim();
  if (set && set !== '/') return normFolder(set) || '';
  return legacyDailyFolder();
}

// 解析日记模板的整份内容（核心 Daily Notes 的「模板文件位置」或 Periodic Notes 的 daily.templateFile）。
// 返回模板文件的原始全文（含 frontmatter）；无模板文件返回 ''。
// 用途：原生插件创建日记失败时，由我们整份复制模板到新日记，确保 frontmatter 与正文都生效。
async function dailyTemplateContent() {
  try {
    let tplPath = null;
    // 1) 核心 Daily Notes 的「模板文件位置」
    const inst = legacyDailyNotesInstance();
    if (inst && inst.options && typeof inst.options.template === 'string' && inst.options.template) {
      tplPath = inst.options.template;
    }
    // 2) Periodic Notes 的 daily.templateFile
    if (!tplPath) {
      const d = periodicDailyConfig();
      if (d && typeof d.templateFile === 'string' && d.templateFile) tplPath = d.templateFile;
    }
    if (!tplPath) return '';
    const file = vault().getAbstractFileByPath(tplPath);
    if (!(file instanceof TFile)) return '';
    const raw = (await vault().cachedRead(file)) || '';
    return raw.replace(/\s+$/, ''); // 去尾部空白，统一在末尾追加一个空行
  } catch (e) {
    return '';
  }
}

// 完成任务时是否在任务行追加「✅ 完成日期」标记；设置项 addDoneDateMarker，默认开
function addDoneDateEnabled() {
  return (plugin.settings && plugin.settings.addDoneDateMarker) !== false;
}
// 计算完成态对应的 done 标记日期：开启返回已有/今天，关闭返回空（不写 ✅）
function completionDoneDate(existing) {
  return addDoneDateEnabled() ? (existing || todayKey()) : '';
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
  try {
    await v.create(path, INBOX_HEAD);
  } catch (e) {
    // 启动早期文件树缓存未就绪 / 同名占用等情况下，上面「存在即返回」的检查可能漏检，
    // 导致 create 抛 File already exists。此时视为幂等成功，避免每次启动误报。
    if (e && /already exists/i.test(e.message || '')) return;
    throw e;
  }
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

// 从日记文件名解析规范日期键（YYYY-MM-DD）；无法解析返回 null。
// 不依赖日记插件：先用一组常见日期格式严格解析（涵盖 YYYY-MM-DD、YYYY-MM-DD-ddd/Sat、前后缀星期、
// 美式 MM-DD-YYYY、YYYY年MM月DD日 等），再用宽松数字抽取兜底（兼容中文星期 / 任意文字前后缀）。
function parseDailyKey(name) {
  const base = String(name || '').replace(/\.md$/i, '');
  if (!base) return null;
  const fmts = [
    'YYYY-MM-DD', 'YYYY.MM.DD', 'YYYY_MM_DD', 'YYYY/MM/DD', 'YYYY-MM-DD-ddd', 'YYYY-MM-DD-dddd',
    'ddd-YYYY-MM-DD', 'dddd-YYYY-MM-DD', 'MM-DD-YYYY', 'DD-MM-YYYY', 'MM/DD/YYYY', 'MM.DD.YYYY',
    'DD.MM.YYYY', 'YYYY-DD-MM', 'YYYY/DD/MM', 'YYYY年MM月DD日'
  ];
  for (const f of fmts) {
    const m = moment(base, f, true);
    if (m.isValid()) return m.format('YYYY-MM-DD');
  }
  // 宽松兜底：从文件名任意位置抽取数字日期（兼容中文星期 / 任意文字前后缀）
  const p2 = (x) => String(x).padStart(2, '0');
  let mm = /(\d{4})[-._/](\d{1,2})[-._/](\d{1,2})/.exec(base);
  if (mm) {
    const m = moment(`${mm[1]}-${p2(mm[2])}-${p2(mm[3])}`, 'YYYY-MM-DD', true);
    if (m.isValid()) return m.format('YYYY-MM-DD');
  }
  mm = /(\d{1,2})[-._/](\d{1,2})[-._/](\d{4})/.exec(base);
  if (mm) {
    const m = moment(`${mm[3]}-${p2(mm[1])}-${p2(mm[2])}`, 'YYYY-MM-DD', true);
    if (m.isValid()) return m.format('YYYY-MM-DD');
  }
  return null;
}

// 严格模式：文件名须以日期（或「星期-日期」）开头，避免把含日期的普通笔记误判为日记
function isStrictDailyName(base) {
  // 去掉扩展名后，允许开头是英文星期缩写/全称或中文星期，后接分隔符，再是日期；否则日期须直接开头
  const stripped = base.replace(/^(?:[A-Za-z]{3,9}|[一-龥]{2,3})[-_.\s]+/, '');
  const rest = stripped.length !== base.length ? stripped : base;
  // rest 须以 YYYY-MM-DD 等可解析日期开头（年在前或在后均可）
  return /^\d{4}[-._/]\d{1,2}[-._/]\d{1,2}/.test(rest) || /^\d{1,2}[-._/]\d{1,2}[-._/]\d{4}/.test(rest);
}

// 文件名 → 日期键：受「宽松匹配」开关控制。
//   - 宽松（默认开）：parseDailyKey 从文件名任意位置抽取日期，兼容各种个性化命名与前后缀。
//   - 严格（关）：仅当文件名以日期（或「星期-日期」）开头才视为日记，避免误判含日期的普通笔记。
function fileDateKey(name) {
  const key = parseDailyKey(name);
  if (!key) return null;
  const loose = (plugin.settings && plugin.settings.journalLooseMatch) !== false; // 默认开
  if (loose) return key;
  const base = String(name || '').replace(/\.md$/i, '');
  return isStrictDailyName(base) ? key : null;
}

function defaultHead(dateKey) {
  return (dateKey === INBOX_KEY || isListKey(dateKey)) ? INBOX_HEAD : DAILY_HEAD;
}

function res(status, body) { return { status, body }; }

function vault() { return plugin.app.vault; }

// 某日期的默认日记文件名（含 .md）：优先用核心日记插件的 format 命名，否则退化为 YYYY-MM-DD.md
function dailyBaseName(dateKey) {
  const fmt = legacyDailyFormat();
  return (fmt ? moment(dateKey, 'YYYY-MM-DD', true).format(fmt) : dateKey) + '.md';
}

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
  // 日记文件不再依赖日记插件：在用户配置的日记文件夹（含子目录）内查找该日期已有文件
  // （命名可任意：YYYY-MM-DD、YYYY-MM-DD-Sat、含中文星期、美式 MM-DD-YYYY、任意前后缀等），复用之；
  // 若目录下无该日期文件，则落在默认 YYYY-MM-DD.md（日记文件夹下）。
  const folder = journalFolder();
  const hit = vault().getMarkdownFiles().find((f) =>
    (folder ? f.path.indexOf(folder + '/') === 0 : f.path.indexOf('/') < 0) && fileDateKey(f.name) === dateKey);
  if (hit) return hit.path;
  const base = dailyBaseName(dateKey);
  return folder ? `${folder}/${base}` : base;
}

// 核心日记插件配置下的「单一」日记文件路径（文件夹 + format 命名）。
// 仅用于「新增 / 移动任务」等写操作——不论用户实际有多少同名日期的日记文件，
// 新任务一律落到核心插件约定的这一份，避免散落到多个文件中。无日期键返回 null。
function canonicalDailyPath(dateKey) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ''));
  if (!m) return null;
  const folder = journalFolder();
  const base = dailyBaseName(dateKey);
  return folder ? `${folder}/${base}` : base;
}

// 某日期对应的「所有」日记文件路径（用于读取 / 展示）：在日记文件夹（含子目录）内，
// 文件名能解析为该日期的全部 .md 笔记，可能有多个；若无任何匹配，则退化为核心插件配置的那一份。
function dailyFilesForDate(dateKey) {
  const folder = journalFolder();
  const matches = vault().getMarkdownFiles().filter((f) =>
    (folder ? f.path.indexOf(folder + '/') === 0 : f.path.indexOf('/') < 0) && fileDateKey(f.name) === dateKey);
  if (matches.length) return matches.map((f) => f.path);
  const canon = canonicalDailyPath(dateKey);
  return canon ? [canon] : [];
}

// 由 guid 解析出真实文件路径：记录自带所属文件则直接用，否则回落到 taskFilePath 单文件定位
function pathOf(g) {
  return g.file ? g.file : taskFilePath(g.dateKey);
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

// 确保任务文件存在：不依赖日记插件。优先复制用户「日记」插件的模板文件内容（若已配置），
// 否则退化为最小 frontmatter，在对应路径创建。
async function ensureTaskFile(dateKey, path) {
  const v = vault();
  if (v.getAbstractFileByPath(path)) return true;
  const tmpl = await dailyTemplateContent();
  await ensureFolder(path.split('/').slice(0, -1).join('/'));
  // 有模板则整份复制（frontmatter + 正文都生效）；无模板则退化为最小 frontmatter
  await v.create(path, tmpl ? tmpl + '\n' : DAILY_HEAD);
  return true;
}

// 加载窗口（天）：'all' 或数字，控制每日笔记的读取范围（以今天为中心的对称窗口，默认 'all'，大库可调小）
function loadWindowDays() {
  const v = plugin.settings && plugin.settings.dailyLoadWindow;
  if (v === 'all' || v == null) return 'all';
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 'all';
}

// 收集全部日记笔记：在用户配置的日记文件夹（含子目录）下，文件名能解析出日期的 .md 笔记，
// 且日期落在以今天为中心的对称窗口内 [今天-win天, 今天+win天]（设置 dailyLoadWindow，默认全部；大库可调小避免全量读取）。
// 文件名匹配宽松：支持 YYYY-MM-DD 及 . _ / 等分隔、前后缀文字、星期（Sat / 周六）、美式 MM-DD-YYYY 等。
// 同一日期可能有多个文件，全部保留（不再去重），读取时各自的任务都会被聚合展示。
function listDailyFiles() {
  const folder = journalFolder();
  const win = loadWindowDays();
  const lower = win === 'all' ? null : todayKey(Date.now() - Number(win) * 86400000);
  const upper = win === 'all' ? null : todayKey(Date.now() + Number(win) * 86400000);
  const out = [];
  for (const f of vault().getMarkdownFiles()) {
    if (folder ? f.path.indexOf(folder + '/') !== 0 : f.path.indexOf('/') >= 0) continue;
    const key = fileDateKey(f.name);
    if (!key) continue;
    if (lower != null && (key < lower || key > upper)) continue;
    out.push({ key, path: f.path });
  }
  return out;
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
    // 该日期下可能有多个日记文件，全部读取并聚合展示
    const paths = dailyFilesForDate(opts.date);
    if (!paths.length) return res(400, { ok: false, reason: 'bad_date' });
    files = paths.map((p) => ({ key: opts.date, path: p }));
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
      // 带上所属文件，确保同日期多文件下 guid 唯一、后续操作能定位到正确文件
      items.push(toRecord(f.key, node, { file: f.path }));
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
  const path = pathOf(g);
  if (!path) return res(400, { ok: false, reason: 'bad_guid' });
  const doc = await readTasks(path, g.dateKey);
  const node = locateNode(doc.roots, { lineNo: g.lineNo });
  if (!node) return res(404, { ok: false, reason: 'not_found' });
  const items = node.children.map((c) => toRecord(g.dateKey, c, { parentGuid, file: g.file }));
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
  // 新约定：日记文件名=开始日；有开始日用开始日，否则回落到结束日（单日），无日期=收件箱
  const dateKey = listKey || ((t.startAt != null && t.startAt !== '') ? todayKey(Number(t.startAt)) : (t.dueAt ? todayKey(Number(t.dueAt)) : INBOX_KEY));
  // 新增任务：清单 / 收件箱走原路径；有日期则只落在核心日记插件配置的那一份（忽略用户的多个日记文件）
  const path = (dateKey === INBOX_KEY || isListKey(dateKey))
    ? taskFilePath(dateKey)
    : canonicalDailyPath(dateKey);
  if (!path) return res(400, { ok: false, reason: 'bad_date' });
  // 先确保文件存在：日记走 Obsidian 原生创建以套用日记模板（如已配置），其余用默认 frontmatter
  await ensureTaskFile(dateKey, path);
  const doc = await readTasks(path, dateKey);
  const node = nodeFromTask(t, dateKey, { addDoneDate: addDoneDateEnabled() });
  if (listKey) {
    // 清单：行内标记日期，文件不变
    if (t.dueAt) node.due = todayKey(Number(t.dueAt));
    if (t.startAt) node.start = todayKey(Number(t.startAt));
  } else {
    // 日记：文件名=开始日；结束日 > 开始日时写行内 📅，🛫 无需（文件即开始日）
    node.start = '';
    node.due = (t.dueAt != null && todayKey(Number(t.dueAt)) > dateKey) ? todayKey(Number(t.dueAt)) : '';
  }
  const { out, lineNo } = appendLines(doc.lines, node, '');
  await writeTasks(path, doc.head, out);
  return res(201, { ok: true, task: toRecord(dateKey, Object.assign({}, node, { lineNo }), { file: path }) });
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
  await ensureTaskFile(listKey, path);
  const doc = await readTasks(path, listKey);
  const node = nodeFromTask(t, listKey, { addDoneDate: addDoneDateEnabled() });
  if (t.dueAt) node.due = todayKey(Number(t.dueAt));
  if (t.startAt) node.start = todayKey(Number(t.startAt));
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
  const path = pathOf(g);
  if (!path) return res(400, { ok: false, reason: 'bad_guid' });
  const doc = await readTasks(path, g.dateKey);
  const parent = locateNode(doc.roots, { lineNo: g.lineNo });
  if (!parent) return res(404, { ok: false, reason: 'not_found' });

  const child = nodeFromTask(t, g.dateKey, { addDoneDate: addDoneDateEnabled() });
  child.indentStr = (parent.indentStr || '') + CHILD_INDENT;
  child.indent = child.indentStr.length;
  const insertAt = Math.max(...collectLineNos(parent)) + 1;
  const lines = doc.lines.slice();
  lines.splice(insertAt, 0, serializeTaskLine(child, child.indentStr));
  await writeTasks(path, doc.head, lines);
  const created = Object.assign({}, child, { lineNo: insertAt });
  return res(201, { ok: true, task: toRecord(g.dateKey, created, { parentGuid, file: path }) });
}

// 修改任务（标题/描述/完成态/日期）。日期跨文件时移动整块。
export async function updateTask(guid, patch) {
  noteSelfWrite();
  const g = parseGuid(guid);
  if (!g) return res(400, { ok: false, reason: 'bad_guid' });
  const p = patch || {};
  const path = pathOf(g);
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
    node.done = node.completed ? completionDoneDate(node.done) : '';
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
  // 日期编辑：清单行内 📅/🛫；日记文件名=开始日，📅=结束日（结束>开始时写入）
  const hasDue = Object.prototype.hasOwnProperty.call(p, 'dueAt');
  const hasStart = Object.prototype.hasOwnProperty.call(p, 'startAt');
  if (hasDue || hasStart) {
    const isList = isListKey(g.dateKey);
    const isDated = !isList && g.dateKey !== INBOX_KEY;
    let cs = isDated ? (node.start || g.dateKey) : (node.start || '');
    let cd = isDated ? (node.due || g.dateKey) : (node.due || '');
    if (!isDated) { if (!cs && cd) cs = cd; if (!cd && cs) cd = cs; }
    if (hasStart) cs = (p.startAt == null || p.startAt === '') ? '' : todayKey(Number(p.startAt));
    if (hasDue) cd = (p.dueAt == null) ? null : todayKey(Number(p.dueAt));
    if (cs && !cd) cd = cs;
    if (cd && !cs) cs = cd;
    const hasEnd = Object.prototype.hasOwnProperty.call(p, 'dueEndAt');
    const endMs = hasEnd
      ? (p.dueEndAt != null ? Number(p.dueEndAt) : null)
      : (node.timeEnd ? dateToMs(cd || cs, node.timeEnd) : null);
    const endTime = (p.dueAllDay || !endMs) ? '' : (Number.isFinite(endMs) ? msToTime(endMs) : '');
    if (isList) {
      node.due = cd || '';
      node.start = cs || '';
      node.time = p.dueAllDay ? '' : (p.dueAt != null ? msToTime(Number(p.dueAt)) : node.time);
      node.timeEnd = endTime;
    } else if (!cd) {
      targetKey = INBOX_KEY;
      node.time = '';
      node.timeEnd = '';
      node.due = '';
      node.start = '';
    } else {
      targetKey = cs || cd;
      node.start = '';
      node.due = (cs && cd && cd > cs) ? cd : '';
      node.time = p.dueAllDay ? '' : (p.startAt != null && p.startAt !== '' ? msToTime(Number(p.startAt)) : (p.dueAt != null ? msToTime(Number(p.dueAt)) : node.time));
      node.timeEnd = endTime;
    }
  }
  const removed = new Set(collectLineNos(node));
  const keep = doc.lines.filter((_, i) => !removed.has(i));

  if (targetKey === g.dateKey) {
    keep.splice(node.lineNo, 0, ...serializeBlock(node, node.indentStr));
    await writeTasks(path, doc.head, keep);
    return res(200, { ok: true, task: toRecord(g.dateKey, node, { file: path }) });
  }

  // 跨文件移动：先写回源文件，再追加到目标文件末尾
  await writeTasks(path, doc.head, keep);
  // 目标为日期时，只落到核心日记插件配置的那一份（忽略用户的多个日记文件）
  const dstPath = (targetKey === INBOX_KEY || isListKey(targetKey))
    ? taskFilePath(targetKey)
    : canonicalDailyPath(targetKey);
  if (!dstPath) return res(400, { ok: false, reason: 'bad_date' });
  await ensureTaskFile(targetKey, dstPath);
  const dst = await readTasks(dstPath, targetKey);
  const { out, lineNo } = appendLines(dst.lines, node, '');
  await writeTasks(dstPath, dst.head, out);
  return res(200, { ok: true, task: toRecord(targetKey, Object.assign({}, node, { lineNo }), { file: dstPath }) });
}

// 删除任务（连同其描述行与子任务）
export async function deleteTask(guid) {
  noteSelfWrite();
  const g = parseGuid(guid);
  if (!g) return res(400, { ok: false, reason: 'bad_guid' });
  const path = pathOf(g);
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
  const path = pathOf(g);
  if (!path) return res(400, { ok: false, reason: 'bad_guid' });
  const doc = await readTasks(path, g.dateKey);
  const node = locateNode(doc.roots, { lineNo: g.lineNo });
  if (!node) return res(404, { ok: false, reason: 'not_found' });
  node.completed = !!done;
  node.done = node.completed ? completionDoneDate(node.done) : '';
  if (done) { node.cancelMark = false; node.cancelled = ''; } // 勾选完成视为恢复，清除取消态
  const lines = doc.lines.slice();
  lines.splice(node.lineNo, 1, serializeTaskLine(node, node.indentStr));
  await writeTasks(path, doc.head, lines);
  return res(200, { ok: true, task: toRecord(g.dateKey, node, { file: path }) });
}

// 设定任务状态：status ∈ 'todo' | 'done' | 'cancelled'（右键菜单用）
export async function setChecklistStatus(guid, status) {
  noteSelfWrite();
  const g = parseGuid(guid);
  if (!g) return res(400, { ok: false, reason: 'bad_guid' });
  const path = pathOf(g);
  if (!path) return res(400, { ok: false, reason: 'bad_guid' });
  const doc = await readTasks(path, g.dateKey);
  const node = locateNode(doc.roots, { lineNo: g.lineNo });
  if (!node) return res(404, { ok: false, reason: 'not_found' });
  if (status === 'done') {
    node.completed = true;
    node.done = completionDoneDate(node.done);
    node.cancelMark = false;
    node.cancelled = '';
  } else if (status === 'cancelled') {
    node.completed = false;
    node.done = '';
    node.cancelMark = true;
    node.cancelled = node.cancelled || todayKey();
  } else { // todo（未完成）：清除已完成与已取消态
    node.completed = false;
    node.done = '';
    node.cancelMark = false;
    node.cancelled = '';
  }
  const lines = doc.lines.slice();
  lines.splice(node.lineNo, 1, serializeTaskLine(node, node.indentStr));
  await writeTasks(path, doc.head, lines);
  return res(200, { ok: true, task: toRecord(g.dateKey, node, { file: path }) });
}
