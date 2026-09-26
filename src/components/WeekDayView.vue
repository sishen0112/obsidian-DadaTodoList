<template>
  <div class="tk-tlview">
    <div class="tk-tl-wrap">
      <!-- 左侧待办列表：默认隐藏，展开后可拖到日历改期（与月视图共用 TodoSidePanel） -->
      <todo-side-panel :open="todoPanelOpen" :tasks="tasks" :checklists="checklists"
                       :drag-guid="dragGuid"
                       @toggle="(t) => $emit('toggle', t)"
                       @open-task="(t, e) => $emit('open-task', t, e)"
                       @drag-start="(t, e) => $emit('drag-start', t, e)"
                       @drag-end="$emit('drag-end')"
                       @rich-click="richClick" />

      <task-timeline
        :cols="tlCols"
        :today-key="todayKey"
        :hour-h="hourH"
        :now-top="nowTop"
        :drag-over-key="dragOverKey"
        :drag-guid="dragGuid"
        :helpers="tlHelpers"
        :handlers="tlHandlers"
        :is-week="view === 'four'" />
    </div>
  </div>
</template>

<script>
// 周 / 日视图容器（自 TasksApp.vue 抽离）：
//   - 持有时间轴的排布与像素换算（hourH / fourCols / dayCol / layoutBlocks / yForMin…）
//   - 持有「当前时间线」刷新定时器与窗口宽度监听（驱动 hourH）
//   - 持有时间轴上的拖拽落盘（列放置 / 凌晨放置 / 全天放置 / 手柄调时）
// 交互（打开编辑器 / 勾选 / 拖拽起点 / 落盘后刷新）经事件交还父级；
// 视图偏移（tlWeekOffset / tlDayOffset）由父级持有（顶栏导航按钮共用）。
import TaskTimeline from './TaskTimeline.vue';
import TodoSidePanel from './TodoSidePanel.vue';
import { Tasks } from '../composables/useTasks.js';
import {
  colorOf, itemColor, lunarDayText, lunarTagText, holidayOf,
  statusIcon, timeText, richSummaryNoTags, plainInline, weekdayShort
} from '../composables/tasks-logic.js';

const pad = (n) => (n < 10 ? '0' + n : '' + n);
function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

export default {
  name: 'WeekDayView',
  components: { TaskTimeline, TodoSidePanel },
  props: {
    // 'four'（周）| 'day'（日）
    view: { type: String, required: true },
    // 本周基准（周一），父级经顶栏导航偏移
    weekStart: { type: Date, required: true },
    weekOffset: { type: Number, default: 0 },
    dayOffset: { type: Number, default: 0 },
    tasks: { type: Array, default: () => [] },
    // 按天预分组的任务池（父级 computed，周/月共享）
    tasksByDay: { type: Object, default: () => ({}) },
    todayKey: { type: String, default: '' },
    hideDone: { type: Boolean, default: false },
    // 拖拽共享状态（与月视图/待办侧栏共用，父级持有）
    dragGuid: { type: String, default: '' },
    dragOverKey: { type: String, default: '' },
    dragTask: { type: Object, default: null },
    checklists: { type: Array, default: () => [] },
    todoPanelOpen: { type: Boolean, default: false }
  },
  emits: ['toggle', 'open-task', 'open-new', 'open-new-at', 'drag-start', 'drag-end', 'drag-over', 'saved', 'error'],
  data() {
    return {
      // 窗口宽度（响应式：决定时间轴每小时像素高 hourH）
      winW: (typeof window !== 'undefined' ? window.innerWidth : 1280),
      now: Date.now(),
      // 时间轴列内拖拽悬停的纵向像素位置（用于预览横线）
      dropY: -1
    };
  },
  inject: ['plugin'],
  computed: {
    // 是否显示农历 / 节假日（设置开关，默认开；plugin 由 main.js provide）
    showLunar() {
      const st = this.plugin && this.plugin.settings;
      return !st || st.showLunar !== false;
    },
    // 时间轴每小时像素高：窗口宽度 >700 → 48，否则（≤700）→ 60
    hourH() { return this.winW > 700 ? 48 : 60; },
    // 当前时间线：仅当「现在」落在时间轴区间（07:00–24:00）内才显示，跨度像素用 yForMin 对齐刻度
    nowTop() {
      const d = new Date(this.now);
      const min = d.getHours() * 60 + d.getMinutes();
      if (min < 7 * 60 || min >= 24 * 60) return null;
      return this.yForMin(min);
    },
    // 本周时间轴基准日期（周一 ~ 周日，跟随 weekOffset 偏移）
    fourDayKeys() {
      const base = new Date();
      base.setHours(0, 0, 0, 0);
      const start = Tasks.startOfWeek(new Date(base.getFullYear(), base.getMonth(), base.getDate() + this.weekOffset * 7));
      return Tasks.weekDays(start).map((d) => ymd(d));
    },
    // 本周时间轴：周一 ~ 周日 各取一列（全天 / 定时分开）
    fourCols() {
      const keys = this.fourDayKeys;
      return keys.map((key) => this.buildCol(key, key === this.todayKey));
    },
    // 日视图当前显示的日期（跟随 dayOffset 偏移）
    dayKey() {
      const d = new Date(this.todayKey + 'T00:00:00');
      d.setDate(d.getDate() + this.dayOffset);
      return ymd(d);
    },
    // 时间轴列：周视图取 fourCols（7 天），日视图只取当天一列
    tlCols() {
      return this.view === 'day' ? [this.dayCol] : this.fourCols;
    },
    // 日视图：仅当天一列（全天 / 凌晨 / 定时分开，与周视图列结构一致）
    dayCol() {
      return this.buildCol(this.dayKey, this.dayOffset === 0);
    },
    // 传给时间轴子组件的纯渲染辅助（箭头函数锁定 this，避免方法作为 prop 时丢失上下文）
    tlHelpers() {
      const s = this;
      return {
        holidayOf: (d) => (s.showLunar ? holidayOf(d) : null),
        lunarDayText: (d) => (s.showLunar ? lunarDayText(d) : ''),
        lunarTagText: (d) => (s.showLunar ? lunarTagText(d) : ''),
        itemColor: (t) => itemColor(t),
        blockStyle: (b) => s.blockStyle(b),
        statusIcon: (t) => statusIcon(t),
        richSummaryNoTags: (t) => richSummaryNoTags(t),
        timeText: (t) => timeText(t),
        dragHint: (t) => s.dragHint(t),
        dropInfo: (key) => s.dropInfo(key),
        richClick: (e) => s.richClick(e)
      };
    },
    // 传给时间轴子组件的交互回调（添加 / 打开 / 勾选 / 拖拽改期）
    tlHandlers() {
      const s = this;
      return {
        add: (key) => s.$emit('open-new', key),
        open: (t, e) => s.$emit('open-task', t, e),
        toggle: (t) => s.$emit('toggle', t),
        dragStart: (t, e) => s.$emit('drag-start', t, e),
        dragEnd: () => s.$emit('drag-end'),
        dragOver: (key, e) => s.handleDragOver(key, e),
        dropAllDay: (key) => s.onDropAllDay(key),
        dropEarly: (key) => s.onDropEarly(key),
        dropTimeline: (key, e) => s.onDropTimeline(key, e),
        // 手柄拖动调时间：resize 实时改本地（触发重排），resizeCommit 落盘
        resize: (t, startMin, endMin) => s.resizeTaskLive(t, startMin, endMin),
        resizeCommit: (t) => s.resizeTaskCommit(t),
        // 双击时间轴空白处：在落点时刻新增任务
        addAt: (key, min) => s.$emit('open-new-at', key, min)
      };
    }
  },
  created() {
    // 当前时间线：每分钟刷新一次位置
    this._nowTimer = setInterval(() => { this.now = Date.now(); }, 60000);
  },
  mounted() {
    this.winW = window.innerWidth;
    window.addEventListener('resize', this.onWinResize);
  },
  beforeUnmount() {
    window.removeEventListener('resize', this.onWinResize);
    if (this._nowTimer) clearInterval(this._nowTimer);
  },
  methods: {
    // 窗口尺寸变化：更新 winW，驱动 hourH（时间轴格子高度）响应式变化
    onWinResize() { this.winW = window.innerWidth; },
    // 构建「一天一列」结构（周视图 7 列 / 日视图 1 列共用）：全天 / 凌晨 / 定时分开
    buildCol(key, isToday) {
      const d = new Date(key + 'T00:00:00');
      const tasks = this.visibleTasks(this.tasksByDay[key] || []);
      return {
        key,
        date: d,
        label: isToday ? this.$t('app.todayBadge') : '',
        weekday: weekdayShort(d),
        md: (d.getMonth() + 1) + '/' + d.getDate(),
        tasks,
        allDay: tasks.filter((t) => t.dueAllDay),
        early: tasks.filter((t) => !t.dueAllDay && this.isEarly(t)),
        blocks: this.layoutBlocks(tasks.filter((t) => !t.dueAllDay && !this.isEarly(t)))
      };
    },
    // 周/月视图统一入口：开启「仅显示待办」时过滤掉已完成与已取消任务
    visibleTasks(list) {
      return this.hideDone ? list.filter((t) => !t.completed && !t.cancelled) : list;
    },
    // 定时任务 → 时间轴泳道排布（同一时段并排，避免相互遮挡）
    // 块高由时间跨度决定：有结束时间(dueEndAt)的时间段任务按真实跨度，
    // 单时间任务仍按固定时长 DEFAULT_MIN 绘制。
    layoutBlocks(list) {
      const hourH = this.hourH;
      const DEFAULT_MIN = 60;
      const items = list.map((t) => {
        const d = new Date(t.dueAt);
        const start = d.getHours() * 60 + d.getMinutes();
        let end = start + DEFAULT_MIN;
        if (t.dueEndAt) {
          const de = new Date(t.dueEndAt);
          const endMin = de.getHours() * 60 + de.getMinutes();
          // 跨天（结束时刻 ≤ 开始时刻，如 23:00–00:30）按 +24h 处理
          end = endMin <= start ? endMin + 24 * 60 : endMin;
        }
        return { t, start, end };
      }).sort((a, b) => a.start - b.start || a.end - b.end);
      // 贪心分列：放入第一个「末尾已结束」的泳道
      const lanes = [];
      for (const it of items) {
        let li = -1;
        for (let i = 0; i < lanes.length; i++) {
          if (lanes[i][lanes[i].length - 1].end <= it.start) { li = i; break; }
        }
        if (li < 0) { li = lanes.length; lanes.push([]); }
        it.lane = li;
        lanes[li].push(it);
      }
      // 按连通簇计算宽度：簇内并排数 = 该簇泳道数
      const out = [];
      let cluster = [];
      let clusterMaxEnd = -1;
      const flush = () => {
        if (!cluster.length) return;
        const cols = Math.max(...cluster.map((x) => x.lane)) + 1;
        for (const it of cluster) {
          out.push({
            t: it.t,
            top: this.yForMin(it.start),
            h: Math.max(20, this.yForMin(it.end) - this.yForMin(it.start) - 1),
            left: (it.lane / cols) * 100,
            width: 100 / cols
          });
        }
        cluster = [];
        clusterMaxEnd = -1;
      };
      for (const it of items) {
        if (cluster.length && it.start >= clusterMaxEnd) flush();
        cluster.push(it);
        clusterMaxEnd = Math.max(clusterMaxEnd, it.end);
      }
      flush();
      return out;
    },
    blockStyle(b) {
      const c = colorOf(b.t);
      return {
        top: b.top + 'px',
        height: b.h + 'px',
        left: 'calc(' + b.left + '% + 2px)',
        width: 'calc(' + b.width + '% - 4px)',
        background: c.bg,
        color: 'var(--ink)'
      };
    },
    // 任务是否落在 00:00–07:00（此区间不在时间轴显示，改为列表）
    isEarly(t) {
      if (!t.dueAt || t.dueAllDay) return false;
      const d = new Date(t.dueAt);
      return d.getHours() * 60 + d.getMinutes() < 7 * 60;
    },
    // 时间(分钟) → 像素：时间轴从 07:00 起，07:00 对应 0，24:00 对应 17×h
    yForMin(min) {
      const h = this.hourH;
      const e = 7 * 60; // 07:00
      if (min <= e) return 0;                          // 00:00–07:00 不在时间轴（列表显示）
      if (min >= 24 * 60) return 17 * h;
      return ((min - e) / 60) * h;                     // 07:00 之后
    },
    // 像素 → 分钟（yForMin 的逆映射）：时间轴从 07:00 起
    minForY(y) {
      const h = this.hourH;
      const e = 7 * 60;
      if (y <= 0) return e;                     // 07:00 起点
      if (y >= 17 * h) return 23 * 60;
      return e + (y / h) * 60;                  // 07:00–24:00
    },
    // 时间轴拖拽预览：当前悬停列、吸附到整点/半点的落点位置与时刻
    // 时间段任务预览同时显示结束时刻（保持与原时长一致）
    dropInfo(key) {
      if (!this.dragTask || this.dragOverKey !== key || this.dropY < 0) return null;
      let min = this.minForY(this.dropY);
      min = Math.max(0, Math.min(23 * 60, Math.round(min / 30) * 30)); // 整点 / 半点
      const hh = Math.floor(min / 60), mm = min % 60;
      const dur = this.dragDuration();
      let endMin = min + dur;
      if (endMin > 23 * 60 + 59) endMin = 23 * 60 + 59; // 不超出当天，必要时收缩时长
      const eh = Math.floor(endMin / 60), em = endMin % 60;
      const label = dur > 0 ? pad(hh) + ':' + pad(mm) + '–' + pad(eh) + ':' + pad(em) : pad(hh) + ':' + pad(mm);
      return { top: this.yForMin(min), label };
    },
    // 当前拖拽任务的时长（分钟）：时间段任务取 结束−开始，单时间/全天为 0
    // 注意：放置时 drag-end 会清空父级 dragTask，故支持传入具体的任务对象
    dragDuration(t) {
      t = t || this.dragTask;
      if (!t || !t.dueEndAt || t.dueAllDay) return 0;
      return Math.max(0, Math.round((new Date(t.dueEndAt).getTime() - new Date(t.dueAt).getTime()) / 60000));
    },
    // 时间轴列内拖拽悬停：通知父级记录目标列，本地记录纵向落点（画预览横线）
    handleDragOver(key, e) {
      if (!this.dragTask) return;
      this.$emit('drag-over', key);
      if (e && e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      if (e && e.currentTarget) {
        const rect = e.currentTarget.getBoundingClientRect();
        this.dropY = e.clientY - rect.top;
      }
    },
    // 时间轴列放置：同时按落点更新日期与时间
    // 时间段任务：保持原时长，开始与结束一起平移（结束超出当天 24:00 则收缩到 23:59）
    async onDropTimeline(dayKey, e) {
      const t = this.dragTask;
      this.$emit('drag-end');
      if (!t) return;
      let y = 0;
      if (e && e.currentTarget) {
        const rect = e.currentTarget.getBoundingClientRect();
        y = e.clientY - rect.top;
      }
      let min = this.minForY(y);
      min = Math.max(0, Math.min(23 * 60, Math.round(min / 30) * 30)); // 吸附到整点 / 半点
      const hh = Math.floor(min / 60), mm = min % 60;
      const dueAt = new Date(dayKey + 'T' + pad(hh) + ':' + pad(mm) + ':00').getTime();
      const payload = { summary: t.summary, description: t.description, dueAt, dueAllDay: false };
      const dur = this.dragDuration(t);
      if (dur > 0) {
        let endMin = min + dur;
        if (endMin > 23 * 60 + 59) endMin = 23 * 60 + 59; // 收缩结束，避免跨天丢失
        const eh = Math.floor(endMin / 60), em = endMin % 60;
        payload.dueEndAt = new Date(dayKey + 'T' + pad(eh) + ':' + pad(em) + ':00').getTime();
      }
      try {
        await Tasks.updateTask(t.guid, payload);
        this.$emit('saved');
      } catch (err) {
        this.$emit('error', this.$t('app.rescheduleFail') + (err && err.message || err));
      }
    },
    // 手柄拖动调时间（实时）：直接改本地任务 dueAt / dueEndAt，触发时间轴重排
    resizeTaskLive(t, startMin, endMin) {
      const date = ymd(new Date(t.dueAt));
      t.dueAt = new Date(date + 'T' + pad(Math.floor(startMin / 60)) + ':' + pad(startMin % 60) + ':00').getTime();
      t.dueEndAt = (endMin == null)
        ? null
        : new Date(date + 'T' + pad(Math.floor(endMin / 60)) + ':' + pad(endMin % 60) + ':00').getTime();
    },
    // 手柄拖动结束：把调整后的开始 / 结束时间落盘
    async resizeTaskCommit(t) {
      try {
        await Tasks.updateTask(t.guid, {
          summary: t.summary,
          description: t.description,
          dueAt: t.dueAt,
          dueEndAt: t.dueEndAt
        });
        this.$emit('saved');
      } catch (err) {
        this.$emit('error', this.$t('app.resizeFail') + (err && err.message || err));
      }
    },
    // 凌晨列表放置：落入 00:00–07:00 区间，默认置 06:00
    async onDropEarly(dayKey) {
      const t = this.dragTask;
      this.$emit('drag-end');
      if (!t) return;
      if (t.dueAt && ymd(new Date(t.dueAt)) === dayKey && this.isEarly(t)) return; // 原地放下
      const dueAt = new Date(dayKey + 'T06:00:00').getTime();
      try {
        await Tasks.updateTask(t.guid, {
          summary: t.summary,
          description: t.description,
          dueAt,
          dueAllDay: false
        });
        this.$emit('saved');
      } catch (err) {
        this.$emit('error', this.$t('app.rescheduleFail') + (err && err.message || err));
      }
    },
    // 拖到「全天」格子：无论原是否定时，都转为该日全天任务
    async onDropAllDay(dayKey) {
      const t = this.dragTask;
      this.$emit('drag-end');
      if (!t) return;
      const dueAt = new Date(dayKey + 'T00:00:00').getTime();
      try {
        await Tasks.updateTask(t.guid, {
          summary: t.summary,
          description: t.description,
          dueAt,
          dueAllDay: true
        });
        this.$emit('saved');
      } catch (err) {
        this.$emit('error', this.$t('app.rescheduleFail') + (err && err.message || err));
      }
    },
    // 拖拽提示：纯标题 +「可拖动改期」说明
    dragHint(t) {
      return this.$t('app.dragHintFull', { title: plainInline(t.summary) });
    },
    // v-html 内的链接点击：阻止冒泡，避免同时触发所在行的「打开编辑器」
    richClick(e) {
      if (e.target && e.target.tagName === 'A') e.stopPropagation();
    }
  }
};
</script>

<style scoped>
/* 周/日视图容器（自 TasksApp.vue 迁入）：时间轴 + 待办侧栏 并排 */
.tk-tlview { flex: 1 1 auto; min-height: 0; overflow: hidden; }
.tk-tl-wrap { display: flex; align-items: flex-start; height: 100%; overflow: hidden; }
</style>
