<template>
  <transition name="tk-side">
    <aside v-if="open" class="tk-side" :class="{ 'side-anim': animating, 'drop-active': dropActive }"
           @dragover.prevent="onPanelDragOver" @dragleave="onPanelDragLeave" @drop.prevent="onDropToPool">
      <div class="tk-side-h">
        <i class="la la-inbox tk-pool-ic"></i>
        <span>{{ $t('app.todoPool') }}</span>
        <span class="cnt">{{ totalCount }}</span>
      </div>
      <div class="tk-side-sub">{{ $t('app.todoPoolSource') }}</div>

      <div class="tk-side-body">
        <div v-if="!hasAny" class="tk-side-empty">{{ $t('app.noTodos') }}</div>

        <!-- 独立事项：无日期、未归入任何清单（来自收件箱文件）；标题可折叠，右侧「?」悬停显示来源说明 -->
        <section v-if="poolTasks.length" class="tk-side-sec">
          <div class="tk-side-sec-h" @click="toggleCollapse('__standalone')">
            <i class="la la-chevron-right tk-sec-caret" :class="{ open: !isCollapsed('__standalone') }"></i>
            <i class="la la-sticky-note tk-sec-ic"></i>
            <span class="tk-side-sec-title">{{ $t('app.standalone') }}</span>
            <span class="cnt">{{ poolTasks.length }}</span>
          </div>
          <div v-show="!isCollapsed('__standalone')" class="tk-side-list">
            <div v-for="t in poolTasks" :key="t.guid" class="tk-side-item"
                 :class="{ dragging: dragGuid === t.guid }"
                 :title="dragHint(t)" draggable="true"
                 @dragstart="$emit('drag-start', t, $event)"
                 @dragend="$emit('drag-end')"
                 @click="$emit('open-task', t, $event)">
              <i class="tk-check" :class="[{ done: t.completed }, statusIcon(t)]" ></i>
              <span class="tk-side-sum" v-html="richSummary(t)" @click="$emit('rich-click', $event)"></span>
            </div>
          </div>
        </section>

        <!-- 清单文件：按文件名成块（含待办数量，可折叠），文件内再按 ### 标题分组（含每组数量，可折叠） -->
        <section v-for="f in clFiles" :key="f.key" class="tk-side-sec">
          <div class="tk-side-sec-h" @click="toggleCollapse(f.key)">
            <i class="la la-chevron-right tk-sec-caret" :class="{ open: !isCollapsed(f.key) }"></i>
            <i class="la la-file-text-o tk-file-ic"></i>
            <span class="tk-side-sec-title">{{ f.name }}</span>
            <span class="cnt">{{ f.total }}</span>
          </div>
          <div v-show="!isCollapsed(f.key)">
            <div v-for="g in f.groups" :key="g.id" class="tk-side-group">
              <div class="tk-side-g-h" @click="toggleCollapse(gk(f, g))">
                <i class="la la-chevron-right tk-sec-caret" :class="{ open: !isCollapsed(gk(f, g)) }"></i>
                <span>{{ g.title || $t('app.ungrouped') }}</span>
                <span class="cnt">{{ g.tasks.length }}</span>
              </div>
              <div v-show="!isCollapsed(gk(f, g))" class="tk-side-list">
                <div v-for="t in g.tasks" :key="t.guid" class="tk-side-item"
                     :class="{ dragging: dragGuid === t.guid }"
                     :title="dragHint(t)" draggable="true"
                     @dragstart="$emit('drag-start', t, $event)"
                     @dragend="$emit('drag-end')"
                     @click="$emit('open-task', t, $event)">
                  <i class="tk-check" :class="[{ done: t.completed }, statusIcon(t)]" ></i>
                  <span class="tk-side-sum" v-html="richSummary(t)" @click="$emit('rich-click', $event)"></span>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </aside>
  </transition>
</template>

<script>
// 待办侧栏（周/日视图与月视图共用）：待办池。
// 仅展示【无日期】待办（含清单），去掉了原来的「所有待办（含日期）」分页：
//   - 「独立事项」：来自收件箱文件、未归入任何清单的无日期待办；标题右侧「?」悬停显示来源说明；
//   - 清单文件：每个清单按文件名成块（含待办数量），文件内再按 ### 标题分组（含每组数量）。
// 每一类（独立事项 / 清单文件 / 分组）标题可点击折叠；折叠状态仅本次视图存活（切换视图会重置）。
// 任务池与清单列表由父级经 props 下发；勾选 / 打开 / 拖拽等交互经事件交还父级。
import { statusIcon, renderInlineHtml, plainInline } from '../composables/tasks-logic.js';
import { Tasks } from '../composables/useTasks.js';

export default {
  name: 'TodoSidePanel',
  props: {
    // 是否展开（父级 todoPanelOpen 控制整块面板的开合）
    open: { type: Boolean, default: false },
    // 全部任务池（父级 load 后下发；不含清单内无日期任务）
    tasks: { type: Array, default: () => [] },
    // 清单列表（用于读取各清单内的无日期任务）
    checklists: { type: Array, default: () => [] },
    // 正在拖拽的任务 guid（高亮用）
    dragGuid: { type: String, default: '' },
    // 正在拖拽的任务对象（落点清日期用）
    dragTask: { type: Object, default: null }
  },
  emits: ['toggle', 'open-task', 'drag-start', 'drag-end', 'rich-click', 'saved', 'error'],
  // 注册进宿主的侧栏注册表：任务落盘后宿主经 refreshIfVisible 广播刷新缓存。
  // 本组件实例分布在 WeekDayView / TaskMonthView 内，父级 $refs 直达不可靠，故走 provide/inject。
  // plugin 由根 vueApp provide，用于读取收件箱文件路径（独立事项来源说明）。
  inject: ['registerTodoPanel', 'unregisterTodoPanel', 'plugin'],
  data() {
    return {
      // 各清单文件：{ key, name, total, groups:[{ id, title, tasks }] }（仅含无日期待办）
      clFiles: [],
      clLoaded: false,            // 清单无日期任务是否已加载（仅首次懒加载）
      // 入场动画标记（一次性，700ms 后摘掉）
      animating: false,
      // 折叠的类别 key 列表（独立事项 '__standalone'、清单文件 f.key、分组 f.key::g.id）
      collapsedKeys: [],
      // 拖拽悬停于待办池（放置即清除日期）时的高亮标记
      dropActive: false
    };
  },
  computed: {
    // 独立事项：任务池内无日期、未完成且未取消的项（即收件箱文件中的待办）
    poolTasks() {
      return this.tasks.filter((t) => !t.dueAt && !t.completed && !t.cancelled);
    },
    // 是否还有任何待办（控制空态显隐）
    hasAny() {
      return this.poolTasks.length > 0 || this.clFiles.length > 0;
    },
    // 待办池总计数（独立事项 + 各清单文件之和）
    totalCount() {
      const cl = this.clFiles.reduce((s, f) => s + f.total, 0);
      return this.poolTasks.length + cl;
    },
    // 收件箱文件路径（用于「独立事项」来源说明）
    inboxPath() {
      const p = this.plugin && this.plugin.settings && this.plugin.settings.inboxFile;
      return p || 'DadaTodoList.md';
    }
  },
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
        this.loadClNoDate();
      }
    }
  },
  beforeUnmount() {
    clearTimeout(this._animTimer);
    if (this.unregisterTodoPanel) this.unregisterTodoPanel(this);
  },
  methods: {
    // 某类别是否折叠
    isCollapsed(key) { return this.collapsedKeys.indexOf(key) !== -1; },
    // 切换某类别折叠状态
    toggleCollapse(key) {
      const i = this.collapsedKeys.indexOf(key);
      if (i === -1) this.collapsedKeys.push(key);
      else this.collapsedKeys.splice(i, 1);
    },
    // 分组稳定 key（文件 key + 分组 id）
    gk(f, g) { return f.key + '::' + g.id; },
    byDue(a, b) { return (a.dueAt || Infinity) - (b.dueAt || Infinity); },
    // 首次懒加载清单无日期任务（按清单文件 → ### 标题 分组，仅保留无日期待办）
    loadClNoDate() {
      if (this.clLoaded) return;
      this.clLoaded = true;
      this.readClNoDate();
    },
    // 重新读取清单无日期任务（任务改期 / 完成后调用，刷新缓存避免滞留）
    async refreshClNoDate() { await this.readClNoDate(); },
    // 面板可见或已加载过缓存时刷新（供宿主在任务落盘后广播调用）
    refreshIfVisible() {
      if (this.open) this.refreshClNoDate();
      else if (this.clLoaded) this.refreshClNoDate();
    },
    async readClNoDate() {
      try {
        const lists = this.checklists.length ? this.checklists : await Tasks.loadChecklists();
        const files = [];
        for (const c of lists) {
          const r = await Tasks.loadChecklistGroups(c.key);
          const groups = (r.groups || [])
            .map((g) => ({
              id: g.title || '__ungrouped',
              title: g.title,
              tasks: g.tasks.filter((t) => !t.dueAt && !t.completed && !t.cancelled)
            }))
            .filter((g) => g.tasks.length);
          const total = groups.reduce((s, g) => s + g.tasks.length, 0);
          if (total) files.push({ key: c.key, name: r.name || c.name, total, groups });
        }
        this.clFiles = files;
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
    // 拖拽悬停待办池：标记高亮并允许放置
    onPanelDragOver(e) {
      this.dropActive = true;
      if (e && e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    },
    // 离开待办池（且不是进入其子元素）时取消高亮
    onPanelDragLeave(e) {
      if (!e || !e.currentTarget || !e.relatedTarget || !e.currentTarget.contains(e.relatedTarget)) {
        this.dropActive = false;
      }
    },
    // 把任务拖回待办池：清除其日期（dueAt/dueAllDay/dueEndAt），使其回到无日期池
    async onDropToPool() {
      const t = this.dragTask;
      this.dropActive = false;
      this.$emit('drag-end');
      if (!t) return;
      try {
        await Tasks.updateTask(t.guid, {
          summary: t.summary, description: t.description,
          dueAt: null, dueAllDay: false, dueEndAt: null
        });
        this.$emit('saved');
      } catch (err) {
        this.$emit('error', this.$t('app.clearDateFail') + (err && err.message || err));
      }
    }
  }
};
</script>
