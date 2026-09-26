<template>
  <transition name="tk-side">
    <aside v-if="open" class="tk-side" :class="{ 'side-anim': animating }">
      <div class="tk-side-h">
        <div class="tk-btn-group tk-side-seg">
          <button class="tk-btn" type="button" :class="{ on: mode === 'nodate' }" @click="setMode('nodate')">{{ $t('app.noDate') }}<span class="cnt">{{ noDateCount }}</span></button>
          <button class="tk-btn" type="button" :class="{ on: mode === 'all' }" @click="setMode('all')">{{ $t('app.allTasks') }}<span class="cnt">{{ allCount }}</span></button>
        </div>
      </div>
      <div class="tk-side-list">
        <div v-if="!panelTasks.length" class="tk-side-empty">{{ $t('app.noTodos') }}</div>
        <div v-for="t in panelTasks" :key="t.guid" class="tk-side-item"
             :class="{ dragging: dragGuid === t.guid }"
             :title="dragHint(t)" draggable="true"
             @dragstart="$emit('drag-start', t, $event)"
             @dragend="$emit('drag-end')"
             @click="$emit('open-task', t, $event)">
          <i class="tk-check" :class="[{ done: t.completed }, statusIcon(t)]" @click.stop.prevent="$emit('toggle', t)"></i>
          <span class="tk-side-date">{{ dateText(t) }}</span>
          <span class="tk-side-sum" v-html="richSummary(t)" @click="$emit('rich-click', $event)"></span>
        </div>
      </div>
      <div class="tk-side-tip"><i class="la la-hand-pointer-o"></i> {{ $t('app.dragHint') }}</div>
    </aside>
  </transition>
</template>

<script>
// 待办侧栏（周/日视图与月视图共用）：无日期 / 所有待办 两个分页 + 可拖拽改期。
// 之前这份模板在 TasksApp 与 TaskMonthView 各复制一份、状态散在父级，现统一收拢到此组件：
//   - 组件自持 mode / 清单无日期任务缓存 / 入场动画；
//   - 任务池与清单列表由父级经 props 下发；勾选 / 打开 / 拖拽等交互经事件交还父级。
import { statusIcon, dateText, renderInlineHtml, plainInline } from '../composables/tasks-logic.js';
import { Tasks } from '../composables/useTasks.js';

export default {
  name: 'TodoSidePanel',
  props: {
    // 是否展开（v-model:open）
    open: { type: Boolean, default: false },
    // 全部任务池（父级 load 后下发）
    tasks: { type: Array, default: () => [] },
    // 清单列表（用于读取各清单内的无日期任务）
    checklists: { type: Array, default: () => [] },
    // 正在拖拽的任务 guid（高亮用）
    dragGuid: { type: String, default: '' }
  },
  emits: ['toggle', 'open-task', 'drag-start', 'drag-end', 'rich-click'],
  data() {
    return {
      // 侧栏顶部切换：'nodate'（无日期，默认选中）/ 'all'（所有待办，含日期）
      mode: 'nodate',
      // 清单内无日期任务（默认聚合不汇入全部任务，需单独加载）
      clNoDateTasks: [],
      clNoDateLoaded: false,
      // 入场动画标记（一次性，700ms 后摘掉）
      animating: false
    };
  },
  computed: {
    // 未完成且未取消任务，按日期升序（无日期排在最后）
    pendingTasks() {
      return this.tasks.filter((t) => !t.completed && !t.cancelled).slice().sort(this.byDue);
    },
    // 侧栏实际展示的任务：随顶部切换变化
    panelTasks() {
      if (this.mode === 'all') return this.pendingTasks;
      // 无日期：全部任务池内的无日期项 + 清单内的无日期项
      const pool = this.tasks.filter((t) => !t.dueAt && !t.completed && !t.cancelled);
      return pool.concat(this.clNoDateTasks);
    },
    // 选项卡各自的统计数字
    noDateCount() {
      const pool = this.tasks.filter((t) => !t.dueAt && !t.completed && !t.cancelled);
      return pool.length + this.clNoDateTasks.length;
    },
    allCount() { return this.pendingTasks.length; }
  },
  // 注册进宿主的侧栏注册表：任务落盘后宿主经 maybeRefreshNoDate 广播刷新缓存。
  // 本组件实例分布在 WeekDayView / TaskMonthView 内，父级 $refs 直达不可靠，故走 provide/inject。
  inject: ['registerTodoPanel', 'unregisterTodoPanel'],
  mounted() {
    if (this.registerTodoPanel) this.registerTodoPanel(this);
  },
  watch: {
    // 面板展开时播放入场动画，并懒加载清单无日期任务。
    // immediate：视图切换（周↔日经 :key 重建、月视图换容器）会重挂载本组件，
    // 若挂载时面板已处于展开状态，open 不会发生变化，必须在初始时也触发一次加载，
    // 否则重挂载后无日期列表为空
    open: {
      immediate: true,
      handler(open) {
        clearTimeout(this._animTimer);
        if (!open) { this.animating = false; return; }
        this.animating = true;
        this._animTimer = setTimeout(() => { this.animating = false; }, 700);
        if (this.mode === 'nodate') this.loadClNoDate();
      }
    }
  },
  beforeUnmount() {
    clearTimeout(this._animTimer);
    if (this.unregisterTodoPanel) this.unregisterTodoPanel(this);
  },
  methods: {
    byDue(a, b) { return (a.dueAt || Infinity) - (b.dueAt || Infinity); },
    // 切换顶部模式（无日期 / 所有待办）；切到无日期时懒加载清单无日期任务
    setMode(mode) {
      this.mode = mode;
      if (mode === 'nodate') this.loadClNoDate();
    },
    // 加载全部清单中的无日期任务（仅首次懒加载）
    async loadClNoDate() {
      if (this.clNoDateLoaded) return;
      this.clNoDateLoaded = true;
      await this.readClNoDate();
    },
    // 重新读取清单无日期任务（任务改期 / 完成后调用，刷新缓存避免滞留）
    async refreshClNoDate() { await this.readClNoDate(); },
    // 面板可见且处于「无日期」模式时刷新（供宿主在任务落盘后广播调用）；
    // 关闭中若已加载过缓存也静默刷新，避免下次展开看到滞留旧数据
    refreshIfVisible() {
      if (this.open && this.mode === 'nodate') this.refreshClNoDate();
      else if (this.clNoDateLoaded) this.refreshClNoDate();
    },
    async readClNoDate() {
      try {
        const lists = this.checklists.length ? this.checklists : await Tasks.loadChecklists();
        const all = [];
        for (const c of lists) {
          const items = await Tasks.loadByList(c.key);
          for (const t of items) {
            if (!t.dueAt && !t.completed && !t.cancelled) all.push(t);
          }
        }
        this.clNoDateTasks = all;
      } catch (e) { /* 加载失败不影响其余功能 */ }
    },
    // 拖拽提示：纯标题 +「可拖动改期」说明
    dragHint(t) {
      return this.$t('app.dragHintFull', { title: plainInline(t.summary) });
    },
    // 标题渲染：把 [文本](链接) 与 #标签 解析为可点击链接 / 样式化标签
    richSummary(t) {
      return renderInlineHtml(t && t.summary);
    },
    statusIcon(t) { return statusIcon(t); },
    dateText(t) { return dateText(t); }
  }
};
</script>
