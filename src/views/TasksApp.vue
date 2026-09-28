<template>
  <div class="task-app">
    <div v-if="error" class="tk-err">{{ error }}</div>
    <!-- 核心「日记」插件未启用：有日期任务无法读写（顶部常驻提醒，不可手动关闭；开启日记插件后自动消失） -->
    <div v-if="!canUseDaily()" class="tk-onboard tk-warn">
      <div class="tk-onboard-d">{{ $t('app.onboardDailyDisabled') }}</div>
    </div>
    <!-- 首次使用引导：任务池为空且未关闭过时显示（日记不可用时由上方提醒条负责） -->
    <div v-if="showOnboard() && canUseDaily()" class="tk-onboard">
      <div class="tk-onboard-t">{{ $t('app.onboardTitle') }}</div>
      <div class="tk-onboard-d">{{ $t('app.onboardDesc') }}</div>
      <div class="tk-onboard-a">
        <button class="tk-btn" type="button" @click="openSettings">{{ $t('app.onboardOpenSettings') }}</button>
        <button class="tk-btn" type="button" @click="dismissOnboard">{{ $t('app.onboardDismiss') }}</button>
      </div>
    </div>

    <!-- 顶部：各视图控件（左）+ 视图切换（右），抽离为 TaskTopBar 组件 -->
    <task-top-bar :view="view" :range-label="rangeLabel" :todo-panel-open="todoPanelOpen"
                  :hide-done="hideDone" :cl-main-view="clMainView"
                  @navigate="onNav" @switch-view="switchView"
                  @toggle-todo-panel="todoPanelOpen = !todoPanelOpen"
                  @toggle-hide-done="toggleHideDone" @set-cl-main-view="setClMainView"
                  @back-to-today="scrollAgendaToToday" />

    <div class="tk-body">
      <transition name="tk-view" mode="out-in" appear>
      <div v-if="loading" key="loading" class="tk-loading">{{ $t('app.loading') }}</div>

      <!-- ===== 周 / 日视图（独立组件，含待办侧栏与时间轴） ===== -->
      <week-day-view v-else-if="view === 'four' || view === 'day'" :key="view"
                     :view="view" :week-start="weekStart" :week-offset="tlWeekOffset" :day-offset="tlDayOffset"
                     :tasks="tasks" :tasks-by-day="tasksByDay" :today-key="todayKey" :hide-done="hideDone"
                     :drag-guid="dragGuid" :drag-over-key="dragOverKey" :drag-task="dragTask"
                     :checklists="checklists" :todo-panel-open="todoPanelOpen"
                     @toggle="toggle" @open-task="onTaskClick" @open-new="openNew" @open-new-at="openNewAt"
                     @drag-start="onDragStart" @drag-end="onDragEnd" @drag-over="onDragOver"
                     @saved="onSaved" @error="setError" />

      <!-- ===== 月视图（独立组件） ===== -->
      <task-month-view v-else-if="view === 'month'" key="month" :ctx="this" :plugin="plugin" />

      <!-- ===== 日程视图（独立组件） + 左侧日期导航 ===== -->
      <div v-else-if="view === 'agenda'" key="agenda" class="tk-agenda-layout">
        <aside class="tk-ag-nav">
          <div class="tk-ag-nav-hd">
            <span class="tk-ag-nav-m">{{ agendaNavTitle }}</span>
          </div>
          <div class="tk-ag-nav-list">
            <button v-for="it in agendaNavList" :key="it.key" type="button"
                    class="tk-ag-nav-item" :class="{ active: it.key === agendaActiveKey, today: it.isToday, far: it.far }"
                    @click="agendaNavSelect(it.key)">
              <span class="tk-ag-nav-txt"><span class="tk-ag-nav-year">{{ it.year }}</span>{{ it.md }}<span class="tk-ag-nav-wd"> {{ it.weekday }}</span></span>
              <span v-if="it.count > 0" class="tk-ag-nav-c">{{ it.count }}</span>
              <i v-else class="la la-angle-right tk-ag-nav-go"></i>
            </button>
          </div>
        </aside>
        <task-agenda-view :ctx="this" :plugin="plugin" />
      </div>

      <!-- ===== 清单视图（左侧清单列表 + 右侧按 ### 标题分组） ===== -->
      <div v-else-if="view === 'cl'" key="cl" class="tk-clview-wrap">
        <checklist-view :plugin="plugin" :checklists="checklists" :hide-done="hideDone" :main-view="clMainView" />
      </div>

      <!-- ===== 列表视图（独立组件） ===== -->
      <task-list-view v-else key="list" :ctx="this" :plugin="plugin" />
      </transition>
    </div>

    <!-- 编辑器与完成日历改用 Obsidian 原生 Modal 外壳（Vue-in-Modal 桥），不再内嵌页面 -->
  </div>
</template>

<script>
import { getCurrentInstance } from 'vue';
import { Tasks } from '../composables/useTasks.js';
import { isExternalChange } from '../api/tasks.js';
import {
  renderInlineHtml, plainInline,
  dateText, timeText, statusIcon, plainTitle, richSummaryNoTags, doneDay,
  colorOf, itemColor, lunarDayText, lunarTagText, holidayOf, weekdayLong
} from '../composables/tasks-logic.js';
import { hasDailyNotesConfig } from '../api/tasks.js';
import TaskEditorModal from '../components/TaskEditorModal.vue';
import TaskTopBar from '../components/TaskTopBar.vue';
import WeekDayView from '../components/WeekDayView.vue';
import TaskRow from '../components/tasks/TaskRow.vue';
import { openTaskInFile } from '../utils/openTaskInFile.js';
import ChecklistCardGrid from '../components/tasks/ChecklistCardGrid.vue';
import ChecklistView from '../components/tasks/ChecklistView.vue';
import TaskMonthView from '../components/tasks/TaskMonthView.vue';
import TaskAgendaView from '../components/tasks/TaskAgendaView.vue';
import TaskListView from '../components/tasks/TaskListView.vue';
import { getTaskViewPref, setTaskViewPref, getClMainViewPref, setClMainViewPref } from '../composables/viewPrefs.js';
import { useListState } from '../composables/useListState.js';
import { VueModal } from '../ui/VueModal.js';

const pad = (n) => (n < 10 ? '0' + n : '' + n);
function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

export default {
  name: 'TasksApp',
  components: {
    TaskRow, ChecklistCardGrid, ChecklistView,
    TaskMonthView, TaskAgendaView, TaskListView, TaskTopBar, WeekDayView
  },
  setup() {
    // 列表视图状态域（筛选 / 清单 / 分桶 / 顺延）抽离至 useListState；
    // setup 阶段 data 尚未初始化，故经实例代理做惰性取值（渲染期才真正读取）
    const self = getCurrentInstance().proxy;
    return useListState({
      tasks: () => self.tasks,
      checklists: () => self.checklists,
      view: () => self.view,
      plugin: () => self.plugin,
      setError: (v) => { self.error = v; },
      reloadTasks: () => self.load(true),
      persistTaskView: () => self.persistTaskView(),
      listViewInit: getTaskViewPref().listView
    });
  },
  data() {
    const tv = getTaskViewPref();
    return {
      loading: false,
      error: '',
      tasks: [],
      view: tv.view,
      weekStart: Tasks.startOfWeek(new Date()),
      tlWeekOffset: 0,
      tlDayOffset: 0,
      todayKey: ymd(new Date()),
      currentMonth: new Date(),
      // 拖拽改期（周/月视图，跨视图共享）
      dragGuid: '',
      dragOverKey: '',
      dragTask: null,
      // 待办侧栏（周/日/月视图共用，状态在 TodoSidePanel 内）
      todoPanelOpen: false,
      // 首次使用引导（用户点「知道了」后不再显示，localStorage 记忆）
      onboardDismissed: false,
      // 日记插件是否「未启用」（响应式；由轮询 refreshDailyState 更新，供横幅实时显示/隐藏并触发任务重载）
      dailyDisabled: !hasDailyNotesConfig(),
      // 周/月视图：隐藏已办（界面记忆，存 localStorage）
      hideDone: tv.hideDone,
      // 日程视图：已延期 / 更远 默认折叠
      agendaCollapsed: { overdue: true, far: true },
      // 日程视图：左侧日期导航（未来7天 + 更远）选中日期
      agendaActiveKey: ymd(new Date()),
      // 清单（frontmatter tags 命中识别标记的 md 文件）
      checklists: [],
      // 清单主区视图（列表 / 分栏）：与顶栏切换按钮联动，持久化到 localStorage
      clMainView: getClMainViewPref()
    };
  },
  computed: {
    // 顶栏区间文案：随当前视图取对应标签（周区间 / 日日期 / 月份 / 日程区间）
    rangeLabel() {
      if (this.view === 'four') return this.tlRange;
      if (this.view === 'day') return this.dayLabel;
      if (this.view === 'month') return this.monthLabel;
      if (this.view === 'agenda') return this.agendaRange;
      return '';
    },
    // 本周时间轴基准日期（周一 ~ 周日，跟随 tlWeekOffset 偏移）
    fourDayKeys() {
      const start = Tasks.startOfWeek(new Date());
      start.setDate(start.getDate() + this.tlWeekOffset * 7);
      return Tasks.weekDays(start).map((d) => ymd(d));
    },
    // 时间轴当前周范围文字（如 09/14 – 09/20）
    tlRange() {
      const k = this.fourDayKeys;
      if (!k.length) return '';
      return k[0].slice(5) + ' – ' + k[k.length - 1].slice(5);
    },
    // 日视图当前显示的日期（todayKey 跟随 tlDayOffset 偏移）
    dayKey() {
      const d = new Date(this.todayKey + 'T00:00:00');
      d.setDate(d.getDate() + this.tlDayOffset);
      return ymd(d);
    },
    // 日视图顶栏日期文案：今天为「今日 9/17 周四」，其它天为「9/17 周四」
    dayLabel() {
      const d = new Date(this.dayKey + 'T00:00:00');
      const base = (d.getMonth() + 1) + '/' + d.getDate() + ' ' + weekdayLong(d);
      return (this.tlDayOffset === 0 ? this.$t('app.todayBadge') + ' ' : '') + base;
    },
    // 按天预分组：避免周/月视图每次渲染都对全量任务逐格过滤（上千任务 × 42 格）
    tasksByDay() {
      const rank = (t) => (t.cancelled ? 2 : t.completed ? 1 : 0); // 未完成→已完成→已取消
      const map = {};
      for (const t of this.tasks) {
        if (!t.dueAt) continue;
        const k = ymd(new Date(t.dueAt));
        if (!map[k]) map[k] = [];
        map[k].push(t);
      }
      for (const k of Object.keys(map)) {
        map[k].sort((a, b) => rank(a) - rank(b) || (a.dueAt || 0) - (b.dueAt || 0));
      }
      return map;
    },
    // 今日零点（本地时区）
    today0Ms() {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    },

    // 日程视图顶部区间文字（今天 ~ 今天+6）
    agendaRange() {
      const day = 86400000;
      const today0 = this.today0Ms;
      return ymd(new Date(today0)).slice(5) + ' – ' + ymd(new Date(today0 + 6 * day)).slice(5);
    },
    // 日程日期导航：按到期日统计每天任务数（受「仅显示待办」影响），供迷你日历打点
    dueCountMap() {
      const m = new Map();
      const list = this.hideDone ? this.tasks.filter((t) => !t.completed && !t.cancelled) : this.tasks;
      for (const t of list) {
        if (!t.dueAt) continue;
        const k = ymd(new Date(t.dueAt));
        m.set(k, (m.get(k) || 0) + 1);
      }
      return m;
    },
    // 日程视图「更远」分组的截止日（今天+6）ymd
    agendaHorizonKey() {
      const day = 86400000;
      return ymd(new Date(this.today0Ms + 6 * day));
    },
    agendaNavTitle() {
      return this.$t('app.next7');
    },
    // 左侧日期导航：未来 7 天（今天~今天+6）逐日 + 一个「更远」聚合项
    agendaNavList() {
      const day = 86400000;
      const today0 = this.today0Ms;
      const counts = this.dueCountMap;
      const list = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(today0 + i * day);
        const key = ymd(d);
        list.push({
          key,
          year: this.$t('app.navYear', { y: d.getFullYear() }),
          md: this.$t('app.navMonthDay', { m: d.getMonth() + 1, d: d.getDate() }),
          weekday: i === 0 ? this.$t('app.todayBadge') : weekdayLong(d),
          count: counts.get(key) || 0,
          isToday: i === 0,
          far: false
        });
      }
      // 更远：统计所有超过今天+6 的有到期日任务数
      let far = 0;
      for (const [k, c] of counts) if (k > this.agendaHorizonKey) far += c;
      list.push({ key: 'far', year: '', md: this.$t('app.far'), weekday: '', count: far, isToday: false, far: true });
      return list;
    },
    monthLabel() {
      const d = this.currentMonth;
      return this.$t('app.monthLabel', { y: d.getFullYear(), m: d.getMonth() + 1 });
    },
    // 当前显示月份（YYYY-MM），用于统计与筛选
    monthKey() {
      const d = this.currentMonth;
      return d.getFullYear() + '-' + pad(d.getMonth() + 1);
    },
    // 月视图表头周几（随界面语言，周一起始）
    weekdayLabels() { return this.$t('app.weekdaysShort', { returnObjects: true }); }
  },
  provide() {
    return {
      // 待办侧栏注册表：任务落盘后父级可刷新所有已挂载面板的无日期缓存
      // （侧栏实例分布在 WeekDayView 与 TaskMonthView 内，$refs 直达不可靠）
      registerTodoPanel: (c) => { this._todoPanels.add(c); },
      unregisterTodoPanel: (c) => { this._todoPanels.delete(c); }
    };
  },
  created() {
    this._todoPanels = new Set();
    try { this.onboardDismissed = localStorage.getItem('dada:onboardDismissed') === '1'; } catch (e) { /* 忽略 */ }
    this.load();
    // 跨零点检测：每 30 秒对比系统日期，翻日时刷新「今天」锚点（todayKey / weekStart），
    // 避免「挂机过夜后点『今天』仍回到昨天」的问题
    this._dayTimer = setInterval(() => this.refreshTodayAnchor(), 30000);
    // 日记插件启用状态实时检测：每 2 秒轮询，开关日记插件后顶部提醒条即时出现/消失，
    // 且翻转时触发任务重载（关→开 加载有日期任务；开→关 剔除不可用的有日期任务）
    this.refreshDailyState();
    this._dailyTimer = setInterval(() => this.refreshDailyState(), 2000);
    // 外部变更自动刷新：编辑器内改笔记 / 同步写入 / 其他插件改动 → 防抖 500ms 静默重载。
    // 插件自身写操作（api 层 noteSelfWrite 标记）引起的变更会在 1.2s 内被跳过，避免重复加载。
    const mc = this.plugin.app.metadataCache;
    const v = this.plugin.app.vault;
    this._extHandlers = [
      [mc, 'changed', this.onExternalChange],
      [v, 'modify', this.onExternalChange],
      [v, 'delete', this.onExternalChange],
      [v, 'rename', this.onExternalChange]
    ];
    for (const [emitter, evt, fn] of this._extHandlers) emitter.on(evt, fn);
  },
  beforeUnmount() {
    for (const [emitter, evt, fn] of this._extHandlers || []) emitter.off(evt, fn);
    clearTimeout(this._extTimer);
    clearInterval(this._dayTimer);
    clearInterval(this._dailyTimer);
  },
  methods: {
    // ---------- 弹窗（Obsidian 原生 Modal 外壳 + Vue 组件内容） ----------
    openEditor(task, defaultDate, defaultTime) {
      new VueModal(this.plugin.app, TaskEditorModal, {
        open: true,
        task,
        defaultDate,
        defaultTime,
        plugin: this.plugin,
        onSaved: () => this.onSaved(),
        onDeleted: (guid) => this.onDeleted(guid),
        onSubtasksChanged: () => this.reload()
      }).open();
    },
    // 双击时间轴空白格：以落点时刻作为开始时间新建任务
    openNewAt(dayKey, min) {
      const hh = pad(Math.floor(min / 60)), mm = pad(min % 60);
      this.openEditor(null, dayKey, hh + ':' + mm);
    },
    async load(silent) {
      if (!silent) this.loading = true;
      this.error = '';
      try {
        const [tasks, cls] = await Promise.all([Tasks.loadAll(), Tasks.loadChecklists()]);
        this.tasks = tasks;
        this.checklists = cls;
      }
      catch (e) { this.error = this.$t('app.loadTasksFail') + (e && e.message || e); }
      finally { if (!silent) this.loading = false; }
    },
    // ---------- 首次使用引导 ----------
    // 任务池为空且未关闭过时显示
    showOnboard() { return !this.loading && !this.tasks.length && !this.onboardDismissed; },
    // 打开设置并定位到本插件设置页
    openSettings() {
      try {
        this.plugin.app.setting.open();
        this.plugin.app.setting.openTabById(this.plugin.manifest.id);
      } catch (e) { /* 忽略 */ }
    },
    dismissOnboard() {
      this.onboardDismissed = true;
      try { localStorage.setItem('dada:onboardDismissed', '1'); } catch (e) { /* 忽略 */ }
    },
    // 核心「日记」插件是否可用（读取响应式 dailyDisabled；不可用时任务池必然不含日期任务）
    canUseDaily() { return !this.dailyDisabled; },
    // 实时检测日记插件启用状态（每 2 秒轮询）：开关日记插件后顶部提醒条即时出现/消失，
    // 并在启用状态翻转时重载任务池（关→开 加载有日期任务；开→关 剔除不可用的有日期任务）
    refreshDailyState() {
      const enabled = hasDailyNotesConfig();
      const nowDisabled = !enabled;
      if (nowDisabled !== this.dailyDisabled) {
        this.dailyDisabled = nowDisabled;
        this.reload().catch(() => { /* 重载失败不阻断（错误已由 load 写入 this.error） */ });
      }
    },
    // 外部变更 → 防抖 500ms 静默重载（自身写操作 1.2s 内跳过）
    onExternalChange() {
      if (!isExternalChange()) return;
      clearTimeout(this._extTimer);
      this._extTimer = setTimeout(() => {
        this.reload();
        this.maybeRefreshNoDate();
      }, 500);
    },
    // 侧栏处于「无日期」模式时，刷新无日期清单列表（通知所有已挂载的 TodoSidePanel）
    maybeRefreshNoDate() {
      for (const p of this._todoPanels) p.refreshIfVisible();
    },
    // 列表筛选 / 清单选择 / 顺延等方法已抽离至 useListState（setup 展开绑定，仍以 this.xxx 访问）
    // 本地模式下 guid 与正文行号绑定：新增/删除/移动会改变行号，需重载并尽量保留当前选中项
    async reload() {
      const guid = this.selectedGuid;
      await this.load(true);
      if (this.activeList) await this.loadChecklistTasks();
      const pool = this.activeList ? this.checklistTasks : this.tasks;
      // 按 guid 重定位：改标题/标签不增删行，行号不变，guid 稳定
      // （避免标题修改后选中被清空，面板看起来像没保存）
      const again = guid ? pool.find((t) => t.guid === guid) : null;
      this.selectedGuid = again ? again.guid : '';
    },
    switchView(v) { this.view = v; if (v === 'day') this.tlDayOffset = 0; this.persistTaskView(); },
    // 顶栏导航（prev / this / next）：按当前视图分发到 周 / 日 / 月 的偏移
    onNav(dir) {
      if (this.view === 'four') { if (dir === 'prev') this.prevWeek(); else if (dir === 'next') this.nextWeek(); else this.thisWeek(); }
      else if (this.view === 'day') { if (dir === 'prev') this.prevDay(); else if (dir === 'next') this.nextDay(); else this.thisDay(); }
      else if (this.view === 'month') { if (dir === 'prev') this.prevMonth(); else if (dir === 'next') this.nextMonth(); else this.thisMonth(); }
    },
    prevMonth() { const d = this.currentMonth; this.currentMonth = new Date(d.getFullYear(), d.getMonth() - 1, 1); },
    nextMonth() { const d = this.currentMonth; this.currentMonth = new Date(d.getFullYear(), d.getMonth() + 1, 1); },
    thisMonth() { this.currentMonth = new Date(); },
    prevWeek() { this.tlWeekOffset -= 1; },
    nextWeek() { this.tlWeekOffset += 1; },
    thisWeek() { this.refreshTodayAnchor(); this.tlWeekOffset = 0; },
    prevDay() { this.tlDayOffset -= 1; },
    nextDay() { this.tlDayOffset += 1; },
    thisDay() { this.refreshTodayAnchor(); this.tlDayOffset = 0; },
    // 「今天」锚点刷新：定时器每 30s 调用一次，点「今天」时兜底再调一次。
    // 跨零点后刷新 todayKey / weekStart，使日/周视图与「今日」高亮落到新的一天
    refreshTodayAnchor() {
      const tk = ymd(new Date());
      if (tk !== this.todayKey) {
        this.todayKey = tk;
        this.weekStart = Tasks.startOfWeek(new Date());
      }
    },
    // 时间轴块配色 / 农历 / 节假日：纯函数在 tasks-logic（周视图组件与月视图 ctx 共用），此处仅作委托
    colorOf(t) { return colorOf(t); },
    itemColor(t) { return itemColor(t); },
    // 日程视图：左侧时间点 / 右侧卡片，沿用时间轴的莫兰迪配色
    agendaCard(t) { const c = this.colorOf(t); return { background: c.bg, '--ag-bar': c.fg }; },
    // 日程视图：已延期 / 更远 分组折叠切换
    toggleAgendaGroup(kind) { this.agendaCollapsed[kind] = !this.agendaCollapsed[kind]; },
    // 日程视图：回到今天——将「今日」分组滚动到可视区域顶部
    scrollAgendaToToday() {
      this.refreshTodayAnchor();
      this.agendaActiveKey = this.todayKey;
      this.scrollAgendaToDate(this.todayKey);
    },
    // 左侧日期导航：跳转到某日期在日程中的位置
    // 今天~今天+6 的天有独立分组(data-key=ymd)；更早归入「已延期」；更晚归入「更远」
    scrollAgendaToDate(key) {
      const root = this.$el && this.$el.querySelector && this.$el.querySelector('.tk-agendaview');
      if (!root) return;
      let targetKey = key;
      if (key < this.todayKey) targetKey = 'overdue';
      else if (key > this.agendaHorizonKey) targetKey = 'far';
      const sec = root.querySelector('.tk-ag[data-key="' + targetKey + '"]');
      if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
      else root.scrollTo({ top: 0, behavior: 'smooth' });
    },
    agendaNavSelect(key) {
      this.agendaActiveKey = key;
      this.scrollAgendaToDate(key);
    },
    // 日程视图每行左侧文案：当天只显示时刻，已延期/更远显示「月/日 时刻」
    agendaWhen(task, kind) {
      if (!task.dueAt) return '';
      const d = new Date(task.dueAt);
      let hm = task.dueAllDay ? '' : pad(d.getHours()) + ':' + pad(d.getMinutes());
      if (!task.dueAllDay && task.dueEndAt) {
        const e = new Date(task.dueEndAt);
        hm += '-' + pad(e.getHours()) + ':' + pad(e.getMinutes());
      }
      if (kind === 'day') return task.dueAllDay ? this.$t('app.allDay') : hm;
      const md = (d.getMonth() + 1) + '/' + d.getDate();
      return task.dueAllDay ? md : md + ' ' + hm;
    },
    // 列表中的日期：非本年时在日期前补上年份，避免跨年混淆
    dateText(t) { return dateText(t); },
    timeText(t) { return timeText(t); },
    // 卡片视图：完成日期（YYYY-MM-DD）
    doneDay(t) { return doneDay(t); },
    // 按到期时间升序（无日期排最后）；日程视图 ctx.byDue 使用
    byDue(a, b) {
      const av = a.dueAt ? a.dueAt : Infinity;
      const bv = b.dueAt ? b.dueAt : Infinity;
      return av - bv;
    },
    openNew(dayKey) {
      this.openEditor(null, dayKey || '');
    },
    /* ---------- 列表视图写回：子组件通过 ctx 调用（prop 只读，不可直接赋值） ---------- */
    setError(v) { this.error = v; },
    // 把当前任务视图偏好写到本机 localStorage（不再写 data.json，避免反复触发云盘同步）
    persistTaskView() {
      setTaskViewPref({ view: this.view, listView: this.listView, hideDone: this.hideDone });
    },
    toggleHideDone() { this.hideDone = !this.hideDone; this.persistTaskView(); },
    // 清单主区视图切换（列表 / 分栏）；状态提升到父组件，持久化在父组件
    setClMainView(v) { this.clMainView = v; setClMainViewPref(v); },
    async openEdit(t) {
      let full = t;
      try { full = await Tasks.getDetail(t.guid); } catch (e) { /* keep summary view */ }
      this.openEditor(full, '');
    },
    // Ctrl/Cmd + 点击任务项：直接跳转到任务所在笔记并高亮（不打开编辑器）
    async openTask(t) {
      await openTaskInFile(this.plugin, t);
    },
    // 任务项点击（含修饰键判断）：Ctrl/Cmd 直接跳转高亮，否则打开编辑器
    onTaskClick(t, e) {
      if (e && (e.metaKey || e.ctrlKey)) this.openTask(t);
      else this.openEdit(t);
    },
    syncSubCount(t, items) {
      t.subtaskCount = items.length; // Vue3：直接赋值
      // 增删子任务会改变正文行号，静默重载以刷新其余任务的 guid
      this.reload();
    },
    /* ---------- 拖拽改期：拖到某天的列即把该任务改为那天的任务 ---------- */
    dragHint(t) {
      return this.$t('app.dragHintFull', { title: plainInline(t.summary) });
    },
    // 标题渲染：把 [文本](链接) 与 #标签 解析为可点击链接 / 样式化标签
    richSummary(t) {
      return renderInlineHtml(t && t.summary);
    },
    // 列表视图：标签单独成行，正文里不再重复渲染标签
    richSummaryNoTags(t) { return richSummaryNoTags(t); },
    // 纯标题（不含链接与标签的 Markdown），用于详情面板
    plainTitle(t) { return plainTitle(t); },
    // v-html 内的链接点击：阻止冒泡，避免同时触发所在行的「打开编辑器」
    onRichClick(e) {
      if (e.target && e.target.tagName === 'A') e.stopPropagation();
    },
    onDragStart(t, e) {
      this.dragGuid = t.guid;
      this.dragTask = t;
      if (e && e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        // Firefox 必须写入数据才会启动拖拽
        try { e.dataTransfer.setData('text/plain', t.guid); } catch (err) { /* 忽略 */ }
      }
    },
    // 拖拽悬停：仅记录目标日期 key（月视图列高亮；时间轴内的预览横线在 WeekDayView 内部处理）
    onDragOver(key) {
      if (!this.dragTask) return;
      this.dragOverKey = key;
    },
    onDragEnd() {
      this.dragGuid = '';
      this.dragOverKey = '';
      this.dragTask = null;
    },
    // 月视图 / 日程视图的日期格放置：拖入某天即改期到那天
    async onDrop(dayKey) {
      const t = this.dragTask;
      this.onDragEnd();
      if (!t) return;
      if (t.dueAt && ymd(new Date(t.dueAt)) === dayKey) return; // 原地放下
      // 无日期任务（来自左侧待办列表）拖入某天 → 默认全天；有日期任务保留原时刻
      const allDay = t.dueAt ? !!t.dueAllDay : true;
      let dueAt;
      if (allDay) {
        dueAt = new Date(dayKey + 'T00:00:00').getTime();
      } else {
        const d = new Date(t.dueAt); // 保留原来的时刻
        dueAt = new Date(dayKey + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':00').getTime();
      }
      const payload = { summary: t.summary, description: t.description, dueAt, dueAllDay: allDay };
      // 时间段任务：保持原时长（结束随开始平移）
      if (!allDay && t.dueEndAt && !t.dueAllDay) {
        const dur = Math.max(0, Math.round((new Date(t.dueEndAt).getTime() - new Date(t.dueAt).getTime()) / 60000));
        let endMin = Math.floor(dueAt / 60000) % (24 * 60) + dur;
        if (endMin > 23 * 60 + 59) endMin = 23 * 60 + 59;
        const eh = Math.floor(endMin / 60), em = endMin % 60;
        payload.dueEndAt = new Date(dayKey + 'T' + pad(eh) + ':' + pad(em) + ':00').getTime();
      }
      try {
        await Tasks.updateTask(t.guid, payload);
        await this.reload();
        this.maybeRefreshNoDate();
      } catch (e) {
        this.error = this.$t('app.rescheduleFail') + (e && e.message || e);
      }
    },
    statusIcon(t) { return statusIcon(t); },
    tasksOf(day) {
      return this.visibleTasks(this.tasksByDay[day] || []);
    },
    // 周/月视图统一入口：开启「仅显示待办」时过滤掉已完成与已取消任务
    visibleTasks(list) {
      return this.hideDone ? list.filter((t) => !t.completed && !t.cancelled) : list;
    },
    taskTime(t) {
      if (!t.dueAt || t.dueAllDay) return '';
      const d = new Date(t.dueAt);
      return pad(d.getHours()) + ':' + pad(d.getMinutes());
    },
    // 农历 / 节假日：纯函数在 tasks-logic（与 WeekDayView 共用），此处仅作 ctx 委托；
    // 受「显示农历与节假日」开关控制（月视图 ctx 路径）
    lunarDayText(date) { return this.plugin.settings.showLunar === false ? '' : lunarDayText(date); },
    lunarTagText(date) { return this.plugin.settings.showLunar === false ? '' : lunarTagText(date); },
    holidayOf(day) { return this.plugin.settings.showLunar === false ? null : holidayOf(day); },
    async onSaved() {
      await this.reload();
      this.maybeRefreshNoDate();
    },
    async onDeleted(guid) {
      if (this.selectedGuid === guid) this.selectedGuid = '';
      await this.reload();
      this.maybeRefreshNoDate();
    },
    async toggle(t) {
      const done = !t.completed;
      try {
        await Tasks.toggleComplete(t.guid, done);
        t.completed = done; t.completedAt = done ? Date.now() : null;
        this.maybeRefreshNoDate();
      } catch (e) { this.error = this.$t('app.opFail') + (e && e.message || e); }
    },
  }
};
</script>

<style scoped>
/* ===== 设计令牌：不再自维护颜色，全部映射到 Obsidian 主题（App.vue 的 .wb-root
   已把 --gold/--panel/--line/--ink 等映射好，这里只补任务模块专属令牌） ===== */
.task-app {
  /* #话题 标签配色：跟随 Obsidian 标签色，回退到强调色 */
  --tag-ink: var(--tag-color, var(--text-accent));
  --tag-ink-strong: var(--tag-color, var(--text-accent));
  --tag-bg: var(--tag-background, var(--background-modifier-hover));
  --radius: 12px;
  --radius-sm: 8px;
  --red: var(--el-color-danger, var(--text-error));
  --jade: var(--el-color-success, var(--text-success));

  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  box-sizing: border-box;
  padding: 10px;
  border-radius: 10px;
  overflow: hidden;
  color: var(--ink);
  background: var(--paper);
}

/* 顶栏样式已抽离至 TaskTopBar.vue */

/* ===== 主体 ===== */
.tk-body { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
.tk-loading { color: var(--ink-soft); padding: 40px; text-align: center; }

/* 视图切换过渡：旧视图先淡出，新视图挂载完再淡入（out-in），
   把新视图重建 DOM 的开销藏在透明度为 0 的瞬间，观感更平顺 */
.tk-view-enter-active, .tk-view-leave-active { transition: opacity .18s ease, transform .18s ease; }
.tk-view-enter-from { opacity: 0; transform: translateY(8px); }
.tk-view-leave-to { opacity: 0; transform: translateY(-6px); }
.tk-err { color: var(--red); background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; margin-bottom: 14px; }
/* 首次使用引导（无任务时显示） */
.tk-onboard { margin-bottom: 14px; padding: 14px 16px; border: 1px dashed var(--gold); border-radius: 10px; background: var(--gold-bg); }
.tk-onboard-t { font-weight: 700; color: var(--ink); margin-bottom: 4px; }
.tk-onboard-d { color: var(--ink-soft); font-size: 13px; line-height: 1.6; margin-bottom: 10px; }
.tk-onboard-a { display: flex; gap: 8px; }
.tk-onboard.tk-warn { border-color: var(--red); background: var(--panel); }



/* ===== 周视图 ===== */
/* 列之间用间距与圆角区分；当日 / hover / 拖拽 样式直接对齐月视图 */
.tk-weekview { flex: 1 1 auto; min-height: 0; overflow-y: auto; }
/* 周视图：时间轴 + 待办侧栏 并排（同月视图 .tk-month-wrap） */
.tk-tl-wrap { display: flex; align-items: flex-start; height: 100%; overflow: hidden; }
.tk-week { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 8px; }
@media (max-width: 880px) { .tk-week { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.tk-day {
  background: var(--panel-2); border: 1px solid transparent; border-radius: 10px;
  min-height: 152px; display: flex; flex-direction: column;
  transition: border-color .15s ease, background .15s ease, box-shadow .15s ease;
}
/* 拖拽悬停的日期列（对齐月视图 .cel.drop-target） */
.tk-day.drop-target { background: var(--gold-bg); border-color: var(--gold); box-shadow: 0 0 0 3px var(--gold-bg); }
/* 普通列 hover（对齐月视图 .cel:hover） */
.tk-day:hover { border-color: var(--gold-soft); box-shadow: var(--shadow); }
/* 当日（对齐月视图 .cel.today） */
.tk-day.today { background: var(--gold-bg); border-color: var(--gold); }
.tk-day-head {
  display: flex; align-items: center; gap: 8px; padding: 9px 11px;
  background: transparent;
}
.tk-day-head .wd { font-weight: 700; font-size: 13px; color: var(--ink); }
.tk-day-head .dt { color: var(--ink-soft); font-size: 11px; margin-left: auto; font-variant-numeric: tabular-nums; }
.tk-add {
  opacity: 0; flex: none; width: 20px; height: 20px; border: none; background: var(--gold); color: var(--text-on-accent);
  border-radius: 50%; cursor: pointer; display: inline-flex; align-items: center; justify-content: center;
  font-size: 10px; line-height: 1; transition: opacity .15s ease, filter .15s ease;
  box-shadow: none;
}
.tk-add i { font-size: 10px; line-height: 1; }
/* 默认隐藏，hover 当日列才显示（与月视图 .cel-add 一致） */
.tk-day:hover .tk-add { opacity: 1; }
.tk-add:hover { filter: brightness(1.1); }
.tk-day-body { padding: 8px; display: flex; flex-direction: column; gap: 4px; flex: 1 1 auto; }
.tk-empty-mini { color: var(--ink-soft); text-align: center; opacity: .45; margin-top: 20px; }
.tk-item-wrap { border-radius: var(--radius-sm); }
/* 周视图任务项：对齐月视图 .cel-task（面板底色 + 边框 + 圆角），已完成置灰 */
.tk-item {
  display: flex; flex-direction: column; gap: 2px; padding: 4px 6px;
  background: var(--panel); border: 1px solid var(--line); border-radius: 6px;
  cursor: grab; font-size: 11.5px;
  transition: border-color .15s ease, background .15s ease, box-shadow .15s ease, opacity .15s ease;
}
.tk-item:hover { border-color: var(--gold-soft); box-shadow: var(--shadow); }
.tk-item.done { color: var(--ink-soft); opacity: .75; }
.tk-item.dragging { opacity: .4; cursor: grabbing; }
.tk-item-top { display: flex; align-items: flex-start; gap: 6px; }
/* 取消共享样式里 tk-check 的 line-height:26px（会使图标下沉，顶对齐时错位） */
.tk-item .tk-check { line-height: normal; }
.tk-item-time { color: var(--text-faint); font-size: 10.5px; padding-left: 24px; font-variant-numeric: tabular-nums; }

/* 周/日视图容器样式（.tk-tlview/.tk-tl-wrap）已迁至 WeekDayView.vue */

/* ===== 月视图 ===== */
.tk-monthview { flex: 1 1 auto; min-height: 0; overflow-y: auto; }
.tk-month-wrap { display: flex; align-items: flex-start; }
.tk-month-card { flex: 1 1 auto; min-width: 0; }

/* 待办面板折叠箭头样式已随顶栏迁至 TaskTopBar.vue */

/* 清单视图外层：在 .tk-body 中铺满；min-width:0 + overflow:hidden 兜底，
   确保水平溢出只在内部 .tk-cl-cols 滚动，不会把整个页面（含左栏）带出去 */
.tk-clview-wrap { flex: 1 1 auto; min-height: 0; min-width: 0; display: flex; overflow: hidden; }

/* ===== 清单视图切换 + 卡片视图（样式参考学习模块章节卡片） ===== */
.tk-title-actions { margin-left: auto; display: inline-flex; align-items: center; gap: 6px; }
.tk-mode-seg { display: inline-flex; gap: 2px; padding: 3px; background: var(--panel-2); border: 1px solid var(--line); border-radius: 9px; }
.tk-mode-seg button {
  display: inline-flex; align-items: center; gap: 5px;
  border: none; background: transparent; color: var(--ink-soft);
  font-family: inherit; font-size: 12px; font-weight: 600;
  padding: 4px 10px; border-radius: 7px; cursor: pointer;
  box-shadow: none;
  transition: background .15s ease, color .15s ease;
}
.tk-mode-seg button:hover { color: var(--ink); }
.tk-mode-seg button.on { background: var(--panel); color: var(--ink); box-shadow: var(--shadow); }
.tk-mode-seg button i { font-size: 11px; }
.tk-done-chip {
  width: 30px; height: 30px; flex: none;
  display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid var(--line); background: var(--panel); color: var(--ink-soft);
  font-size: 15px; border-radius: 9px; cursor: pointer;
  box-shadow: none;
  transition: background .18s ease, color .18s ease, border-color .18s ease;
}
.tk-done-chip:hover { background: var(--gold-bg); color: var(--ink); }
.tk-done-chip.on { background: var(--gold); color: var(--text-on-accent); border-color: transparent; box-shadow: var(--shadow-s); }


.tk-card {
  flex: 1 1 0; min-width: 0; min-height: 0;
  background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius);
  box-shadow: var(--shadow); padding: 10px; display: flex; flex-direction: column;
}
.tk-card-title { font-size: 15px; font-weight: 700; color: var(--ink); margin: 0 0 10px; display: flex; align-items: center; gap: 8px; flex: none; }
.tk-card-title .cnt, .tk-group-h .cnt { font-size: 11px; font-weight: 400; color: var(--ink-soft); background: var(--panel-2); border: 1px solid var(--line); border-radius: 8px; padding: 0 7px; }
.tk-quick {
  flex: none; display: flex; align-items: center; gap: 6px; margin-bottom: 14px;
  background: var(--panel-2); border: 1px solid var(--line); border-radius: 10px; padding: 5px 6px 5px 14px;
  transition: border-color .15s ease, box-shadow .15s ease;
}
.tk-quick:focus-within { border-color: var(--gold); }
.tk-quick-input { flex: 1 1 auto; min-width: 0; box-sizing: border-box; border: none; background: transparent; padding: 6px 0; font: inherit; font-size: 14px; color: var(--ink); box-shadow: none; }
.tk-quick-input:focus { outline: none; box-shadow: none; }
.tk-quick-input::placeholder { color: var(--ink-soft); }
.tk-quick-btn { flex: none; width: 32px; height: 32px; border: none; background: transparent; color: var(--gold); font-size: 18px; line-height: 1; border-radius: 8px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; transition: background .15s ease; box-shadow: none; }
.tk-quick-btn:hover:not(:disabled) { background: var(--gold-bg); }
.tk-quick-btn:disabled { opacity: .4; cursor: default; }
/* 待办分桶：日期分类小标题（比组标题低一级） */
.tk-bucket { margin: 2px 0 8px; }
.tk-bucket-h { display: flex; align-items: center; }
.tk-bucket-toggle {
  display: inline-flex; align-items: center; gap: 6px;
  border: none; background: transparent; font: inherit;
  font-size: 13px; font-weight: 600; color: var(--ink-soft);
  padding: 3px 6px; border-radius: 7px; cursor: pointer;
  text-align: left;
  box-shadow: none;
  transition: background .15s ease, color .15s ease;
}
.tk-bucket-toggle:hover { background: var(--gold-bg); color: var(--ink); }
.tk-bucket-toggle .cnt { font-size: 11px; opacity: .7; font-variant-numeric: tabular-nums; }
.tk-postpone-link {
  margin-left: auto; border: none; background: transparent;
  font: inherit; font-size: 12px; font-weight: 600; color: var(--c-cancel);
  padding: 2px 8px; border-radius: 7px; cursor: pointer;
  box-shadow: none;
  transition: background .15s ease;
}
.tk-postpone-link:hover { background: var(--background-modifier-hover); }
.tk-groups { flex: 1 1 auto; min-height: 0; overflow-y: auto; }
.tk-group { margin-bottom: 12px; }
.tk-group-h { font-size: 12px; font-weight: 700; color: var(--ink-soft); margin: 4px 2px 8px; display: flex; align-items: center; gap: 8px; letter-spacing: .5px; text-align: left; }
/* 「已办」分组标题：可点击展开 / 收起 */
.tk-group-toggle {
  box-sizing: border-box; margin: 0 0 8px; padding: 4px 2px;
  border: none; background: transparent; font: inherit; font-size: 12px;
  font-weight: 700; color: var(--ink-soft); cursor: pointer; text-align: left;
  box-shadow: none;
  transition: color .15s ease;
}
.tk-group-toggle:hover { color: var(--gold); }
.tk-caret { width: 11px; font-size: 11px; transition: transform .18s ease; }
.tk-caret.open { transform: rotate(90deg); }
.tk-group-empty { color: var(--ink-soft); font-size: 12.5px; padding: 8px 4px 14px; opacity: .7; }

/* ===== 日程视图（样式见 TaskAgendaView.vue） ===== */
/* 日程视图整体布局：左侧日期导航 + 右侧议程。
   注意：必须 align-items: stretch 让右侧 .tk-agendaview 被高度约束、自身内部滚动，
   否则整页滚动会顶掉 sticky（顶部栏与左侧导航无法固定）。 */
.tk-agenda-layout { display: flex; align-items: stretch; gap: 22px; flex: 1 1 auto; min-height: 0; container-type: inline-size; }
/* 左侧日期导航：吸顶、列表式。
   flex: 2 1 0 + max-width:300 + min-width:150 ⇒ 与右侧议程按 2:5 占比共享空间，
   面板变窄时本列按比例收窄（而非钉死 300），窄到 220px 触发 @container 隐藏年份/星期 */
.tk-ag-nav { flex: 2 1 0; max-width: 300px; min-width: 150px; container-type: inline-size; position: sticky; top: 8px; align-self: flex-start;
  background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 12px 10px; }
.tk-ag-nav-hd { margin-bottom: 10px; padding: 0 2px; }
.tk-ag-nav-m { font-size: 14px; font-weight: 800; color: var(--ink); }
.tk-ag-nav-list { display: flex; flex-direction: column; gap: 4px; }
/* 每一项：日期（月日）+ 年月/周几 + 任务数（有任务）/ 箭头（无任务） */
.tk-ag-nav-item { display: flex; align-items: center; gap: 8px; width: 100%;
  border: 0; box-shadow: none; background: transparent; border-radius: 9px; cursor: pointer; padding: 13px 12px;
  color: var(--ink); text-align: left; transition: background .15s ease, color .15s ease; }
.tk-ag-nav-item:hover { background: var(--hover, rgba(127,127,127,.1)); }
.tk-ag-nav-txt { flex: 1 1 auto; font-size: 14px; font-weight: 700; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tk-ag-nav-item.today .tk-ag-nav-txt { color: var(--gold); }
.tk-ag-nav-item.far .tk-ag-nav-txt { font-size: 15px; font-weight: 800; }
/* 任务数：柔和浅灰底，避免扎眼 */
.tk-ag-nav-c { flex: none; min-width: 20px; height: 20px; padding: 0 6px; border-radius: 999px;
  background: var(--background-modifier-hover, rgba(127,127,127,.14)); color: var(--ink-soft);
  font-size: 11px; font-weight: 700; line-height: 20px; text-align: center; font-variant-numeric: tabular-nums; }
.tk-ag-nav-go { flex: none; font-size: 12px; color: var(--ink-soft); }
.tk-ag-nav-item.active { background: var(--gold); }
.tk-ag-nav-item.active .tk-ag-nav-txt { color: var(--text-on-accent); }
.tk-ag-nav-item.active .tk-ag-nav-c { background: var(--text-on-accent); color: var(--gold); }
.tk-ag-nav-item.active .tk-ag-nav-go { color: var(--text-on-accent); }
/* 让议程在布局内自然铺满（取消组件内自身居中），并与左侧导航按 5:2 占比共享空间、
   随面板一起收窄（配合 .tk-agendaview 的 @container 在自身变窄时把日期移到列表上方） */
.tk-agenda-layout :deep(.tk-agendaview) { margin: 0; max-width: none; flex: 5 1 0; }
/* 左侧导航自身变窄时：隐藏「年份」与「星期」，只保留「月日」，腾出宽度 */
@container (max-width: 220px) {
  .tk-ag-nav-year, .tk-ag-nav-wd { display: none; }
}
/* 面板过窄（随面板宽度）：隐藏整列左侧日期导航，让议程占满整宽 */
@container (max-width: 480px) {
  .tk-ag-nav { display: none; }
}
@media (max-width: 480px) {
  .tk-agenda-layout { gap: 8px; }
  .tk-ag-nav { display: none; padding: 10px 6px; }
}

/* ===== 入场动画 / 无障碍 ===== */
@keyframes tkRise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
.tk-body { animation: tkRise .45s ease .08s both; }
.tk-add:focus-visible, .cel-add:focus-visible, .tk-quick-btn:focus-visible, .tk-edit:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: 2px;
}
@media (prefers-reduced-motion: reduce) {
  .tk-body { animation: none !important; }
  .tk-day:hover, .cel:hover { box-shadow: var(--shadow) !important; }
  .tk-side, .tk-side-item, .tk-side-caret { animation: none !important; transition: none !important; }
  .tk-view-enter-active, .tk-view-leave-active { transition: none !important; }
}
/* 超窄屏（手机）：仅保留父容器级收紧；月/日程视图的窄屏规则见各自组件；
   顶栏窄屏规则见 TaskTopBar.vue */
@media (max-width: 480px) {
  .tk-week { gap: 6px; }
}
</style>

<!-- 跨组件共享的样式原语（非 scoped，供各任务子组件与父容器共用） -->
<style src="../components/tasks/tasks-shared.css"></style>
