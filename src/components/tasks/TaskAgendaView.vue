<template>
  <div class="tk-agendaview">
    <div v-if="!agendaGroups.length" class="tk-ag-none-all">{{ $t('app.noTasks') }}</div>
    <section v-for="g in agendaGroups" :key="g.kind + ':' + g.key"
             class="tk-ag" :data-key="g.key"
             :class="['is-' + g.kind, { 'is-today': g.isToday, 'is-collapsed': ctx.agendaCollapsed[g.kind], 'drop-target': g.kind === 'day' && ctx.dragOverKey === g.key }]"
             @dragover.prevent="g.kind === 'day' ? ctx.onDragOver(g.key, $event) : null"
             @drop.prevent="g.kind === 'day' ? ctx.onDrop(g.key) : null">
      <!-- 左侧：日期 / 分组标签 -->
      <div class="tk-ag-side" :class="{ clickable: g.kind !== 'day' }"
           @click="g.kind !== 'day' && ctx.toggleAgendaGroup(g.kind)">
        <template v-if="g.kind === 'day'">
          <span class="tk-ag-num">{{ g.dayNum }}</span>
          <div class="tk-ag-meta">
            <span class="tk-ag-wd">{{ $t('app.weekShort', { wd: g.weekday }) }}</span>
            <span class="tk-ag-lunar">{{ g.lunar }}</span>
            <span v-if="g.tag" class="tk-ag-tag">{{ g.tag }}</span>
            <span class="tk-ag-flags">
              <span v-if="g.isToday" class="tk-ag-today">{{ $t('app.todayBadge') }}</span>
              <span v-if="g.holiday" class="tk-ag-hb" :class="g.holiday.rest ? 'is-rest' : 'is-work'" :title="g.holiday.name">{{ g.holiday.rest ? $t('app.rest') : $t('app.work') }}</span>
            </span>
          </div>
        </template>
        <template v-else>
          <i class="la tk-ag-lico" :class="(g.kind === 'overdue' ? 'la-exclamation-circle' : 'la-angle-double-right') + (ctx.agendaCollapsed[g.kind] ? ' la-rotate-90' : '')"></i>
          <span class="tk-ag-label" :class="{ 'is-overdue': g.kind === 'overdue' }">{{ g.label }}</span>
        </template>
      </div>
      <!-- 右侧：任务列表（整体居中） -->
      <div class="tk-ag-main" v-show="!ctx.agendaCollapsed[g.kind]">
        <div v-if="!g.tasks.length" class="tk-ag-none" :class="{ 'is-today': g.isToday }">{{ $t('app.dayEmpty') }}</div>
        <div v-for="t in g.tasks" :key="t.guid" class="tk-ag-row"
             :class="{ done: t.completed || t.cancelled, dragging: ctx.dragGuid === t.guid }"
             draggable="true" :title="ctx.dragHint(t)"
             @dragstart="ctx.onDragStart(t, $event)" @dragend="ctx.onDragEnd" @click="ctx.onTaskClick(t, $event)"
             @contextmenu.prevent="ctx.openCtx(t, $event)">
          <span class="tk-ag-time">{{ ctx.agendaWhen(t, g.kind) }}</span>
          <span class="tk-ag-axis">
            <i class="tk-ag-dot" :class="[t.cancelled ? 'la la-minus-circle' : (t.completed ? 'la la-check-circle' : 'la la-circle-o'), { done: t.completed || t.cancelled, cancel: t.cancelled }]"
               @click.stop.prevent="ctx.toggle(t)" :title="(t.completed || t.cancelled) ? $t('app.markUndone') : $t('app.markDone')"></i>
          </span>
          <div class="tk-ag-card" :style="ctx.agendaCard(t)">
            <span class="tk-ag-sum" :class="{ done: t.completed || t.cancelled }" v-html="ctx.richSummaryNoTags(t)" @click="ctx.onRichClick"></span>
            <!-- 跨日期任务右侧小字：显示开始-结束日期区间（如 10/2-10/7） -->
            <span v-if="ctx.spanRange(t)" class="tk-ag-range">{{ ctx.spanRange(t) }}</span>
          </div>
        </div>
      </div>
      <button v-if="g.kind === 'day'" class="tk-add tk-ag-add" type="button" @click.stop="ctx.openNew(g.key)" :title="$t('app.addDayTask')"><i class="la la-plus-circle"></i></button>
    </section>
  </div>
</template>

<script>
// 日程视图：按日期顺序的纵向议程（已延期 → 今天起未来7天 → 更远）。
// 只读父级共享状态/方法（通过 ctx），自身只持有分组计算。
import { weekdayShort } from '../../composables/tasks-logic.js';

const pad = (n) => (n < 10 ? '0' + n : '' + n);
function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

export default {
  name: 'TaskAgendaView',
  props: {
    ctx: { type: Object, required: true },
    plugin: { type: Object, default: null }
  },
  computed: {
    // 日程视图分组：已延期 → 今天起未来 7 天（按天）→ 更远；无日期任务不进入
    agendaGroups() {
      const ctx = this.ctx;
      const day = 86400000;
      const today0 = ctx.today0Ms;
      const horizon = today0 + 7 * day; // 今天 ~ 今天+6
      const overdue = [];
      const far = [];
      const dayMap = new Map();
      for (let i = 0; i < 7; i++) dayMap.set(ymd(new Date(today0 + i * day)), []);
      for (const t of ctx.tasks) {
        if (!t.dueAt) continue;
        const sKey = (t.startAt && t.startAt !== t.dueAt) ? ymd(new Date(t.startAt)) : null;
        const eKey = ymd(new Date(t.dueAt));
        const isSpan = !!sKey && sKey < eKey; // 真正跨天（开始日早于结束日）
        if (!isSpan) {
          // 单日任务：按 anchor（跨天则起始日，否则到期日）归组
          const anchor = (t.startAt && t.startAt !== t.dueAt) ? t.startAt : t.dueAt;
          const d0 = new Date(anchor); d0.setHours(0, 0, 0, 0);
          const ms = d0.getTime();
          if (ms < today0) { if (!t.completed && !t.cancelled) overdue.push(t); continue; }
          if (ms < horizon) { dayMap.get(ymd(d0)).push(t); continue; }
          far.push(t);
          continue;
        }
        // 跨日期任务：在 [开始日, 结束日] 的每一天都显示（窗口内逐日归组；
        // 整段都已过去的未完成项 → 已延期；超出 7 天窗口的尾部 → 「更远」，各只计一次）
        const sMs = new Date(t.startAt); sMs.setHours(0, 0, 0, 0);
        const endMsT = new Date(t.dueAt); endMsT.setHours(0, 0, 0, 0);
        const endT = endMsT.getTime();
        if (endT < today0) {
          if (!t.completed && !t.cancelled) overdue.push(t);
          continue;
        }
        let addedFar = false;
        for (let cur = Math.max(sMs.getTime(), today0); cur <= endT; cur += day) {
          if (cur < horizon) {
            dayMap.get(ymd(new Date(cur))).push(t);
          } else if (!addedFar) {
            far.push(t);
            addedFar = true;
          }
        }
      }
      const out = [];
      if (overdue.length) out.push({ kind: 'overdue', key: 'overdue', label: this.$t('app.agendaOverdue'), tasks: overdue.sort(ctx.byDue) });
      for (const [k, list] of dayMap) {
        const tasks = ctx.visibleTasks(list).slice().sort(ctx.byDue);
        if (!tasks.length && k !== ctx.todayKey) continue; // 空的天跳过，但今天始终保留
        const d = new Date(k + 'T00:00:00');
        out.push({
          kind: 'day', key: k, isToday: k === ctx.todayKey,
          dayNum: d.getDate(),
          weekday: weekdayShort(d),
          lunar: ctx.lunarDayText(d),
          tag: ctx.lunarTagText(d),
          holiday: ctx.holidayOf(k),
          tasks
        });
      }
      const farTasks = ctx.visibleTasks(far).slice().sort(ctx.byDue);
      if (farTasks.length) out.push({ kind: 'far', key: 'far', label: this.$t('app.far'), tasks: farTasks });
      return out;
    }
  }
};
</script>

<!-- 非 scoped：日程视图类名 tk- 前缀限定，随 tasks-shared.css 一并全局可用 -->
<style>
/* ===== 日程视图：按日期顺序的纵向议程 ===== */
/* container-type 让内部日期随「面板宽度」响应（与左侧 .tk-ag-nav 的 @container 一致），
   而不是随浏览器主窗口（@media 视口）变化 */
.tk-agendaview { flex: 1 1 auto; min-height: 0; overflow: auto; position: relative; padding-right: 4px; max-width: 800px; margin: 0 auto; container-type: inline-size; }
.tk-ag-none-all { color: var(--ink-soft); padding: 40px; text-align: center; }
/* 分组：左侧日期/标签列 + 右侧任务列表（列表整体居中） */
.tk-ag { position: relative; display: flex; align-items: flex-start; gap: 16px; padding: 10px 0 4px; margin-bottom: 12px; }
.tk-ag.drop-target { border-radius: 12px; box-shadow: 0 0 0 1px var(--gold) inset; }
/* 左侧日期列：吸顶固钉（Affix，滚动时钉在顶部），紧贴左缘 */
.tk-ag-side { position: sticky; top: 8px; align-self: flex-start; flex: none; width: 96px; display: flex; align-items: flex-start; gap: 7px; padding: 12px 0 12px 10px; }
.tk-ag-side.clickable { cursor: pointer; }
.tk-ag-num { min-width: 26px; text-align: center; font-size: 24px; font-weight: 700; line-height: 1; color: var(--ink); font-variant-numeric: tabular-nums; }
.tk-ag-meta { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; min-width: 0; }
.tk-ag-sub { display: flex; align-items: baseline; gap: 5px; min-width: 0; }
.tk-ag-wd { font-size: 12.5px; font-weight: 700; line-height: 1.2; color: var(--ink); }
.tk-ag-lunar { font-size: 11.5px; color: var(--ink-soft); }
.tk-ag-tag { font-size: 11.5px; font-weight: 600; color: var(--c-cancel); }
.tk-ag-flags { display: flex; align-items: center; gap: 5px; margin-top: 1px; }
.tk-ag-hb { flex: none; font-size: 9px; font-weight: 700; line-height: 14px; padding: 0 4px; border-radius: 9px; }
.tk-ag-hb.is-rest { color: var(--text-on-accent); background: var(--c-done); }
.tk-ag-hb.is-work { color: var(--text-on-accent); background: var(--c-cancel); }
.tk-ag-today { flex: none; font-size: 10px; font-weight: 700; color: var(--text-on-accent); background: var(--gold); padding: 1px 7px; border-radius: 999px; }
/* 分组标签（已延期 / 更远） */
.tk-ag-lico { font-size: 13px; color: var(--ink-soft); transition: transform .15s ease; }
.tk-ag-lico.la-rotate-90 { transform: rotate(90deg); }
.tk-ag-label { font-size: 13px; font-weight: 700; color: var(--ink-soft); }
.tk-ag-label.is-overdue { color: var(--c-cancel); }
/* 右侧列表：紧贴日期向右铺开（不再整体居中，解决偏右问题） */
.tk-ag-main { position: relative; flex: 1 1 auto; min-width: 0; margin: 0; display: flex; flex-direction: column; }
/* 加号按钮定位：每日段右上角（外观与显示逻辑统一走全局 .tk-add / .task-app .tk-ag:hover .tk-ag-add） */
.tk-ag-add { position: absolute; top: 4px; right: 0; }
.tk-ag-none { color: var(--ink-soft); font-size: 12px; padding: 4px 2px 2px; }
/* 今日空状态：居中、加大留白与字号 */
.tk-ag-none.is-today { text-align: center; font-size: 14px; color: var(--ink-soft); padding: 22px 10px; }
.tk-ag-row { display: grid; grid-template-columns: 52px 22px minmax(0, 1fr); align-items: stretch; cursor: pointer; }
.tk-ag-time { display: flex; align-items: center; justify-content: flex-end; padding-right: 7px; font-size: 12px; color: var(--ink-soft); font-variant-numeric: tabular-nums; white-space: nowrap; }
.tk-ag-axis { position: relative; display: flex; align-items: center; justify-content: center; }
.tk-ag-axis::before { content: ''; position: absolute; left: 50%; top: 0; bottom: 0; width: 1px; background: var(--line); transform: translateX(-50%); }
/* 时间轴首尾：线只连到圆点，不超出 */
.tk-ag-row:first-child .tk-ag-axis::before { top: 50%; }
.tk-ag-row:last-child .tk-ag-axis::before { bottom: 50%; }
/* 时间轴圆点：兼作「完成待办」可点击开关；尺寸/配色与列表视图 .tk-check 统一；面板色圆盘遮挡轴线 */
.tk-ag-dot { position: relative; z-index: 1; display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 50%; background: var(--panel); font-size: 20px; line-height: 1; color: var(--ink-soft); cursor: pointer; transition: color .15s ease, transform .12s ease; }
.tk-ag-dot:hover { color: var(--gold); }
.tk-ag-dot:active { transform: scale(.9); }
.tk-ag-dot.done { color: var(--c-done); }
.tk-ag-dot.cancel { color: var(--c-cancel); }
.tk-ag-card { display: flex; align-items: center; gap: 8px; margin: 10px 20px; padding: 20px 10px; border-radius: 10px; border-left: 3px solid var(--ag-bar, var(--line)); min-width: 0; transition: filter .15s ease; }
.tk-ag-card:hover { filter: brightness(.97); }
.tk-ag-sum { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
/* 跨日期任务右侧小字：开始-结束日期区间（如 10/2-10/7），靠右、小号、低透明度 */
.tk-ag-range { flex: none; margin-left: auto; padding-left: 8px; font-size: 9px; opacity: .7; font-variant-numeric: tabular-nums; white-space: nowrap; }
.tk-ag-sum.done { text-decoration: line-through; opacity: .55; }
.tk-ag-row.done .tk-ag-time { opacity: .55; }
.tk-ag-row.dragging { opacity: .5; }
/* 视图变窄时：日期信息移到任务列表上方，让列表占满整宽。
   改用 @container（面板宽度）而非 @media（主窗口），使其与左侧日期导航行为一致 */
@container (max-width: 720px) {
  .tk-ag { flex-direction: column; gap: 4px; }
  .tk-ag-side { position: relative; top: 0; align-self: stretch; width: auto; padding: 4px 0 6px; }
  .tk-ag-main { width: 100%; }
}
/* 极窄（与左侧日期导航一致）：隐藏「星期」与「农历」，仅保留日号与标签，避免拥挤 */
@container (max-width: 240px) {
  .tk-ag-wd, .tk-ag-lunar { display: none; }
}
/* 极窄（≤480px）：紧凑卡片留白 */
@container (max-width: 480px) {
  .tk-ag-card { margin: 8px 8px; padding: 14px 8px; }
}
</style>
