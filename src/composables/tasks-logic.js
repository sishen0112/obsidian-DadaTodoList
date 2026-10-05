// Obsidian 任务（Markdown 复选框）纯逻辑：解析、序列化与记录映射。
// Node + 浏览器通用（不引入任何 Node 内置模块），便于前端打包与单元测试。
//
// 支持的语法（兼容 Obsidian Tasks 插件常用写法）：
//   - [ ] 11:00 洗狗窝            ← 前置 HH:MM 视为时间，其余为标题
//   - [x] 备课 FIRE +1CHA ✅ 2026-06-08
//   - [ ] 送车保养 ➕ 2026-05-19 📅 2026-05-24 🔺
//   	- [x] 子任务（Tab/空格缩进即子任务）
// 其余缩进且非任务行 → 视为该任务的描述行。

import { Lunar, HolidayUtil } from 'lunar-javascript';
import { t, currentLang } from '../i18n/index.js';

// 「无日期」任务所在收件箱文件的键名（与具体路径解耦）
export const INBOX_KEY = 'inbox';

// - [ ] / - [x] / - [-]（取消），允许任意缩进（空格或 Tab）
const TASK_LINE_RE = /^([ \t]*)- \[([ xX-])\]\s?(.*)$/;

// Obsidian Tasks 日期类标记：字段名 → 符号
const DATE_FIELDS = [
  ['created', '➕'],
  ['start', '🛫'],
  ['scheduled', '⏳'],
  ['due', '📅'],
  ['done', '✅'],
  ['cancelled', '❌']
];
const SYM_TO_FIELD = {};
for (const pair of DATE_FIELDS) SYM_TO_FIELD[pair[1]] = pair[0];
// 用「多选一」而非字符组，避免 emoji（星平面字符）在字符组里的代理对问题
const DATE_TOKEN_RE = new RegExp('(' + DATE_FIELDS.map((p) => p[1]).join('|') + ')\\s*(\\d{4}-\\d{2}-\\d{2})', 'g');
const PRIORITY_RE = /⏫|🔺|🔼|🔽|⏬/g;
const RECURRENCE_CHAR = '🔁';
// 新增子任务/描述行时使用的缩进单位（与用户既有笔记保持一致）
export const CHILD_INDENT = '\t';

const pad2 = (n) => (n < 10 ? '0' + n : '' + n);

// 本地日期 → YYYY-MM-DD
export function todayKey(d) {
  const dt = d == null ? new Date() : new Date(d);
  return dt.getFullYear() + '-' + pad2(dt.getMonth() + 1) + '-' + pad2(dt.getDate());
}

// 日期(+可选时间) → 本地毫秒时间戳；日期非法返回 null
export function dateToMs(dateKey, time) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey || '');
  if (!m) return null;
  let hh = 0;
  let mm = 0;
  const t = /^(\d{1,2}):(\d{2})$/.exec(time || '');
  if (t) { hh = Number(t[1]); mm = Number(t[2]); }
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), hh, mm, 0, 0).getTime();
}

// 毫秒时间戳 → HH:MM
export function msToTime(ms) {
  const d = new Date(Number(ms));
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

// 跨日「全天」任务在给定日期列（通常为一周 7 天）上的泳道排布：
//   - dayKeys 按顺序给出该周的日期键；list 为候选任务（调用方自行过滤，如仅全天任务）
//   - 每个任务按自身 startAt(🛫) → dueAt(📅) 与本周边界的交集，映射到列区间 [startIdx, endIdx]
//   - 同一泳道内列区间不重叠（贪心：起始列靠前、跨度长者优先）
//   - contStart：本周之前已开始（左侧为「续接」，左端不收圆角）
//   - contEnd  ：本周之后仍未结束（右侧为「续接」，右端不收圆角）
// 返回 { bars, lanes }；bars 项含 { t, startIdx, endIdx, lane, contStart, contEnd }。
export function layoutSpanBars(dayKeys, list) {
  const n = dayKeys ? dayKeys.length : 0;
  if (!n) return { bars: [], lanes: 0 };
  const idx = new Map();
  dayKeys.forEach((k, i) => idx.set(k, i));
  const first = dayKeys[0];
  const last = dayKeys[n - 1];
  const items = [];
  for (const t of (list || [])) {
    if (!t || !t.dueAt) continue;
    const startMs = (t.startAt && t.startAt !== t.dueAt) ? Number(t.startAt) : Number(t.dueAt);
    const sKey = todayKey(startMs);
    const eKey = todayKey(Number(t.dueAt));
    if (eKey < first || sKey > last) continue; // 与本周无交集
    let si = idx.has(sKey) ? idx.get(sKey) : 0;            // 早于本周 → 从第 0 列起
    const ei = idx.has(eKey) ? idx.get(eKey) : (n - 1);    // 晚于本周 → 到最后一列止
    if (si > ei) si = ei; // 逆序（开始日 > 结束日）：退化为结束日所在单列全天块，而非整条不显示
    items.push({ t, startIdx: si, endIdx: ei, contStart: sKey < first, contEnd: eKey > last, len: ei - si });
  }
  // 贪心分泳道：放入第一条「上一条已在其左侧结束」的泳道
  items.sort((a, b) => a.startIdx - b.startIdx || b.len - a.len);
  const laneEnd = [];
  for (const it of items) {
    let li = 0;
    while (li < laneEnd.length && laneEnd[li] >= it.startIdx) li++;
    if (li === laneEnd.length) laneEnd.push(-1);
    laneEnd[li] = it.endIdx;
    it.lane = li;
  }
  return { bars: items, lanes: laneEnd.length };
}

// 是否跨天（按日期判定，忽略时刻）：开始日早于到期日且不在同一天。
// 用于把「同时带时刻又跨多天」的任务归入横跨条；开始日≥结束日（相等或逆序）不算跨天。
export function spansDays(t) {
  if (!t || !t.dueAt) return false;
  if (!t.startAt || t.startAt === t.dueAt) return false;
  const sk = todayKey(Number(t.startAt));
  const ek = todayKey(Number(t.dueAt));
  return sk < ek; // 仅当开始日早于结束日才视为跨天（逆序退化为单日）
}

// 记录唯一标识：`日期#行号#文件相对路径`（日期为 YYYY-MM-DD 或 'inbox' 等）。
// 同一日期可能存在多个日记文件，行号在不同文件内会重复，故把所属文件编入 guid 以唯一标识。
// Obsidian 笔记名不允许含 '#'，故以 '#' 作为分隔安全无歧义。仍兼容旧格式 `日期#行号`（无文件段）。
function makeGuid(dateKey, lineNo, file) {
  const f = file || '';
  return f ? `${dateKey}#${lineNo}#${f}` : `${dateKey}#${lineNo}`;
}

export function parseGuid(guid) {
  const s = String(guid == null ? '' : guid);
  const i = s.indexOf('#'); // 第一个 '#' 分隔 dateKey 与余下部分
  if (i <= 0) return null;
  const dateKey = s.slice(0, i);
  const rest = s.slice(i + 1);
  const j = rest.indexOf('#'); // 第二个 '#' 分隔 lineNo 与文件（文件不含 '#'）
  if (j < 0) {
    const lineNo = Number(rest);
    if (!dateKey || !Number.isFinite(lineNo) || lineNo < 0) return null;
    return { dateKey, lineNo, file: '' };
  }
  const lineNo = Number(rest.slice(0, j));
  const file = rest.slice(j + 1);
  if (!dateKey || !Number.isFinite(lineNo) || lineNo < 0) return null;
  return { dateKey, lineNo, file };
}

// 任务行正文（去掉 "- [ ] " 之后的部分）→ 结构化字段，仅模块内部使用
function parseTaskText(raw) {
  let text = String(raw == null ? '' : raw);
  const meta = {
    created: '', start: '', scheduled: '', due: '', done: '', cancelled: '',
    priority: '', recurrence: ''
  };
  text = text.replace(DATE_TOKEN_RE, (m0, sym, d) => {
    const field = SYM_TO_FIELD[sym];
    if (field && !meta[field]) meta[field] = d;
    return ' ';
  });
  text = text.replace(PRIORITY_RE, (m0) => {
    if (!meta.priority) meta.priority = m0;
    return ' ';
  });
  const ri = text.indexOf(RECURRENCE_CHAR);
  if (ri >= 0) {
    meta.recurrence = text.slice(ri + RECURRENCE_CHAR.length).trim();
    text = text.slice(0, ri);
  }

  // 前置时间：单时间 HH:MM / H:MM，或时间段 HH:MM-HH:MM（如 09:00-10:00）
  let time = '';
  let timeEnd = '';
  const t = /^\s*(\d{1,2}):(\d{2})(?:\s*-\s*(\d{1,2}):(\d{2}))?(?=\s|$)/.exec(text);
  if (t) {
    time = pad2(Math.min(23, Number(t[1]))) + ':' + pad2(Math.min(59, Number(t[2])));
    if (t[3] != null) {
      timeEnd = pad2(Math.min(23, Number(t[3]))) + ':' + pad2(Math.min(59, Number(t[4])));
    }
    text = text.slice(t[0].length);
  }

  return Object.assign(meta, { summary: text.replace(/\s+/g, ' ').trim(), time, timeEnd });
}

function makeNode(lineNo, indentStr, mark, text) {
  return Object.assign({
    lineNo,
    indent: indentStr.length,
    indentStr,
    completed: String(mark).toLowerCase() === 'x',
    cancelMark: String(mark) === '-', // - [-] 标记（cancelled 为 ❌ 日期串，两者独立）
    cancelled: '',
    descLines: [],
    descTexts: [],
    children: []
  }, parseTaskText(text));
}

// 正文 → { lines, roots }（roots 为顶层任务树，children 为子任务）
export function parseTasks(body) {
  const lines = String(body == null ? '' : body).split(/\r?\n/);
  const roots = [];
  const stack = [];
  let lastTask = null;

  lines.forEach((line, i) => {
    const m = TASK_LINE_RE.exec(line);
    if (m) {
      const node = makeNode(i, m[1], m[2], m[3]);
      while (stack.length && stack[stack.length - 1].indent >= node.indent) stack.pop();
      if (stack.length) stack[stack.length - 1].children.push(node);
      else roots.push(node);
      stack.push(node);
      lastTask = node;
      return;
    }
    if (!line.trim()) return; // 空行既不进描述，也不打断栈
    const indent = line.length - line.trimStart().length;
    if (lastTask && indent > lastTask.indent) {
      lastTask.descLines.push(i);
      // 描述行在源文件里是「缩进的 - 列表」，剥掉我们写回时加的 - 前缀（兼容旧笔记的无前缀纯缩进描述）
      lastTask.descTexts.push(line.trim().replace(/^-\s+/, ''));
      return;
    }
    lastTask = null;
  });

  return { lines, roots };
}

// 深度优先展平（父在子前）
export function flattenTasks(roots) {
  const out = [];
  const walk = (n) => { out.push(n); for (const c of n.children) walk(c); };
  for (const r of roots || []) walk(r);
  return out;
}

// 节点及其后代、描述行在正文中的行号（升序）
export function collectLineNos(node) {
  const out = [node.lineNo, ...(node.descLines || [])];
  for (const c of node.children || []) out.push(...collectLineNos(c));
  return out.sort((a, b) => a - b);
}

// ---------- 标题内的行内 Markdown（标签 / 链接） ----------
// 仅做两件事：`[文本](网址)` → 链接、`#标签` → 标签。
// 渲染前先转义，避免笔记里的 HTML 被当成标签注入。

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 只允许安全的链接协议，其余按纯文本输出，防止 javascript: 之类注入
const SAFE_URL_RE = /^(?:https?:|mailto:|tel:|obsidian:|\/|\.{1,2}\/)/i;
// 无协议的域名形态地址（如 bilibili.com/video/x）→ 渲染时自动补 https://
const DOMAIN_LIKE_RE = /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}([/?#].*)?$/i;

function safeHref(url) {
  if (SAFE_URL_RE.test(url)) return url;
  return DOMAIN_LIKE_RE.test(url) ? 'https://' + url : null;
}

// ---------- 到点提醒标记 ----------
// summary 中的 🔕 表示该任务到点不弹浏览器通知（缺省即提醒）。
// 标记随任务行文本持久化在 Obsidian 笔记里，展示位（列表/详情/编辑器标题）统一过滤。
const MUTE_MARK = '🔕';
function stripMute(text) {
  return String(text == null ? '' : text).split(MUTE_MARK).join(' ').replace(/\s+/g, ' ').trim();
}

// 行内 Markdown 正则：链接优先，标签需位于行首或空白/括号之后（与 Obsidian 一致）
function inlineRe() {
  return /\[([^\]]*)\]\(([^)\s]+)\)|(^|[\s(（])#([\p{L}\p{N}_\-/]+)/gu;
}

// 提取标题中的标签与链接（结构化字段，便于筛选/展示），仅模块内部使用
function parseInline(text) {
  const src = String(text == null ? '' : text);
  const tags = [];
  const links = [];
  const re = inlineRe();
  let m;
  while ((m = re.exec(src)) !== null) {
    if (m[1] !== undefined) links.push({ text: m[1] || m[2], url: m[2] });
    else if (m[4]) tags.push(m[4]);
    if (m[0] === '') re.lastIndex++; // 防御：避免零宽匹配死循环
  }
  return { tags, links };
}

// 标题 → 可安全 v-html 的 HTML（链接可点击、标签渲染为样式化小标签）
// opts.tags === false 时只渲染链接，标签留给调用方另行排版（如列表视图把标签放到标题下方）
export function renderInlineHtml(text, opts = {}) {
  const withTags = opts.tags !== false;
  const src = stripMute(text); // 🔕 为提醒关闭标记，不在任何展示位出现
  const re = inlineRe();
  let out = '';
  let last = 0;
  let m;
  while ((m = re.exec(src)) !== null) {
    out += escapeHtml(src.slice(last, m.index));
    if (m[1] !== undefined) {
      const href = safeHref(m[2]);
      const label = m[1] || m[2];
      out += href
        ? '<a class="tk-inline-link" href="' + escapeHtml(href) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(label) + '</a>'
        : escapeHtml(m[0]);
    } else {
      out += escapeHtml(m[3]); // 保留前置空白，避免与前后文字粘连
      if (withTags) out += '<span class="tk-inline-tag">#' + escapeHtml(m[4]) + '</span>';
    }
    last = m.index + m[0].length;
    if (m[0] === '') re.lastIndex++;
  }
  out += escapeHtml(src.slice(last));
  return out;
}

// 把一行任务标题拆成「纯文字标题 + 链接列表 + 标签列表」。
// 用于编辑器：标题框只维护纯文字，链接/标签各自单独维护，保存时再由 composeSummary 还原。
export function splitSummary(summary) {
  const raw = String(summary == null ? '' : summary);
  const muted = raw.indexOf(MUTE_MARK) >= 0; // 🔕 = 到点提醒已关闭
  const src = stripMute(raw);
  const { tags, links } = parseInline(src);
  let text = src
    .replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, ' ')
    .replace(/(^|[\s(（])#[\p{L}\p{N}_\-/]+/gu, ' ');
  text = text.replace(/\s+/g, ' ').trim();
  // 仅在确实移除了链接/标签时，才清理残留的尾部分隔符（如「标题 |」）
  if (links.length || tags.length) text = text.replace(/[\s|]+$/, '').trim();
  return { title: text, links, tags, muted };
}

// 由「标题 + 链接 + 标签」还原完整 Markdown 文本（splitSummary 的逆运算）
// 形如：标题 | [链接](地址) #标签（多个链接用 | 分隔，多个标签用空格分隔）
export function composeSummary(title, links, tags, opts = {}) {
  const parts = [];
  const t = stripMute(title).trim(); // 标题里不应残留 🔕，统一按 opts.mute 决定
  if (t) parts.push(t);
  const linkPart = (links || [])
    .filter((l) => l && l.url)
    .map((l) => '[' + (l.text || l.url) + '](' + l.url + ')');
  if (linkPart.length) parts.push(linkPart.join(' | '));
  const tagPart = (tags || [])
    .filter(Boolean)
    .map((x) => '#' + String(x).replace(/^#+/, ''));
  let text = parts.join(' | ');
  if (tagPart.length) text = (text ? text + ' ' : '') + tagPart.join(' ');
  if (opts.mute) text = (text ? text + ' ' : '') + MUTE_MARK;
  return text;
}

// 清洗用户输入的标签名（去掉 # 前缀与非法字符）
export function sanitizeTag(name) {
  return String(name == null ? '' : name).trim().replace(/^#+/, '').replace(/[\s]+/g, '-');
}

// 标题 → 纯文本（用于 tooltip 等场景：链接只留文字）
export function plainInline(text) {
  return stripMute(String(text == null ? '' : text))
    .replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, (m0, label, url) => label || url);
}

// 节点 → 前端任务记录
export function toRecord(dateKey, node, opts = {}) {
  const completed = !!node.completed;
  // 日期约定：
  //   - 清单 / 收件箱无「文件日期」，开始日(🛫)、结束日(📅)均来自行内标记；
  //   - 每日笔记文件名表示「开始日」，📅 表示结束日（结束 > 开始时写入），🛫 可覆盖开始日。
  const isDatedFile = !(dateKey === INBOX_KEY || String(dateKey || '').indexOf('cl:') === 0);
  const fileMs = dateToMs(dateKey, node.time || '00:00');
  let startAt = null;
  let dueAt = null;
  if (!isDatedFile) {
    // 清单 / 收件箱：起止日均来自行内标记
    startAt = node.start ? dateToMs(node.start, node.time || '00:00') : null;
    dueAt = node.due ? dateToMs(node.due, node.time || '00:00') : (startAt != null ? startAt : null);
  } else {
    // 每日笔记：文件名=开始日（含时间）；📅=结束日（全天）；🛫 可覆盖开始日
    startAt = node.start ? dateToMs(node.start, '00:00') : fileMs;
    dueAt = node.due ? dateToMs(node.due, '00:00') : fileMs;
  }
  const inline = parseInline(node.summary);
  // 所属文件（相对库根路径）：用于唯一标识同一日期下多个日记文件中的任务；
  // 空串表示单一文件键（收件箱 / 清单），后续操作回落到 taskFilePath 定位
  const file = opts.file || '';
  return {
    guid: makeGuid(dateKey, node.lineNo, file),
    summary: node.summary,
    remind: node.summary.indexOf(MUTE_MARK) < 0, // 🔕 标记 = 到点提醒关闭，默认提醒
    tags: inline.tags,
    links: inline.links,
    description: (node.descTexts || []).join('\n'),
    completed,
    cancelled: !!(node.cancelMark || node.cancelled),
    cancelledAt: node.cancelled ? dateToMs(node.cancelled) : null,
    completedAt: completed && node.done ? dateToMs(node.done) : null,
    dueAt,
    startAt,
    dueAllDay: !node.time,
    dueEndAt: (dueAt != null && node.timeEnd) ? dateToMs(todayKey(dueAt), node.timeEnd) : null,
    subtaskCount: (node.children || []).length,
    // 层级深度（0 = 顶层；每多一层缩进 +1），供清单视图按层级缩进显示
    indent: node.indentStr ? (node.indentStr.match(/\t/g) || []).length : 0,
    // 内部字段（前端可透传回服务端用于定位）
    date: dateKey,
    lineNo: node.lineNo,
    file,
    time: node.time,
    timeEnd: node.timeEnd || '',
    parentGuid: opts.parentGuid || ''
  };
}

// 节点 → Markdown 行
export function serializeTaskLine(node, indentStr) {
  const ind = indentStr != null ? indentStr : (node.indentStr || '');
  const mark = (node.cancelMark || node.cancelled) ? '-' : (node.completed ? 'x' : ' ');
  return (ind + '- [' + mark + '] ' + serializeTaskText(node)).replace(/\s+$/, '');
}

function serializeTaskText(node) {
  const parts = [];
  const summary = String(node.summary || '').trim();
  if (summary) parts.push(summary);
  if (node.priority) parts.push(node.priority);
  if (node.due) parts.push('📅 ' + node.due);
  if (node.start) parts.push('🛫 ' + node.start);
  if (node.scheduled) parts.push('⏳ ' + node.scheduled);
  if (node.created) parts.push('➕ ' + node.created);
  if (node.completed && node.done) parts.push('✅ ' + node.done);
  if (node.cancelled) parts.push('❌ ' + node.cancelled);
  if (node.recurrence) parts.push(RECURRENCE_CHAR + ' ' + node.recurrence);
  const body = parts.join(' ');
  const timePrefix = node.time ? (node.time + (node.timeEnd ? '-' + node.timeEnd : '')) : '';
  return (timePrefix ? timePrefix + ' ' : '') + body;
}

// 节点（含描述/子任务）→ 行数组
export function serializeBlock(node, indentStr) {
  const ind = indentStr != null ? indentStr : (node.indentStr || '');
  const out = [serializeTaskLine(node, ind)];
  const childInd = ind + CHILD_INDENT;
  // 描述以「缩进的 - 列表」写入源文件（与子任务同级缩进），便于在笔记里直接阅读 / 折叠
  for (const t of node.descTexts || []) if (t) out.push(childInd + '- ' + t);
  for (const c of node.children || []) out.push(...serializeBlock(c, childInd));
  return out;
}

// 由前端 payload 构造节点（用于新建）
export function nodeFromTask(task, dateKey) {
  const t = task || {};
  const allDay = !!t.dueAllDay;
  const time = (t.dueAt && !allDay) ? msToTime(t.dueAt) : '';
  const timeEnd = (t.dueEndAt && !allDay) ? msToTime(Number(t.dueEndAt)) : '';
  const descTexts = String(t.description || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  return {
    lineNo: -1,
    indent: 0,
    indentStr: '',
    completed: !!t.completed,
    descLines: [],
    descTexts,
    children: [],
    summary: String(t.summary || '').trim(),
    time,
    timeEnd,
    created: '', start: '', scheduled: '', due: '', cancelled: '',
    priority: '',
    recurrence: '',
    done: t.completed ? todayKey() : ''
  };
}

// 在 nodes 中按 行号（优先）+ 内容 定位任务。
// 行号命中但内容不符（例如笔记被外部改动）时，若提供了内容条件则以「唯一匹配」兜底；
// 未提供内容条件时直接判失败，避免误伤同文件中唯一的一条任务。
export function locateNode(nodes, opts = {}) {
  const { lineNo, summary, completed } = opts;
  const flat = flattenTasks(nodes);
  const hasLine = lineNo != null && Number.isFinite(lineNo);
  const hasContent = summary != null || completed != null;
  const matchContent = (n) => (summary == null || n.summary === summary)
    && (completed == null || !!n.completed === !!completed);
  if (hasLine) {
    const byLine = flat.find((n) => n.lineNo === lineNo);
    if (byLine && (!hasContent || matchContent(byLine))) return byLine;
  }
  if (!hasContent) return null;
  const cands = flat.filter(matchContent);
  return cands.length === 1 ? cands[0] : null;
}

// ---------- 展示格式化（任务视图组件共用，均为纯函数） ----------
// 列表中的日期：非本年时在日期前补上年份，避免跨年混淆
export function dateText(t) {
  if (!t || !t.dueAt) return '—';
  const end = new Date(t.dueAt);
  const endMd = (end.getMonth() + 1) + '/' + end.getDate();
  const endYear = end.getFullYear();
  const curYear = new Date().getFullYear();
  // 跨日期任务：显示完整区间 开始日-结束日（如 10/2-10/7），跨年补年份
  if (t.startAt && t.startAt !== t.dueAt) {
    const sk = todayKey(Number(t.startAt));
    const ek = todayKey(Number(t.dueAt));
    if (sk < ek) {
      const s = new Date(t.startAt);
      const startMd = (s.getMonth() + 1) + '/' + s.getDate();
      const startYear = s.getFullYear();
      const sStr = startYear === curYear ? startMd : startYear + '/' + startMd;
      const eStr = endYear === curYear ? endMd : endYear + '/' + endMd;
      return sStr + '-' + eStr;
    }
  }
  return endYear === curYear ? endMd : endYear + '/' + endMd;
}

// 跨日期任务才返回区间文本（如 10/2-10/7），非跨日返回空串。
// 供各视图「右侧小字显示起止区间」统一调用，避免每处重复判断 spansDays + 格式化。
export function spanDateText(t) {
  return spansDays(t) ? dateText(t) : '';
}

// 时间列：无日期为空；全天显示「全天」；否则 HH:MM（有合法时间段则 HH:MM-HH:MM）
export function timeText(task) {
  if (!task || !task.dueAt) return '';
  if (task.dueAllDay) return t('app.allDay');
  const s = pad2(new Date(task.dueAt).getHours()) + ':' + pad2(new Date(task.dueAt).getMinutes());
  // 结束时间早于开始时间（含逆序时间段）→ 按普通单时间显示，不画范围
  if (task.dueEndAt && Number(task.dueEndAt) > Number(task.dueAt)) {
    const e = new Date(task.dueEndAt);
    return s + '-' + pad2(e.getHours()) + ':' + pad2(e.getMinutes());
  }
  return s;
}

// 任务状态图标（Line Awesome 圆形勾选 / 取消减号）
export function statusIcon(t) {
  if (t && t.cancelled) return 'la la-minus-circle';
  return t && t.completed ? 'la la-check-circle-o' : 'la la-circle-o';
}

// 纯标题（剔除链接与标签的 Markdown），用于详情面板 / tooltip
export function plainTitle(t) {
  return splitSummary(t && t.summary).title;
}

// 行内富文本（仅链接可点击；标签由调用方另行排版）
export function richSummaryNoTags(t) {
  return renderInlineHtml(t && t.summary, { tags: false });
}

// 完成日期 YYYY-MM-DD；无完成时间返回空串
export function doneDay(t) {
  const ms = Number(t && t.completedAt);
  return Number.isFinite(ms) && ms > 0 ? todayKey(ms) : '';
}

// ---------- 周/月/日程视图共用的装饰（配色 / 农历 / 节假日） ----------

// ---------- 任务块配色（多套方案，可在设置中切换） ----------
// 每套均为「浅底 + 同色深字/强调色」，按标题哈希取色（浅底深字）。
// default = 插件默认配色；morandi = 莫兰迪低饱和灰调；jelly = 卡通果冻高饱和糖果色。

// 插件默认配色（default）
export const TIMELINE_COLORS = [
  { bg: 'rgba(244, 67, 54, .18)', fg: '#c62828' },  // 红
  { bg: 'rgba(216, 27, 96, .18)', fg: '#ad1457' },  // 玫红（替代橙）
  { bg: 'rgba(148, 166, 120, .28)', fg: '#5c6b44' }, // 橄榄绿（替代扎眼的青柠绿）
  { bg: 'rgba(76, 175, 80, .18)', fg: '#2e7d32' },  // 绿
  { bg: 'rgba(0, 188, 212, .18)', fg: '#00838f' },  // 青
  { bg: 'rgba(33, 150, 243, .18)', fg: '#1565c0' },  // 蓝
  { bg: 'rgba(103, 58, 183, .18)', fg: '#5e35b1' },  // 靛紫
  { bg: 'rgba(156, 39, 176, .18)', fg: '#7b1fa2' }   // 紫
];

// 莫兰迪配色：低饱和、带灰度的温柔色系
export const MORANDI_COLORS = [
  { bg: 'rgba(190, 158, 158, .30)', fg: '#8a6a6a' }, // 灰粉
  { bg: 'rgba(191, 150, 165, .30)', fg: '#8a6072' }, // 灰玫
  { bg: 'rgba(158, 173, 142, .30)', fg: '#5f6b4f' }, // 鼠尾草绿
  { bg: 'rgba(142, 173, 173, .30)', fg: '#4f6b6b' }, // 灰青
  { bg: 'rgba(150, 166, 186, .30)', fg: '#56657a' }, // 灰蓝
  { bg: 'rgba(165, 156, 186, .30)', fg: '#605678' }, // 灰紫
  { bg: 'rgba(193, 180, 150, .30)', fg: '#766a4f' }, // 燕麦
  { bg: 'rgba(186, 163, 150, .30)', fg: '#7a6453' }  // 灰陶
];

// 卡通果冻配色：高饱和、半透明的糖果色，明亮有果冻感
export const JELLY_COLORS = [
  { bg: 'rgba(255, 143, 171, .38)', fg: '#e23a6b' }, // 草莓粉
  { bg: 'rgba(110, 231, 183, .38)', fg: '#14b87a' }, // 薄荷绿
  { bg: 'rgba(125, 211, 252, .38)', fg: '#1c9fe0' }, // 天空蓝
  { bg: 'rgba(253, 224, 71, .40)', fg: '#d4a017' },  // 柠檬黄
  { bg: 'rgba(196, 181, 253, .38)', fg: '#7c5cf0' }, // 葡萄紫
  { bg: 'rgba(253, 186, 116, .38)', fg: '#e8821e' }, // 蜜桃橙
  { bg: 'rgba(248, 113, 113, .38)', fg: '#e23a3a' }, // 樱桃红
  { bg: 'rgba(94, 234, 212, .38)', fg: '#10b3a3' }   // 湖绿
];

// 春樱：生机勃勃的花开——樱粉、桃红、玫瑰、海棠、珊瑚橘，点缀嫩芽绿
export const SPRING_COLORS = [
  { bg: 'rgba(255, 192, 203, .30)', fg: '#d4698a' }, // 樱粉
  { bg: 'rgba(255, 161, 178, .32)', fg: '#e8506f' }, // 桃红
  { bg: 'rgba(244, 114, 140, .32)', fg: '#d6336c' }, // 玫瑰
  { bg: 'rgba(255, 178, 150, .32)', fg: '#e0633a' }, // 珊瑚橘（花蕊暖意）
  { bg: 'rgba(236, 130, 150, .30)', fg: '#c0395a' }, // 海棠红
  { bg: 'rgba(214, 170, 200, .30)', fg: '#9b4d7a' }, // 藕荷
  { bg: 'rgba(167, 214, 146, .30)', fg: '#4e8a3a' }, // 嫩芽绿（生机）
  { bg: 'rgba(190, 220, 160, .30)', fg: '#5a8f3c' }  // 草绿
];

// 夏木：绿树成荫——嫩叶绿、草绿、荷绿、深树绿、竹绿，配荷塘青碧与海蓝天
export const SUMMER_COLORS = [
  { bg: 'rgba(150, 210, 150, .32)', fg: '#3a9a4a' }, // 嫩叶绿
  { bg: 'rgba(120, 200, 130, .34)', fg: '#1f8f4e' }, // 草绿
  { bg: 'rgba(80, 180, 110, .34)', fg: '#167a3e' },  // 荷绿
  { bg: 'rgba(60, 160, 90, .34)', fg: '#126b34' },   // 深树绿
  { bg: 'rgba(160, 220, 120, .32)', fg: '#4e9a2e' }, // 竹绿
  { bg: 'rgba(40, 180, 170, .32)', fg: '#0a7d72' },  // 湖青（荷塘）
  { bg: 'rgba(90, 200, 200, .32)', fg: '#0f8f8a' },  // 青碧（水光）
  { bg: 'rgba(56, 182, 255, .30)', fg: '#0a6fc0' }   // 海蓝（天）
];

// 秋枫：丰收与枫红——丰收金、麦黄、琥珀、枫橘、枫红、深枫红，少量栗与橄榄
export const AUTUMN_COLORS = [
  { bg: 'rgba(224, 196, 96, .30)', fg: '#9c7c14' },  // 丰收金
  { bg: 'rgba(240, 210, 120, .30)', fg: '#b08a1a' }, // 麦黄
  { bg: 'rgba(210, 150, 70, .30)', fg: '#a86a1e' },  // 琥珀
  { bg: 'rgba(230, 140, 60, .30)', fg: '#c0561a' },  // 枫橘
  { bg: 'rgba(214, 96, 77, .28)', fg: '#a83a26' },   // 枫红
  { bg: 'rgba(200, 70, 60, .28)', fg: '#9c2e22' },   // 深枫红
  { bg: 'rgba(180, 120, 60, .28)', fg: '#7a4f1e' },  // 栗（少量）
  { bg: 'rgba(170, 170, 100, .30)', fg: '#6b6b2f' }  // 橄榄（少量）
];

// 冬雪：落雪清寒——霜白、雾白、雪蓝、淡冰蓝、冰蓝、银灰、青霜，少量松雪青
export const WINTER_COLORS = [
  { bg: 'rgba(225, 235, 245, .30)', fg: '#5a7390' }, // 霜白
  { bg: 'rgba(215, 225, 235, .30)', fg: '#6a8299' }, // 雾白
  { bg: 'rgba(200, 220, 240, .28)', fg: '#4a6a8f' }, // 雪蓝
  { bg: 'rgba(170, 200, 220, .28)', fg: '#3f6488' }, // 淡冰蓝
  { bg: 'rgba(160, 195, 230, .28)', fg: '#3d6fa6' }, // 冰蓝
  { bg: 'rgba(190, 205, 220, .28)', fg: '#586a78' }, // 银灰
  { bg: 'rgba(205, 215, 225, .28)', fg: '#4f6275' }, // 青霜
  { bg: 'rgba(150, 185, 205, .28)', fg: '#346066' }  // 松雪青（少量）
];

// 配色方案注册表（设置项 colorScheme 的取值）
export const COLOR_SCHEMES = {
  default: TIMELINE_COLORS,
  morandi: MORANDI_COLORS,
  jelly: JELLY_COLORS,
  spring: SPRING_COLORS,
  summer: SUMMER_COLORS,
  autumn: AUTUMN_COLORS,
  winter: WINTER_COLORS,
};

// 当前生效的配色方案：由 main.js 在加载设置、以及设置变更时调用 setColorScheme 更新。
// 视图组件在设置变更后通过 reloadOpenViews() 重载，从而用新方案重算颜色。
let activeColorScheme = 'default';
export function setColorScheme(name) {
  activeColorScheme = COLOR_SCHEMES[name] ? name : 'default';
}

// 每周起始日：0 = 周日 … 6 = 周六。由 main.js 在加载设置、以及设置变更时调用 setWeekStart 更新。
// 周视图 / 月视图 / 日历格据此重排首列与周范围；视图在设置变更后通过 reloadOpenViews() 重载。
let weekStartDay = 0;
export function setWeekStart(n) {
  const v = Number(n);
  weekStartDay = Number.isFinite(v) && v >= 0 && v <= 6 ? v : 0;
}
export function getWeekStart() {
  return weekStartDay;
}

// 时间轴任务块配色：按标题哈希取色（浅底深字）
export function colorOf(t, scheme) {
  const arr = COLOR_SCHEMES[scheme] || COLOR_SCHEMES[activeColorScheme];
  const s = String((t && t.summary) || '');
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % arr.length;
  return arr[h];
}

// 全天 / 凌晨列表项的背景与文字色（与时间轴块同一套配色）
export function itemColor(t, scheme) {
  const c = colorOf(t, scheme);
  return { background: c.bg, color: 'var(--ink)' };
}

// 农历日文案：中文用库自带词表（初一、十五…）；
// 库的农历日词表（LunarUtil.DAY）不随 I18n 切换，英文下自行按数字格式化。
// 若当天为农历初一，则在日名前补出农历月名（如「九月 初一」/ 闰月「闰九月 初一」），便于辨认月份起点。
export function lunarDayText(date) {
  if (!date) return '';
  const l = Lunar.fromDate(date);
  if (currentLang().indexOf('zh') !== 0) return t('app.lunarDay', { day: l.getDay() });
  // 初一：农历月名前置，如「九月 初一」（闰月为「闰九月 初一」）。
  // 注意 getMonthInChinese() 仅返回数字字符（九/正/冬/腊，闰月为「闰九」），需手动补「月」。
  if (l.getDay() === 1) return `${l.getMonthInChinese()}月 ${l.getDayInChinese()}`;
  return l.getDayInChinese();
}

// 周几短标签（周一起始；词表来自语言资源 app.weekdaysShort）
export function weekdayShort(date) {
  if (!date) return '';
  const arr = t('app.weekdaysShort', { returnObjects: true });
  const i = date.getDay() === 0 ? 6 : date.getDay() - 1;
  return Array.isArray(arr) ? arr[i] : '';
}

// 「周几」带前缀的组合标签：中文「周一」，英文「Mon」
export function weekdayLong(date) {
  const wd = weekdayShort(date);
  return wd ? t('app.weekShort', { wd }) : '';
}

// 农历装饰标签：节气优先，其次节日
export function lunarTagText(date) {
  if (!date) return '';
  const l = Lunar.fromDate(date);
  const jq = l.getJieQi();
  if (jq) return jq;
  const fests = l.getFestivals();
  if (fests && fests.length) return fests[0];
  return '';
}

// 法定节假日信息：休息日(rest) 显示绿色「休」，调休上班(work) 显示橙色「班」
export function holidayOf(day) {
  if (!day) return null;
  const p = String(day).split('-');
  if (p.length !== 3) return null;
  const h = HolidayUtil.getHoliday(Number(p[0]), Number(p[1]), Number(p[2]));
  if (!h) return null;
  return { name: h.getName(), rest: !h.isWork(), work: h.isWork(), target: h.getTarget() };
}
