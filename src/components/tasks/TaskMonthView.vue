<template>
  <div class="tk-monthview">
    <div class="tk-month-wrap">
      <!-- 左侧待办列表：默认隐藏，展开后可拖到日历改期（与周/日视图共用 TodoSidePanel） -->
      <todo-side-panel :open="ctx.todoPanelOpen" :tasks="ctx.tasks" :checklists="ctx.checklists"
                       :drag-guid="ctx.dragGuid" @toggle="ctx.toggle" @open-task="ctx.onTaskClick"
                       @drag-start="ctx.onDragStart" @drag-end="ctx.onDragEnd" @rich-click="ctx.onRichClick" />

      <div class="tk-month-card">
      <div class="tk-month-weekdays">
        <span v-for="w in ctx.weekdayLabels" :key="w" class="tk-month-wd">{{ w }}</span>
      </div>
      <div class="tk-month-grid">
        <div v-for="c in monthCells" :key="c.day" class="cel"
             :class="{ other: c.other, today: c.today, 'drop-target': ctx.dragOverKey === c.day }"
             @dragover.prevent="ctx.onDragOver(c.day, $event)"
             @drop.prevent="ctx.onDrop(c.day)">
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
            <button class="cel-add" type="button" :title="$t('app.addDayTask')" @click.stop="ctx.openNew(c.day)"><i class="la la-plus-circle"></i></button>
          </div>
          <div class="cel-tasks">
            <div v-for="t in ctx.tasksOf(c.day)" :key="t.guid" class="cel-task"
                 :class="{ done: t.completed || t.cancelled, dragging: ctx.dragGuid === t.guid }"
                 :style="ctx.itemColor(t)"
                 :title="ctx.dragHint(t)" draggable="true"
                 @dragstart="ctx.onDragStart(t, $event)"
                 @dragend="ctx.onDragEnd"
                 @click.stop="ctx.onTaskClick(t, $event)">
              <i class="tk-check" :class="[{ done: t.completed || t.cancelled }, ctx.statusIcon(t)]" @click.stop.prevent="ctx.toggle(t)"></i>
              <span class="cel-task-sum" v-html="ctx.richSummary(t)" @click="ctx.onRichClick"></span>
              <span v-if="ctx.taskTime(t)" class="cel-task-time">{{ ctx.taskTime(t) }}</span>
            </div>
          </div>
        </div>
      </div>
      </div>
    </div>
  </div>
</template>

<script>
// 月视图：日历网格 + 左侧「待办」拖拽面板（面板与周视图共用，样式在 tasks-shared.css）。
// 只读父级共享状态/方法（通过 ctx），自身只持有月网格计算。
import TodoSidePanel from '../TodoSidePanel.vue';

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
  computed: {
    // 当前显示月份（YYYY-MM），用于统计与筛选
    monthCells() {
      const ctx = this.ctx;
      const base = new Date(ctx.currentMonth.getFullYear(), ctx.currentMonth.getMonth(), 1);
      const year = base.getFullYear(), month = base.getMonth() + 1;
      const dim = new Date(year, month, 0).getDate();
      const startOffset = (base.getDay() + 6) % 7; // 周一为首列
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
    }
  }
};
</script>

<!-- 非 scoped：月视图类名 tk- 前缀限定，随 tasks-shared.css 一并全局可用 -->
<style>
/* ===== 月视图 ===== */
.tk-monthview { flex: 1 1 auto; min-height: 0; overflow: hidden; container-type: inline-size; }
.tk-month-wrap { display: flex; align-items: flex-start; height: 100%; overflow: hidden; }
.tk-month-card { flex: 1 1 auto; min-width: 0; min-height: 0; align-self: stretch; overflow-y: auto; }
/* 星期头部与日期网格统一：细边框连续风格，1px 间隙透出边框色，整体 10px 圆角 */
.tk-month-weekdays { position: sticky; top: 0; z-index: 2; display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 1px; margin-bottom: 0; background: var(--line); }
.tk-month-wd { text-align: center; font-size: 12px; font-weight: 600; color: var(--ink-soft); letter-spacing: 1px; background: var(--panel); padding: 6px 0; }
.tk-month-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 1px; background: var(--line); }
.cel {
  min-width: 0; min-height: 106px; padding: 7px 8px 8px; display: flex; flex-direction: column;
  background: var(--panel); border: none; border-radius: 0;
  transition: box-shadow .15s ease;
}
.cel.other { opacity: .45; }
.cel:hover { box-shadow: var(--shadow); }
.cel.today { box-shadow: inset 0 0 0 1px var(--gold); }
/* 拖拽悬停的日期格 */
.cel.drop-target { background: var(--gold-bg); box-shadow: inset 0 0 0 2px var(--gold); }
.cel-top { display: flex; align-items: center; justify-content: space-between; gap: 4px; }
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
.cel-add {
  opacity: 0; flex: none; width: auto; height: auto; border: none; border-radius: 0;
  background: transparent; color: var(--gold); font-size: 16px; line-height: 1; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  transition: opacity .15s ease, color .15s ease;
  box-shadow: none;
}
.cel-add i { font-size: 16px; line-height: 1; }
.cel:hover .cel-add { opacity: 1; }
.cel-add:hover { filter: brightness(1.1); }
.cel-tasks { min-width: 0; margin-top: 5px; display: flex; flex-direction: column; gap: 3px; overflow-y: auto; }
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
  .task-app .cel-task .tk-check { display: none; }
  .cel-date { flex-wrap: wrap; }
  /* 农历换行到日期数字下方（节气/节日已隐藏，无需再参与 flex） */
  .cel-lunar { flex: 0 0 100%; }
  /* 隐藏节气与节日信息（农历保留） */
  .cel-lunar-tag { display: none; }
  /* 任务标题保持单行，但不显示省略号（直接裁切） */
  .cel-task-sum { white-space: nowrap; overflow: hidden; text-overflow: clip; }
  /* 取消每个日期格右上角的添加任务按钮 */
  .cel-add { display: none; }
  /* 日期格内边距收紧为 4px */
  .cel { padding: 4px; }
}
@container (max-width: 480px) {
  .cel { min-height: 74px; }
  /* 任务不显示时间信息（padding 沿用 700 块的 4px，避免小屏反而更松） */
  .cel-task-time { display: none; }
}
</style>
