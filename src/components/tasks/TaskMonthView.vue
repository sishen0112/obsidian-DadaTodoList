<template>
  <div class="tk-monthview">
    <div class="tk-month-wrap">
      <div class="tk-month-card">
      <div class="tk-month-weekdays">
        <span v-for="w in ctx.weekdayLabels" :key="w" class="tk-month-wd">{{ w }}</span>
      </div>
      <div class="tk-month-grid">
        <!-- 每个「周行」独立成一格网格：跨日任务在本周内横向跨列（跨到下一周自动另起一条） -->
        <div v-for="w in monthWeeks" :key="'w' + w.index" class="tk-mweek"
             :style="{ '--week-lanes': w.lanes }"
             @dragover.prevent="onWeekDragOver(w, $event)"
             @drop.prevent="onWeekDrop(w, $event)">
          <div v-for="c in w.cells" :key="c.day" class="cel"
               :class="{ other: c.other, today: c.today, 'drop-target': ctx.dragOverKey === c.day }">
            <div class="cel-top">
              <div class="cel-date">
                <!-- 法定节假日：休/班 自绘徽标（替代 el-badge） -->
                <span v-if="ctx.holidayOf(c.day)" class="cel-hb" :class="ctx.holidayOf(c.day).rest ? 'is-rest' : 'is-work'" :title="ctx.holidayOf(c.day).name">
                  {{ ctx.holidayOf(c.day).rest ? $t('app.rest') : $t('app.work') }}
                </span>
                <span class="cel-day">{{ c.day.split('-')[2] }}</span>
                <span class="cel-lunar">{{ ctx.lunarDayText(c.date) }}</span>
                <span v-if="ctx.lunarTagText(c.date)" class="cel-lunar-tag">{{ ctx.lunarTagText(c.date) }}</span>
              </div>
              <button class="tk-add" type="button" :title="$t('app.addDayTask')" @click.stop="ctx.openNew(c.day)"><i class="la la-plus-circle"></i></button>
            </div>
            <div class="cel-tasks">
              <!-- 单日任务（跨日任务由上方横跨条渲染，不在此重复） -->
              <div v-for="t in dayChips(c)" :key="t.guid" class="cel-task"
                   :class="{ done: t.completed || t.cancelled, dragging: ctx.dragGuid === t.guid, selected: selectedGuid === t.guid }"
                   :style="ctx.itemColor(t)"
                   :title="ctx.dragHint(t)" :draggable="!resizing"
                   @dragstart="ctx.onDragStart(t, $event)"
                   @dragend="ctx.onDragEnd"
                   @click.stop="onSelect(t, $event)" @dblclick.stop="ctx.onTaskClick(t, $event)"
                   @contextmenu.prevent="ctx.openCtx(t, $event)">
                <i class="tk-check" :class="[{ done: t.completed || t.cancelled }, ctx.statusIcon(t)]" @click.stop.prevent="ctx.toggle(t)"></i>
                <span class="cel-task-sum" v-html="ctx.richSummary(t)" @click="ctx.onRichClick"></span>
                <span v-if="ctx.taskTime(t)" class="cel-task-time">{{ ctx.taskTime(t) }}</span>
                <!-- 单日全天：选中后首/尾出现拖动柄，可延伸为跨日期 -->
                <div v-if="isChipSelected(t)" class="cel-span-h cel-span-h-l"
                     :title="$t('app.spanMoveTip')"
                     @pointerdown.stop.prevent="onSpanResizeDown('start', t, w, $event)" @mousedown.stop.prevent @click.stop.prevent @dragstart.stop.prevent></div>
                <div v-if="isChipSelected(t)" class="cel-span-h cel-span-h-r"
                     :title="$t('app.spanMoveTip')"
                     @pointerdown.stop.prevent="onSpanResizeDown('end', t, w, $event)" @mousedown.stop.prevent @click.stop.prevent @dragstart.stop.prevent></div>
              </div>
            </div>
          </div>
          <!-- 横跨条层：与日期格同列模板，按 startIdx/endIdx + 泳道定位，跨周自动另起 -->
          <div class="tk-mbars">
            <div v-for="b in w.bars" :key="b.t.guid" class="cel-bar"
                 :class="{ done: b.t.completed || b.t.cancelled, dragging: ctx.dragGuid === b.t.guid, selected: selectedGuid === b.t.guid, 'cont-start': b.contStart, 'cont-end': b.contEnd }"
                 :style="barStyle(b)"
                 :title="ctx.dragHint(b.t)" :draggable="!resizing"
                 @dragstart="ctx.onDragStart(b.t, $event)"
                 @dragend="ctx.onDragEnd"
                 @click.stop="onSelect(b.t, $event)" @dblclick.stop="ctx.onTaskClick(b.t, $event)"
                 @contextmenu.prevent="ctx.openCtx(b.t, $event)">
              <i class="tk-check" :class="[{ done: b.t.completed || b.t.cancelled }, ctx.statusIcon(b.t)]" @click.stop.prevent="ctx.toggle(b.t)"></i>
              <span class="cel-task-sum" v-html="ctx.richSummary(b.t)" @click="ctx.onRichClick"></span>
              <!-- 跨日期条右侧小字：显示开始-结束日期区间（如 10/2-10/7） -->
              <span class="cel-bar-range">{{ ctx.spanRange(b.t) }}</span>
              <!-- 全天/跨日期条：选中后首/尾出现拖动柄（拖左柄改开始日、拖右柄改结束日，另一端不变） -->
              <div v-if="isSpanSelected(b)" class="cel-span-h cel-span-h-l"
                   :title="$t('app.spanMoveTip')"
                   @pointerdown.stop.prevent="onSpanResizeDown('start', b.t, w, $event)" @mousedown.stop.prevent @click.stop.prevent @dragstart.stop.prevent></div>
              <div v-if="isSpanSelected(b)" class="cel-span-h cel-span-h-r"
                   :title="$t('app.spanMoveTip')"
                   @pointerdown.stop.prevent="onSpanResizeDown('end', b.t, w, $event)" @mousedown.stop.prevent @click.stop.prevent @dragstart.stop.prevent></div>
            </div>
          </div>
        </div>
      </div>
      </div>
      <!-- 右侧待办池：默认展开，可拖到日历改期，也可把日历任务拖回（清除日期） -->
      <todo-side-panel :open="ctx.todoPanelOpen" :tasks="ctx.tasks" :checklists="ctx.checklists"
                       :drag-guid="ctx.dragGuid" :drag-task="ctx.dragTask" @toggle-panel="ctx.closeTodoPanel" @open-task="ctx.onTaskClick"
                       @drag-start="ctx.onDragStart" @drag-end="ctx.onDragEnd" @rich-click="ctx.onRichClick"
                       @saved="ctx.onSaved" @error="ctx.setError" />
    </div>
  </div>
</template>

<script>
// 月视图：日历网格 + 左侧「待办」拖拽面板（面板与周视图共用，样式在 tasks-shared.css）。
// 只读父级共享状态/方法（通过 ctx），自身只持有月网格计算。
import TodoSidePanel from '../TodoSidePanel.vue';
import { getWeekStart, layoutSpanBars, spansDays, todayKey } from '../../composables/tasks-logic.js';

const pad = (n) => (n < 10 ? '0' + n : '' + n);
function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

export default {
  name: 'TaskMonthView',
  components: { TodoSidePanel },
  props: {
    // 父组件实例（TasksApp），用于访问共享数据 / 方法与辅助函数
    ctx: { type: Object, required: true },
    plugin: { type: Object, default: null }
  },
  data() {
    return { resizing: null, selectedGuid: '' };
  },
  computed: {
    // 当前显示月份（YYYY-MM），用于统计与筛选
    monthCells() {
      const ctx = this.ctx;
      const base = new Date(ctx.currentMonth.getFullYear(), ctx.currentMonth.getMonth(), 1);
      const year = base.getFullYear(), month = base.getMonth() + 1;
      const dim = new Date(year, month, 0).getDate();
      const startOffset = (base.getDay() - getWeekStart() + 7) % 7; // 首列 = 每周开始日
      const cells = [];
      for (let i = startOffset; i > 0; i--) {
        const d = new Date(year, month - 1, 1 - i);
        cells.push({ date: d, day: ymd(d), other: true });
      }
      for (let d = 1; d <= dim; d++) {
        const dt = new Date(year, month - 1, d);
        cells.push({ date: dt, day: ymd(dt), other: false, today: ymd(dt) === ctx.todayKey });
      }
      while (cells.length % 7 !== 0) {
        const last = cells[cells.length - 1].date;
        const nd = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1);
        cells.push({ date: nd, day: ymd(nd), other: true });
      }
      return cells;
    },
    // 跨日任务（开始日与到期日不同天，无论是否带具体时刻）——不落在单元格内，而由「横跨条」渲染
    spanTasks() {
      const ctx = this.ctx;
      const list = ctx.visibleTasks ? ctx.visibleTasks(ctx.tasks || []) : (ctx.tasks || []);
      return list.filter((t) => spansDays(t));
    },
    // 按周（每 7 个单元格）分组，并对每周做跨日任务的泳道排布
    monthWeeks() {
      const cells = this.monthCells;
      const weeks = [];
      for (let i = 0; i < cells.length; i += 7) {
        const wk = cells.slice(i, i + 7);
        const { bars, lanes } = layoutSpanBars(wk.map((c) => c.day), this.spanTasks);
        weeks.push({ index: i / 7, cells: wk, bars, lanes });
      }
      return weeks;
    }
  },
  methods: {
    // 单元格内的「单日」任务（跨日任务由横跨条渲染，避免重复）
    dayChips(c) {
      return this.ctx.tasksOf(c.day).filter((t) => !spansDays(t));
    },
    // 任务项单击：选中（跨日期条由此显示首/尾日期柄）；Ctrl/⌘ 单击直达编辑框
    onSelect(t, e) {
      if (e && (e.metaKey || e.ctrlKey)) { this.ctx.onTaskClick(t, e); return; }
      this.selectedGuid = t.guid;
    },
    // 全天/跨日期条且当前选中：显示首/尾日期拖动柄（单日全天也可拖成跨日期）
    isSpanSelected(b) {
      return this.selectedGuid === b.t.guid && (b.t.dueAllDay || spansDays(b.t));
    },
    // 单日全天 chip 且当前选中：显示首/尾日期拖动柄（定时任务不显示，避免与时刻冲突）
    isChipSelected(t) {
      return this.selectedGuid === t.guid && t.dueAllDay && !spansDays(t);
    },
    // 全天/跨日期条：首/尾日期柄按下。跨日期→整条平移（只改开始日）；单日全天→延伸为跨日期
    onSpanResizeDown(which, t, w, e) {
      const container = e.currentTarget.closest('.tk-mweek');
      const isSpan = spansDays(t);
      const dueKey = todayKey(Number(t.dueAt));
      let origDays = 1;
      if (isSpan) {
        const sd = new Date(Number(t.startAt)); sd.setHours(0, 0, 0, 0);
        const dd = new Date(Number(t.dueAt)); dd.setHours(0, 0, 0, 0);
        origDays = Math.max(1, Math.round((dd - sd) / 86400000) + 1); // 含首尾的原跨度天数
      }
      const anchorMs = new Date(dueKey + 'T00:00:00').getTime(); // 原始单日锚点
      this.resizing = { which, t, isSpan, origDays, dueKey, anchorMs, w, container, lastKey: '' };
      const barEl = e.currentTarget.closest('.cel-bar, .cel-task');
      if (barEl) barEl.draggable = false; // 立即关闭原生拖拽，避免「拖柄变成拖动任务」
      window.addEventListener('pointermove', this.onSpanResizeMove);
      window.addEventListener('pointerup', this.onSpanResizeUp);
    },
    onSpanResizeMove(e) {
      const r = this.resizing;
      if (!r) return;
      const n = r.w.cells.length;
      const rect = r.container.getBoundingClientRect();
      if (rect.width <= 0) return;
      let i = Math.floor(((e.clientX - rect.left) / rect.width) * n);
      i = Math.max(0, Math.min(n - 1, i));
      let key = r.w.cells[i].day; // 落点所在日期
      // 单日全天延伸：左柄不能越过原单日、右柄不能早于原单日（否则退化为单日）
      if (!r.isSpan) {
        if (r.which === 'start' && key > r.dueKey) key = r.dueKey;
        else if (r.which === 'end' && key < r.dueKey) key = r.dueKey;
      }
      if (key === r.lastKey) return;
      r.lastKey = key;
      // 跨日期→改开始日、结束日自动按原天数；单日全天→按柄延伸开始/结束日
      this.ctx.resizeSpan(r.t, r.which, key, r.isSpan, r.origDays, r.anchorMs);
    },
    onSpanResizeUp() {
      const r = this.resizing;
      if (!r) return;
      this.resizing = null;
      window.removeEventListener('pointermove', this.onSpanResizeMove);
      window.removeEventListener('pointerup', this.onSpanResizeUp);
      this.ctx.resizeSpanCommit(r.t);
    },
    // 横跨条定位：列区间 [startIdx, endIdx] → grid 列，泳道 → grid 行
    barStyle(b) {
      return Object.assign({
        gridColumn: (b.startIdx + 1) + ' / ' + (b.endIdx + 2),
        gridRow: String(b.lane + 1)
      }, this.ctx.itemColor(b.t));
    },
    // 落点日期：横跨条会挡住逐格 drop 区，故在「周行」容器层按落点 x 统一判定
    dayFromX(w, e) {
      const el = e && e.currentTarget;
      if (!el) return '';
      const n = w.cells.length;
      if (n <= 0) return '';
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0) return '';
      let i = Math.floor(((e.clientX - rect.left) / rect.width) * n);
      if (i < 0) i = 0;
      if (i > n - 1) i = n - 1;
      return w.cells[i] ? w.cells[i].day : '';
    },
    onWeekDragOver(w, e) {
      const day = this.dayFromX(w, e);
      if (day) this.ctx.onDragOver(day, e);
    },
    onWeekDrop(w, e) {
      const day = this.dayFromX(w, e);
      if (day) this.ctx.onDrop(day);
    }
  }
};
</script>

<!-- 非 scoped：月视图类名 tk- 前缀限定，随 tasks-shared.css 一并全局可用 -->
<style>
/* ===== 月视图 ===== */
.tk-monthview { flex: 1 1 auto; min-height: 0; overflow: hidden; container-type: inline-size; --cel-head: 30px; --lane-h: 24px; }
.tk-month-wrap { display: flex; align-items: flex-start; height: 100%; overflow: hidden; }
.tk-month-card { flex: 1 1 auto; min-width: 0; min-height: 0; align-self: stretch; overflow-y: auto; }
/* 星期头部与日期网格统一：细边框连续风格，1px 间隙透出边框色，整体 10px 圆角 */
.tk-month-weekdays { position: sticky; top: 0; z-index: 2; display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 1px; margin-bottom: 0; background: var(--line); }
.tk-month-wd { text-align: center; font-size: 12px; font-weight: 600; color: var(--ink-soft); letter-spacing: 1px; background: var(--panel); padding: 6px 0; }
.tk-month-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 1px; background: var(--line); }
/* 周行：7 列网格；内部横跨条层与之同列模板，保证与日期格对齐 */
.tk-mweek { position: relative; display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 1px; background: var(--line); }
.cel {
  min-width: 0; min-height: 106px; padding: 0 4px 8px; display: flex; flex-direction: column;
  background: var(--panel); border: none; border-radius: 0;
  transition: box-shadow .15s ease;
}
.cel.other { opacity: .45; }
.cel:hover { box-shadow: var(--shadow); }
.cel.today { box-shadow: inset 0 0 0 1px var(--gold); }
/* 拖拽悬停的日期格 */
.cel.drop-target { background: var(--gold-bg); box-shadow: inset 0 0 0 2px var(--gold); }
.cel-top { height: var(--cel-head, 30px); box-sizing: border-box; padding-top: 6px; display: flex; align-items: center; justify-content: space-between; gap: 4px; }
.cel-date { display: flex; align-items: baseline; gap: 4px; min-width: 0; }
/* 法定节假日自绘徽标：休息日绿底白字「休」、调休上班红底白字「班」（对齐首页日历） */
.cel-hb {
  flex: none; font-size: 8px; font-weight: 700; line-height: 12px;
  padding: 0 3px; border-radius: 9px; align-self: flex-start;
  transform: translateY(-2px);
}
.cel-hb.is-rest { color: var(--text-on-accent); background: var(--c-done); }
.cel-hb.is-work { color: var(--text-on-accent); background: var(--c-cancel); }
.cel-day { font-size: 14px; font-weight: 600; color: var(--ink); }
.cel-lunar { font-size: 11px; color: var(--ink-soft); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cel-lunar-tag { font-size: 11px; color: var(--c-cancel); white-space: nowrap; }
.cel-tasks { min-width: 0; margin-top: calc(var(--week-lanes, 0) * var(--lane-h, 24px) + 2px); display: flex; flex-direction: column; gap: 3px; overflow-y: auto; }
.cel-task {
  min-width: 0;
  display: flex; align-items: center; gap: 4px; font-size: 11.5px; line-height: 1.35; color: var(--ink);
  background: var(--panel); border-radius: 6px; padding: 2px 6px;
  cursor: grab; overflow: hidden; transition: box-shadow .15s ease, opacity .15s ease;
}
.cel-task:hover { box-shadow: var(--shadow); }
.cel-task.dragging { opacity: .4; cursor: grabbing; }
/* 提高特异性以压过 tasks-shared.css 的 .task-app .tk-check（20px）；其余视图不受影响 */
.task-app .cel-task .tk-check { flex: none; width: 12px; height: 12px; font-size: 14px; line-height: 12px; }
.cel-task-sum { flex: 1 1 auto; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cel-task-time { flex: none; margin-left: auto; font-size: 9px; opacity: .65; font-variant-numeric: tabular-nums; }
.cel-task.done { color: var(--ink-soft); opacity: .6; }
/* 跨日横跨条层：与日期格同列模板，按泳道逐行排布；跨到下一周由父级另起一条 */
.tk-mbars {
  position: absolute; inset: 0; pointer-events: none;
  display: grid; grid-template-columns: repeat(7, minmax(0, 1fr));
  column-gap: 1px; row-gap: 0;
  grid-auto-rows: var(--lane-h, 24px); padding-top: var(--cel-head, 30px);
}
.cel-bar {
  position: relative; pointer-events: auto; align-self: stretch; min-width: 0; overflow: hidden;
  display: flex; align-items: center; gap: 4px; margin: 0 1px 3px; padding: 2px 7px;
  font-size: 11.5px; line-height: 1.35; color: var(--ink); border-radius: 6px; cursor: grab;
  transition: box-shadow .15s ease, opacity .15s ease;
}
.cel-bar.selected { box-shadow: 0 0 0 2px var(--gold); padding-right: 16px; }
/* 跨日期条右侧小字：开始-结束日期区间（如 10/2-10/7），靠右、小号、低透明度 */
.cel-bar-range { flex: none; margin-left: auto; padding-left: 6px; font-size: 9px; opacity: .7; font-variant-numeric: tabular-nums; white-space: nowrap; }
/* 月视图 chip 的祖先 .cel-tasks 为 overflow-y:auto，会裁切外扩 box-shadow；选中改用 inset 内描边，永不被裁切 */
.cel-task.selected { box-shadow: inset 0 0 0 2px var(--gold); }
/* 跨日期横跨条首/尾日期拖动柄：平时隐藏，选中时显示；靠左右内边缘，避免被 overflow 裁切 */
.cel-span-h {
  position: absolute; top: 0; bottom: 0; width: 10px;
  cursor: ew-resize; z-index: 4; opacity: 0; pointer-events: none; transition: opacity .12s ease;
}
.cel-span-h::before {
  content: ''; position: absolute; top: 22%; bottom: 22%; left: 3px;
  width: 4px; border-radius: 3px; background: var(--gold); box-shadow: 0 0 0 2px var(--paper);
}
.cel-span-h-l { left: 0; }
.cel-span-h-r { right: 0; }
.cel-span-h-r::before { left: auto; right: 3px; }
.cel-bar.selected .cel-span-h { opacity: 1; pointer-events: auto; }
.cel-bar.selected .cel-span-h:hover::before { filter: brightness(1.12); }
/* 单日全天 chip 同样支持首/尾拖动柄（锚定到 chip 自身） */
.cel-task { position: relative; }
.cel-task.selected .cel-span-h { opacity: 1; pointer-events: auto; }
.cel-task.selected .cel-span-h:hover::before { filter: brightness(1.12); }
.cel-bar:hover { box-shadow: var(--shadow); }
.cel-bar.dragging { opacity: .4; cursor: grabbing; }
.cel-bar.done { color: var(--ink-soft); opacity: .6; }
/* 续接端（非真实起止）不收圆角，以示「仍在延续」 */
.cel-bar.cont-start { border-top-left-radius: 0; border-bottom-left-radius: 0; }
.cel-bar.cont-end { border-top-right-radius: 0; border-bottom-right-radius: 0; }
.cel-bar .cel-task-sum { flex: 1 1 auto; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.task-app .cel-bar .tk-check { flex: none; width: 12px; height: 12px; font-size: 14px; line-height: 12px; }
/* 周/月视图：完成与取消任务均不显示删除线（仅降透明度区分） */
.tk-weekview .tk-item .tk-sum { text-decoration: none; }
/* ===== 响应式：仅容器查询即可等价于「窗口或面板 < 阈值」 =====
   根 .tk-monthview 为 container-type: inline-size，其宽度 = 面板宽度 ≤ 窗口宽度，
   故「面板 < 阈值」在逻辑上已涵盖「窗口 < 阈值」，无需再写 @media（窗口）块。 */
@container (max-width: 860px) {
  .cel { min-height: 92px; }
  /* 窄屏：待办面板改为日历上方整宽 */
  .tk-month-wrap { flex-direction: column; }
  .task-app .tk-side { width: 100%; max-height: 40vh; margin: 0 0 12px; }
}
@container (max-width: 700px) {
  .task-app .cel-task .tk-check,
  .task-app .cel-bar .tk-check { display: none; }
  .cel-date { flex-wrap: wrap; }
  /* 农历换行到日期数字下方（节气/节日已隐藏，无需再参与 flex） */
  .cel-lunar { flex: 0 0 100%; }
  /* 隐藏节气与节日信息（农历保留） */
  .cel-lunar-tag { display: none; }
  /* 任务标题保持单行，但不显示省略号（直接裁切） */
  .cel-task-sum { white-space: nowrap; overflow: hidden; text-overflow: clip; }
  /* 取消每个日期格右上角的添加任务按钮 */
  .tk-add { display: none; }
  /* 日期格内边距收紧；头部因农历换行加高，横跨条层同步下移 */
  .cel { padding: 0 4px 4px; }
  .cel-top { height: 44px; }
  .tk-mbars { padding-top: 44px; }
}
@container (max-width: 480px) {
  .cel { min-height: 74px; }
  /* 任务不显示时间信息（padding 沿用 700 块的 4px，避免小屏反而更松） */
  .cel-task-time { display: none; }
}
</style>
