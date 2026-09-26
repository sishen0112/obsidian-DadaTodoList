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

// 记录唯一标识：`日期#行号`（日期为 YYYY-MM-DD 或 'inbox'），仅模块内部使用
function makeGuid(dateKey, lineNo) {
  return dateKey + '#' + lineNo;
}

export function parseGuid(guid) {
  const s = String(guid == null ? '' : guid);
  const i = s.lastIndexOf('#');
  if (i <= 0) return null;
  const dateKey = s.slice(0, i);
  const lineNo = Number(s.slice(i + 1));
  if (!dateKey || !Number.isFinite(lineNo) || lineNo < 0) return null;
  return { dateKey, lineNo };
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
  // 日期优先取行内 📅 标记；清单文件（键形如 cl:xxx）没有「文件日期」，
  // 任务日期只能来自 📅；每日笔记则回落到所在文件日期
  const baseDate = node.due || (dateKey === INBOX_KEY || String(dateKey || '').indexOf('cl:') === 0 ? null : dateKey);
  const dueAt = baseDate ? dateToMs(baseDate, node.time) : null;
  const inline = parseInline(node.summary);
  return {
    guid: makeGuid(dateKey, node.lineNo),
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
    dueAllDay: !node.time,
    dueEndAt: (baseDate && node.timeEnd) ? dateToMs(baseDate, node.timeEnd) : null,
    subtaskCount: (node.children || []).length,
    // 层级深度（0 = 顶层；每多一层缩进 +1），供清单视图按层级缩进显示
    indent: node.indentStr ? (node.indentStr.match(/\t/g) || []).length : 0,
    // 内部字段（前端可透传回服务端用于定位）
    date: dateKey,
    lineNo: node.lineNo,
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
  const d = new Date(t.dueAt);
  const md = (d.getMonth() + 1) + '/' + d.getDate();
  return d.getFullYear() === new Date().getFullYear() ? md : d.getFullYear() + '/' + md;
}

// 时间列：无日期为空；全天显示「全天」；否则 HH:MM（有时间段则 HH:MM-HH:MM）
export function timeText(task) {
  if (!task || !task.dueAt) return '';
  if (task.dueAllDay) return t('app.allDay');
  const s = pad2(new Date(task.dueAt).getHours()) + ':' + pad2(new Date(task.dueAt).getMinutes());
  if (task.dueEndAt) {
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

// 四日时间轴任务块配色：浅底 + 同色深字（按标题哈希取色）
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

// 时间轴任务块配色：按标题哈希取色（浅底深字）
export function colorOf(t) {
  const s = String((t && t.summary) || '');
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % TIMELINE_COLORS.length;
  return TIMELINE_COLORS[h];
}

// 全天 / 凌晨列表项的背景与文字色（与时间轴块同一套莫兰迪配色）
export function itemColor(t) {
  const c = colorOf(t);
  return { background: c.bg, color: 'var(--ink)' };
}

// 农历日文案：中文用库自带词表（初一、十五…）；
// 库的农历日词表（LunarUtil.DAY）不随 I18n 切换，英文下自行按数字格式化
export function lunarDayText(date) {
  if (!date) return '';
  const l = Lunar.fromDate(date);
  if (currentLang() === 'zh-cn') return l.getDayInChinese();
  return t('app.lunarDay', { day: l.getDay() });
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
