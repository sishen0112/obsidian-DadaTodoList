<template>
  <div class="tk-matrix">
    <section v-for="q in quads" :key="q.key" class="tk-quad"
             :style="{ '--q-color': q.color }"
             :class="{ 'drag-over': dragOverLevel === q.level }"
             @dragover.prevent="dragOverLevel = q.level"
             @drop.prevent="onQuadDrop(q.level, $event)">
      <header class="tk-quad-hd" :style="{ background: q.color }">
        <span class="tk-quad-t">{{ $t(q.titleKey) }}</span>
        <span class="cnt">{{ q.tasks.length }}</span>
        <div class="tk-quad-add" v-tooltip="$t('common.add')" @click.stop="ctx.openNew('', q.level)">
          <i class="la la-plus"></i>
        </div>
      </header>
      <div class="tk-quad-body">
        <div v-if="!q.groups.length" class="tk-q-empty">{{ $t('app.matrixEmpty') }}</div>
        <template v-for="grp in q.groups" :key="grp.key">
          <div class="tk-grp-h" :class="{ 'is-overdue': grp.isOverdue, 'tk-grp-done': grp.key === 'done' }" @click="toggleGroup(q.key, grp.key)">
            <i class="la la-caret-right tk-caret" :class="{ open: !isGroupCollapsed(q.key, grp.key) }"></i>
            <span class="tk-grp-label">{{ grp.label }}</span>
            <span class="cnt">{{ grp.tasks.length }}</span>
            <div v-if="grp.isOverdue" class="tk-postpone"
                 :title="$t('app.postponeAllTip')" @click.stop="ctx.openPostpone(grp.tasks)">{{ $t('app.postponeBtn') }}</div>
          </div>
          <div v-for="t in grp.tasks" v-show="!isGroupCollapsed(q.key, grp.key)" :key="t.guid" class="tk-q-item"
               :class="{ dragging: dragGuid === t.guid }"
               :style="{ '--q-color': q.color }"
               draggable="true" @dragstart="onDragStart(t, $event)" @dragend="clearDrag"
               @click="onTaskClick(t, $event)" @contextmenu.prevent="ctx.openCtx(t, $event)">
            <i class="tk-check" :class="[{ done: t.completed || t.cancelled }, statusIcon(t)]"
               @click.stop.prevent="ctx.toggle(t)"></i>
            <div class="tk-q-body">
              <div class="tk-q-title" :class="{ 'is-done': t.completed }" v-html="rich(t)" @click="onTitleClick"></div>
            </div>
            <div class="tk-q-meta">
              <span v-if="grp.isOverdue" class="tk-q-date is-overdue">{{ dateText(t) }}</span>
              <span v-else-if="spanRange(t)" class="tk-q-range">{{ spanRange(t) }}</span>
              <span v-else-if="timeText(t)" class="tk-q-time">{{ timeText(t) }}</span>
            </div>
          </div>
        </template>
      </div>
    </section>
  </div>
</template>

<script>
import { Tasks } from '../../composables/useTasks.js';
import { renderInlineHtml, dateText, timeText, statusIcon, priorityToLevel, levelToPriorityEmoji, weekdayShort } from '../../composables/tasks-logic.js';

// 四象限（艾森豪威尔矩阵）：按优先级把任务分到 2×2 网格（行占 50% 高、列占 50% 宽）
//   左上 红 重要且紧急   → 高优先级
//   右上 橙 重要不紧急   → 中优先级
//   左下 蓝 紧急不重要   → 低优先级
//   右下 绿 不重要不紧急 → 无优先级
const QUADS = [
  { key: 'tl', level: 'high',   titleKey: 'app.matrixTitleHigh',   color: '#e0584f' },
  { key: 'tr', level: 'medium', titleKey: 'app.matrixTitleMedium', color: '#e0a93b' },
  { key: 'bl', level: 'low',    titleKey: 'app.matrixTitleLow',    color: '#4a90d2' },
  { key: 'br', level: 'none',   titleKey: 'app.matrixTitleNone',   color: '#4caf7d' }
];

const pad = (n) => (n < 10 ? '0' + n : '' + n);
function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

export default {
  name: 'FourQuadrantView',
  props: {
    // TasksApp 实例：提供 tasks 数据与 toggle / onTaskClick / openCtx 等方法
    ctx: { type: Object, required: true },
    plugin: { type: Object, default: null },
    // 仅显示待办（隐藏已完成）；由 TasksApp 的 hideDone 传入，顶栏眼睛按钮切换
    hideDone: { type: Boolean, default: true }
  },
  data() {
    return { dragGuid: '', dragOverLevel: '', collapsed: {} };
  },
  computed: {
    // 任务（未取消）按优先级档位分入对应象限：待办在象限内按日期分组（已过期在最上），
    // 已完成（仅 hideDone 关闭时显示）单独列为该象限底部的「已完成」子分组，按完成时间倒序。
    // 象限头部计数 = 待办 + 已完成总数。
    quads() {
      const showDone = !this.hideDone;
      // 单遍分类：档位 → { pending, done }，避免对全量任务反复 filter
      const buckets = {
        high: { pending: [], done: [] },
        medium: { pending: [], done: [] },
        low: { pending: [], done: [] },
        none: { pending: [], done: [] }
      };
      for (const t of (this.ctx.tasks || [])) {
        if (t.cancelled) continue;
        const b = buckets[priorityToLevel(t.priority) || 'none'];
        (t.completed ? b.done : b.pending).push(t);
      }
      // 已完成按完成时间倒序（最近完成的在前）
      const byDoneDesc = (a, b) => (b.completedAt || 0) - (a.completedAt || 0);
      return QUADS.map((q) => {
        const b = buckets[q.level];
        const groups = this.groupTasks(b.pending);
        if (showDone && b.done.length) {
          groups.push({ key: 'done', label: this.$t('app.doneGroup'), isOverdue: false, tasks: b.done.sort(byDoneDesc) });
        }
        return Object.assign({}, q, { tasks: b.pending.concat(b.done), groups });
      });
    }
  },
  methods: {
    // 象限内按日期分组：已过期（最上，红）→ 今天 → 明天 → 未来逐日 → 无日期；各组内按到期日升序
    groupTasks(tasks) {
      const day = 86400000;
      const today0 = this.ctx.today0Ms;
      const todayKey = this.ctx.todayKey;
      const tomorrowKey = ymd(new Date(today0 + day));
      const overdue = { key: 'overdue', label: this.$t('app.overdue'), isOverdue: true, tasks: [] };
      const today = { key: 'today', label: this.$t('app.today'), isOverdue: false, tasks: [] };
      const tomorrow = { key: 'tomorrow', label: this.$t('app.tomorrow'), isOverdue: false, tasks: [] };
      const nodate = { key: 'nodate', label: this.$t('app.noDate'), isOverdue: false, tasks: [] };
      const futureMap = new Map();
      for (const t of tasks) {
        if (!t.dueAt) { nodate.tasks.push(t); continue; }
        const d = new Date(t.dueAt); d.setHours(0, 0, 0, 0);
        if (d.getTime() < today0) { overdue.tasks.push(t); continue; }
        const k = ymd(d);
        if (k === todayKey) { today.tasks.push(t); continue; }
        if (k === tomorrowKey) { tomorrow.tasks.push(t); continue; }
        let g = futureMap.get(k);
        if (!g) {
          g = {
            key: k,
            label: (d.getMonth() + 1) + '/' + d.getDate() + ' ' + this.$t('app.weekShort', { wd: weekdayShort(d) }),
            isOverdue: false, tasks: []
          };
          futureMap.set(k, g);
        }
        g.tasks.push(t);
      }
      const futures = [...futureMap.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
      const order = [overdue, today, tomorrow, ...futures, nodate];
      const sortByDue = (a, b) => (a.dueAt || Infinity) - (b.dueAt || Infinity);
      for (const g of order) g.tasks.sort(sortByDue);
      return order.filter((g) => g.tasks.length);
    },
    groupKey(level, key) { return level + ':' + key; },
    // 分组折叠：按 象限档位:组key 记录是否折叠（点击组头切换）
    toggleGroup(level, key) {
      const k = this.groupKey(level, key);
      const m = Object.assign({}, this.collapsed);
      if (m[k]) delete m[k]; else m[k] = true;
      this.collapsed = m;
    },
    isGroupCollapsed(level, key) { return !!this.collapsed[this.groupKey(level, key)]; },
    rich(t) { return renderInlineHtml(t && t.summary); },
    dateText(t) { return dateText(t); },
    timeText(t) { return timeText(t); },
    spanRange(t) { return this.ctx.spanRange(t); },
    statusIcon(t) { return statusIcon(t); },
    onTaskClick(t, e) { this.ctx.onTaskClick(t, e); },
    // 标题内链接点击：阻止冒泡，避免同时触发所在行的「打开编辑器」
    onTitleClick(e) { if (e.target && e.target.tagName === 'A') e.stopPropagation(); },
    // 跨象限拖拽：拖起任务，落点到另一象限即改优先级
    onDragStart(t, e) {
      this.dragGuid = t.guid;
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', t.guid); } catch (err) { /* 忽略 */ }
      }
    },
    clearDrag() { this.dragGuid = ''; this.dragOverLevel = ''; },
    async onQuadDrop(level, e) {
      const guid = (e.dataTransfer && e.dataTransfer.getData('text/plain')) || this.dragGuid;
      this.clearDrag();
      const task = (this.ctx.tasks || []).find((x) => x.guid === guid);
      if (!task) return;
      if (priorityToLevel(task.priority) === level) return; // 落在原象限，无变化
      try {
        await Tasks.updateTask(guid, { priority: levelToPriorityEmoji(level) });
        await this.ctx.onSaved();
      } catch (err) {
        this.ctx.setError((err && err.message) || String(err));
      }
    }
  }
};
</script>

<style scoped>
/* ===== 四象限网格（组件根）：2×2，每行 50% 高、每列 50% 宽，整体填满视图区 ===== */
.tk-matrix {
  flex: 1 1 0; min-height: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
  gap: 10px;
}
.tk-quad {
  display: flex; flex-direction: column; min-height: 0; min-width: 0;
  background: var(--panel); border: 1px solid var(--q-color);
  border-radius: var(--radius); overflow: hidden;
}
.tk-quad-hd {
  flex: none; display: flex; align-items: center; gap: 8px;
  padding: 10px 14px; color: #fff; font-weight: 700; font-size: 14px;
}
/* 拖拽悬停的象限：以标题色描一圈，提示可放置 */
.tk-quad.drag-over { box-shadow: 0 0 0 3px var(--q-color); }
.tk-quad-hd .cnt {
  font-size: 12px; opacity: .9;
  background: rgba(255, 255, 255, .22); border-radius: 999px; padding: 1px 9px;
  font-variant-numeric: tabular-nums;
}
/* 象限右上角「添加任务」：仅 hover 该象限时显示，按象限预置优先级（q.level 即 高/中/低/无） */
.tk-quad-add {
  margin-left: auto; flex: none;
  display: inline-flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; border: none; border-radius: 50%;
  background: rgba(255, 255, 255, .18); color: #fff; font-size: 14px; cursor: pointer;
  opacity: 0; pointer-events: none;
  transition: opacity .15s ease, background .15s ease;
}
.tk-quad:hover .tk-quad-add { opacity: 1; pointer-events: auto; }
.tk-quad-add:hover { background: rgba(255, 255, 255, .34); }
.tk-quad-body {
  flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 8px;
  display: flex; flex-direction: column; gap: 0;
}
.tk-q-item {
  display: flex; gap: 8px; align-items: center;
  padding: 8px;
  /* 任务底部浅灰虚线：用 Obsidian 标准浅灰描边色，淡淡分隔每一行 */
  border-bottom: 1px dashed var(--background-modifier-border);
  background: transparent; cursor: pointer;
  transition: background .15s ease, opacity .15s ease;
}
.tk-q-item:hover { background: var(--background-modifier-hover); }
.tk-q-item.dragging { opacity: .4; cursor: grabbing; }
/* 勾选圈用所在象限的标题色（经 --q-color 传入） */
.tk-q-item .tk-check { line-height: normal; color: var(--q-color); }
.tk-q-item .tk-check:hover { color: var(--q-color); opacity: .8; }
.tk-q-body { flex: 1 1 auto; min-width: 0; }
.tk-q-title { font-size: 13.5px; line-height: 1.45; color: var(--ink); word-break: break-word; }
.tk-q-title.is-done { opacity: .55; }
.tk-q-title :deep(a) { color: var(--text-accent); text-decoration: none; }
/* 日期与时间靠右、同一行内展示 */
.tk-q-meta { flex: none; text-align: right; display: flex; flex-direction: row; align-items: baseline; gap: 6px; }
.tk-q-date, .tk-q-time, .tk-q-range { font-size: 11px; color: var(--text-faint); font-variant-numeric: tabular-nums; white-space: nowrap; }
.tk-q-date.is-overdue { color: var(--c-cancel); }
.tk-q-empty { color: var(--ink-soft); opacity: .6; text-align: center; padding: 22px 0; font-size: 12.5px; }
/* 象限内按日期分组：组头（标签 + 计数 + 已过期的顺延按钮）；上间距加宽，分组间隔更明显 */
.tk-grp-h { display: flex; align-items: center; gap: 8px; margin: 10px 0 2px; cursor: pointer; user-select: none; }
.tk-grp-h .tk-caret { font-size: 11px; color: var(--ink-soft); transition: transform .15s ease; }
.tk-grp-h .tk-caret.open { transform: rotate(90deg); }
/* 组头比任务文字更重：字号略大 + 颜色加深（浅色主题向黑、深色主题向白，双向均更醒目） */
.tk-grp-label { font-size: 14px; font-weight: 700; color: var(--ink); }
.theme-light .tk-grp-label { color: color-mix(in srgb, var(--ink) 75%, #000); }
.theme-dark  .tk-grp-label { color: color-mix(in srgb, var(--ink) 75%, #fff); }
.tk-grp-h.is-overdue .tk-grp-label { color: #e0584f; }
.tk-grp-h .cnt { font-size: 11px; color: var(--text-faint); font-variant-numeric: tabular-nums; }
.tk-postpone {
  margin-left: auto; border: none !important; background: rgba(224, 88, 79, .12);
  font: inherit; font-size: 12px; font-weight: 600; color: var(--c-cancel) !important;
  padding: 2px 8px; border-radius: 7px; cursor: pointer;
  box-shadow: none !important; transition: background .15s ease;
}
.tk-postpone:hover { background: rgba(224, 88, 79, .22); }

/* 象限内「已完成」子分组标题：用完成色（绿）轻微区分 */
.tk-grp-done .tk-grp-label { color: var(--c-done); }

/* 超窄屏：改为单列堆叠，每个象限至少 160px 高 */
@media (max-width: 560px) {
  .tk-matrix { grid-template-columns: 1fr; grid-template-rows: none; grid-auto-rows: minmax(160px, 1fr); }
}
</style>
