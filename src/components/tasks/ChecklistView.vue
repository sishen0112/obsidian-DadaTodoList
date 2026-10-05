<template>
  <div class="tk-clview">
    <!-- 左侧：清单列表（固定 260px） -->
    <aside class="tk-cl-side">
      <div class="tk-cl-side-h"><i class="la la-tasks"></i><span>{{ $t('app.viewCl') }}</span></div>
      <div v-if="!lists.length" class="tk-cl-side-empty">{{ $t('app.clSideEmpty') }}</div>
      <div v-else class="tk-cl-list">
        <div v-for="c in lists" :key="c.key" class="tk-cl-item">
          <div class="tk-cl-item-main" :class="{ on: c.key === activeKey }"
               role="button" tabindex="0"
               @click="selectList(c.key)"
               @keydown.enter.prevent="selectList(c.key)"
               @keydown.space.prevent="selectList(c.key)">
            <div class="tk-cl-name">{{ c.name }}</div>
            <div class="tk-cl-bar"><i :style="{ width: pct(c) + '%' }"></i></div>
            <div class="tk-cl-meta">{{ $t('app.clProgressPct', { done: c.done, total: c.total, pct: pct(c) }) }}</div>
          </div>
          <button class="tk-cl-open" type="button" :title="$t('app.openChecklistFile')" @click.stop="openFile(c.key)">
            <i class="la la-external-link"></i>
          </button>
        </div>
      </div>
    </aside>

    <!-- 右侧：选中清单的任务（按 ### 标题分组） -->
    <section class="tk-cl-main">
      <div v-if="!activeKey" class="tk-cl-empty-main">{{ $t('app.clPickSide') }}</div>
      <template v-else>
        <header class="tk-cl-main-h">
          <div class="tk-cl-head-l">
            <div class="tk-cl-title">{{ activeName }}</div>
            <div class="tk-cl-prog">{{ $t('app.clProgress', { done: activeDone, total: activeTotal }) }}</div>
          </div>
        </header>

        <div v-if="loading" class="tk-cl-loading">{{ $t('app.loading') }}</div>
        <div v-else-if="error" class="tk-err">{{ error }}</div>
        <template v-else>
          <!-- 列表视图：分组纵向堆叠（默认，保留原样式） -->
          <div v-if="mainView === 'list'" class="tk-cl-body">
            <div v-if="!visibleGroups.length" class="tk-cl-none">{{ $t('app.clEmpty') }}</div>
            <div v-for="g in visibleGroups" :key="gKey(g)" class="tk-cl-group"
                 :class="{ 'tk-cl-drophover': dragOverTitle === g.title }"
                 @dragover.prevent="onDragOver($event, g.title)" @drop="onDrop($event, g.title)">
              <div class="tk-cl-gtitle" :class="{ 'is-plain': !g.title }">
                <template v-if="g.title">
                  <span class="tk-cl-gtxt">{{ g.title }}</span><span class="tk-cl-gcnt">{{ g.tasks.length }}</span>
                </template>
                <span v-else class="tk-cl-gplain">{{ $t('app.ungrouped') }}</span>
                <button class="tk-add cl-gadd" type="button" :title="$t('app.addTaskToGroup')" @click="openAdd(g)">
                  <i class="la la-plus-circle"></i>
                </button>
              </div>
              <transition-group class="tk-cl-rows" tag="div" name="tk-clmove">
                <div v-for="t in g.tasks" :key="t.guid" class="tk-cl-row"
                     :class="{ done: t.completed, cancel: t.cancelled }" :style="{ '--cl-depth': t.indent || 0 }" @click="onTaskClick(t, $event)" :title="$t('app.rowJumpTip')"
                     draggable="true" @dragstart="onDragStart($event, t)" @dragend="onDragEnd"
                     @contextmenu.prevent="onContextMenu(t, $event)">
                  <i class="tk-check" :class="[{ done: t.completed }, statusIcon(t)]"
                     @click.stop.prevent="onToggle(t)"></i>
                  <div class="tk-cl-row-main">
                    <div class="tk-cl-sum" v-html="richSummaryNoTags(t)" @click="onRichClick"></div>
                    <div v-if="t.description" class="tk-cl-desc">{{ firstLine(t.description) }}</div>
                  </div>
                  <span v-if="t.dueAt" class="tk-cl-date"><i class="tk-date-ico la la-calendar"></i>{{ dateText(t) }}<template v-if="timeText(t) && !t.dueAllDay"><i class="tk-date-ico tk-date-ico-sep la la-clock"></i>{{ timeText(t) }}</template></span>
                  <span v-if="t.subtaskCount" class="tk-cl-sub"><i class="la la-list-ul"></i>{{ t.subtaskCount }}</span>
                </div>
                <div v-if="!g.tasks.length" key="__empty" class="tk-cl-gempty">{{ $t('app.noTasks') }}</div>
              </transition-group>
            </div>
          </div>

          <!-- 分栏视图：每个分组一栏，固定宽度，多栏时横向滚动 -->
          <div v-else class="tk-cl-cols">
            <div v-if="!visibleGroups.length" class="tk-cl-none">{{ $t('app.clEmpty') }}</div>
            <div v-for="g in visibleGroups" :key="gKey(g)" class="tk-cl-col"
                 :class="{ 'tk-cl-drophover': dragOverTitle === g.title }"
                 @dragover.prevent="onDragOver($event, g.title)" @drop="onDrop($event, g.title)">
            <div class="tk-cl-gtitle" :class="{ 'is-plain': !g.title }">
              <template v-if="g.title">
                <span class="tk-cl-gtxt">{{ g.title }}</span><span class="tk-cl-gcnt">{{ g.tasks.length }}</span>
              </template>
              <span v-else class="tk-cl-gplain">{{ $t('app.ungrouped') }}</span>
              <button class="tk-add cl-gadd" type="button" :title="$t('app.addTaskToGroup')" @click="openAdd(g)">
                <i class="la la-plus-circle"></i>
              </button>
            </div>
            <transition-group class="tk-cl-rows" tag="div" name="tk-clmove">
              <div v-for="t in g.tasks" :key="t.guid" class="tk-cl-row"
                   :class="{ done: t.completed, cancel: t.cancelled }" :style="{ '--cl-depth': t.indent || 0 }" @click="onTaskClick(t, $event)"
                   :title="$t('app.rowJumpTip')"
                   draggable="true" @dragstart="onDragStart($event, t)" @dragend="onDragEnd"
                   @contextmenu.prevent="onContextMenu(t, $event)">
                <i class="tk-check" :class="[{ done: t.completed }, statusIcon(t)]"
                   @click.stop.prevent="onToggle(t)"></i>
                <div class="tk-cl-row-main">
                  <div class="tk-cl-sum" v-html="richSummaryNoTags(t)" @click="onRichClick"></div>
                  <div v-if="t.description" class="tk-cl-desc">{{ firstLine(t.description) }}</div>
                  <span v-if="t.dueAt" class="tk-cl-date tk-cl-date-sub"><i class="tk-date-ico la la-calendar"></i>{{ dateText(t) }}<template v-if="timeText(t) && !t.dueAllDay"><i class="tk-date-ico tk-date-ico-sep la la-clock"></i>{{ timeText(t) }}</template></span>
                </div>
                <span v-if="t.subtaskCount" class="tk-cl-sub"><i class="la la-list-ul"></i>{{ t.subtaskCount }}</span>
              </div>
              <div v-if="!g.tasks.length" key="__empty" class="tk-cl-gempty">{{ $t('app.noTasks') }}</div>
            </transition-group>
            </div>
          </div>
        </template>
      </template>
    </section>

    <!-- 任务行右键菜单（统一单例组件，teleport 到 body；与日/周/月/日程视图共用） -->
    <task-context-menu />
  </div>
</template>

<script>
import { Tasks } from '../../composables/useTasks.js';
import { taskFilePath } from '../../api/tasks.js';
import { statusIcon, dateText, timeText, richSummaryNoTags } from '../../composables/tasks-logic.js';
import { VueModal } from '../../ui/VueModal.js';
import TaskEditorModal from '../TaskEditorModal.vue';
import { openTaskInFile } from '../../utils/openTaskInFile.js';
import { openCtxMenu } from '../../composables/useTaskCtxMenu.js';
import TaskContextMenu from './TaskContextMenu.vue';

export default {
  name: 'ChecklistView',
  props: {
    plugin: { type: Object, required: true },
    checklists: { type: Array, default: () => [] },
    // 清单主区视图：列表 / 分栏（由父 TasksApp 提升上来并持久化）
    mainView: { type: String, default: 'cols' },
    // 与日/周/月/日程共享的「仅显示待办」开关（由 TasksApp 的 hideDone 传入）
    hideDone: { type: Boolean, default: false }
  },
  components: { TaskContextMenu },
  data() {
    return {
      lists: [],
      activeKey: '',
      activeName: '',
      groups: [],
      activeTotal: 0,
      activeDone: 0,
      loading: false,
      error: '',
      dragGuid: '',        // 正在拖拽的任务 guid
      dragOverTitle: '',   // 当前拖拽悬停的分组标题（用于高亮）
    };
  },
  computed: {
    // 隐藏已完成/已取消：仅显示真正的待办（未完成且未取消），并去掉因此变空的组
    visibleGroups() {
      // 稳定排序：未完成在上，已完成/已取消在下方；每组内保持原相对顺序
      const sortTasks = (tasks) => {
        const rank = (t) => (t.completed || t.cancelled) ? 1 : 0;
        return tasks
          .map((t, i) => ({ t, i }))
          .sort((a, b) => rank(a.t) - rank(b.t) || a.i - b.i)
          .map((x) => x.t);
      };
      if (!this.hideDone) {
        return this.groups.map((g) => ({ title: g.title, tasks: sortTasks(g.tasks) }));
      }
      return this.groups
        .map((g) => ({ title: g.title, tasks: sortTasks(g.tasks).filter((t) => !(t.completed || t.cancelled)) }))
        .filter((g) => g.tasks.length);
    },
  },
  watch: {
    // 清单列表随父级自动刷新（外部改 tags / 增删清单文件触发重载）后同步本地副本。
    // 之前只 created 时拷贝一次，导致改 tags 后侧栏不刷新，需切视图才更新。
    checklists: {
      immediate: true,
      async handler(cls) {
        const prevKey = this.activeKey;
        this.lists = (cls && cls.length) ? cls.slice() : [];
        if (prevKey && this.lists.some((x) => x.key === prevKey)) {
          // 当前选中项仍在：保留选中、同步名称，并重读当前清单的分组——
          // 右侧 groups / 统计是 loadGroups 读文件得到的本地数据，不随 lists 引用自动更新；
          // 缺这一步会导致手动改笔记后左侧刷新而右侧滞留旧数据
          const c = this.lists.find((x) => x.key === prevKey);
          if (c) this.activeName = c.name;
          await this.loadGroups(prevKey);
        } else if (this.lists.length) {
          await this.selectList(this.lists[0].key);
        } else {
          this.activeKey = '';
          this.activeName = '';
          this.groups = [];
          this.activeTotal = 0;
          this.activeDone = 0;
        }
      }
    }
  },
  methods: {
    statusIcon, richSummaryNoTags, dateText, timeText,
    pct(c) { return c.total ? Math.round((c.done / c.total) * 100) : 0; },
    gKey(g) { return g.title || '___ungrouped'; },
    firstLine(s) { return String(s || '').split(/\r?\n/)[0]; },
    async selectList(key) {
      this.activeKey = key;
      const c = this.lists.find((x) => x.key === key);
      if (c) this.activeName = c.name;
      await this.loadGroups(key);
    },
    async loadGroups(key) {
      this.loading = true; this.error = '';
      try {
        const r = await Tasks.loadChecklistGroups(key);
        this.groups = r.groups || [];
        this.activeName = r.name || this.activeName;
        this.activeTotal = r.total || 0;
        this.activeDone = r.done || 0;
      } catch (e) { this.error = this.$t('app.loadChecklistFail') + (e && e.message || e); }
      finally { this.loading = false; }
    },
    async onToggle(t) {
      const done = !t.completed;
      try {
        await Tasks.toggleComplete(t.guid, done);
        t.completed = done; t.completedAt = done ? Date.now() : null;
        this.activeDone += done ? 1 : -1;
        const c = this.lists.find((x) => x.key === this.activeKey);
        if (c) c.done += done ? 1 : -1; // lists 与父级 checklists 共享引用，进度同步
      } catch (e) { this.error = this.$t('app.opFail') + (e && e.message || e); }
    },
    // 右键任务行：打开统一右键菜单（写文件 + 就地更新字段由单例处理；重算进度经 onAfterApply 回调）
    onContextMenu(t, e) {
      openCtxMenu(t, e, { onAfterApply: this.recalcProgress, onAfterDelete: () => this.loadGroups(this.activeKey) });
    },
    // 从本地 groups 重新计算当前清单的 total / done，并同步侧栏进度
    recalcProgress() {
      let total = 0, done = 0;
      for (const g of this.groups) for (const t of g.tasks) {
        total += 1;
        if (t.completed && !t.cancelled) done += 1;
      }
      this.activeTotal = total;
      this.activeDone = done;
      const c = this.lists.find((x) => x.key === this.activeKey);
      if (c) { c.total = total; c.done = done; }
    },
    // 任务行点击：Ctrl/⌘ 直接跳转高亮，否则打开编辑器
    onTaskClick(t, e) {
      if (e && (e.metaKey || e.ctrlKey)) this.openTask(t);
      else this.openEditor(t);
    },
    // Ctrl/Cmd + 点击任务项：直接跳转到任务所在笔记并高亮（不打开编辑器）
    async openTask(t) {
      await openTaskInFile(this.plugin, t);
    },
    openEditor(task, defaultDate) {
      new VueModal(this.plugin.app, TaskEditorModal, {
        open: true, task, defaultDate, plugin: this.plugin,
        onSaved: () => this.loadGroups(this.activeKey),
        onDeleted: () => this.loadGroups(this.activeKey),
        onSubtasksChanged: () => this.loadGroups(this.activeKey)
      }).open();
    },
    // 分组内新建：弹 TaskEditorModal（create 模式），保存时追加到该分组最后一行
    openAdd(g) {
      new VueModal(this.plugin.app, TaskEditorModal, {
        open: true, task: null, defaultDate: '', plugin: this.plugin,
        createIn: { list: this.activeKey, group: g.title || '' },
        onSaved: () => this.loadGroups(this.activeKey),
        onDeleted: () => this.loadGroups(this.activeKey),
        onSubtasksChanged: () => this.loadGroups(this.activeKey)
      }).open();
    },
    openFile(key) {
      const path = taskFilePath(key);
      if (!path) return;
      this.plugin.app.workspace.openLinkText(path, '', false);
    },
    // v-html 内的链接点击：阻止冒泡，避免同时触发所在行的「打开编辑器」
    onRichClick(e) {
      if (e.target && e.target.tagName === 'A') e.stopPropagation();
    },
    // 拖拽：将任务项拖到其他分组
    onDragStart(e, t) {
      this.dragGuid = t.guid;
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', t.guid);
      }
    },
    onDragEnd() { this.dragGuid = ''; this.dragOverTitle = ''; },
    onDragOver(e, title) { this.dragOverTitle = title; },
    onDrop(e, title) {
      const guid = (e.dataTransfer && e.dataTransfer.getData('text/plain')) || this.dragGuid;
      this.dragOverTitle = ''; this.dragGuid = '';
      if (!guid) return;
      this.moveTask(guid, title);
    },
    async moveTask(guid, title) {
      try {
        await Tasks.moveChecklistTask(this.activeKey, guid, title);
        await this.loadGroups(this.activeKey); // 重新加载以反映新分组
      } catch (e) { this.error = this.$t('app.moveFail') + (e && e.message || e); }
    }
  }
};
</script>

<style scoped>
.tk-clview { flex: 1 1 auto; min-height: 0; min-width: 0; display: flex; }

/* ===== 左侧清单列表（随面板按比例收窄，不再固定 260px） ===== */
.tk-cl-side {
  /* 与右侧按 2:5 占比共享空间，面板变窄时本列按比例收窄；
     container-type 让内部按钮随「本列宽度」响应，而非主窗口 */
  flex: 2 1 0; max-width: 260px; min-width: 120px; min-height: 0;
  container-type: inline-size;
  display: flex; flex-direction: column;
  border-right: 1px solid var(--line);
  background: var(--panel);
}
.tk-cl-side-h {
  flex: none; display: flex; align-items: center; gap: 8px;
  padding: 14px 16px; font-size: 14px; font-weight: 700; color: var(--ink);
  border-bottom: 1px solid var(--line);
}
.tk-cl-side-h i { color: var(--gold); font-size: 16px; }
.tk-cl-side-empty {
  padding: 28px 18px; color: var(--ink-soft); font-size: 12.5px; line-height: 1.7; text-align: center;
}
.tk-cl-list { flex: 1; overflow: auto; padding: 8px; display: flex; flex-direction: column; gap: 6px; }
.tk-cl-item { display: flex; align-items: center; gap: 8px; }
.tk-cl-item-main {
  flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 7px;
  padding: 11px 12px; border-radius: 10px; cursor: pointer;
  border: 1px solid transparent; text-align: left;
  background: transparent; color: var(--ink);
  transition: background .15s ease, transform .12s ease;
}
/* 清单项右侧：打开对应 vault 文件（独立于选中态，与列表视图一致） */
.tk-cl-open {
  flex: none; width: 28px; height: 28px; padding: 0; border: none; border-radius: 8px;
  background: transparent; color: var(--ink-soft); cursor: pointer; font-size: 14px;
  display: inline-flex; align-items: center; justify-content: center; box-shadow: none;
  transition: background .15s ease, color .15s ease;
}
.tk-cl-open:hover { background: var(--gold-bg); color: var(--gold); }
.tk-cl-item-main:hover { background: var(--gold-bg); }
.tk-cl-item-main:active { transform: scale(.99); }
.tk-cl-item-main.on { background: var(--gold); border-color: transparent; box-shadow: var(--shadow-s); }
.tk-cl-item-main.on .tk-cl-name,
.tk-cl-item-main.on .tk-cl-meta { color: var(--text-on-accent); }
.tk-cl-item-main.on .tk-cl-bar { background: rgba(255, 255, 255, .28); }
.tk-cl-name { font-size: 14px; font-weight: 600; line-height: 1.3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tk-cl-bar { height: 6px; border-radius: 999px; background: rgba(127, 127, 127, .18); overflow: hidden; }
.tk-cl-bar > i { display: block; height: 100%; border-radius: 999px; background: var(--c-done); transition: width .3s ease; }
.tk-cl-meta { font-size: 11px; color: var(--ink-soft); font-variant-numeric: tabular-nums; }

/* ===== 右侧主区（随面板弹性收窄；container-type 让任务日期随「本区宽度」响应） ===== */
.tk-cl-main { flex: 5 1 0; min-width: 0; min-height: 0; display: flex; flex-direction: column; container-type: inline-size; }
.tk-cl-empty-main { flex: 1; display: flex; align-items: center; justify-content: center; color: var(--ink-soft); }
.tk-cl-main-h {
  flex: none; display: flex; align-items: center; gap: 12px;
  padding: 14px 0 14px 20px; border-bottom: 1px solid var(--line);
}
.tk-cl-head-l { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.tk-cl-title { font-size: 18px; font-weight: 700; color: var(--ink); line-height: 1.25; word-break: break-all; }
.tk-cl-prog { font-size: 12px; color: var(--ink-soft); font-variant-numeric: tabular-nums; }

.tk-cl-loading, .tk-cl-none { padding: 40px; text-align: center; color: var(--ink-soft); }
.tk-cl-body { flex: 1; overflow: auto; padding: 4px 20px 28px; }

.tk-cl-group { margin-top: 18px; }
/* 拖拽放置目标高亮（列表 / 分栏两种容器通用） */
.tk-cl-group.tk-cl-drophover,
.tk-cl-col.tk-cl-drophover { background: var(--gold-bg); }
.tk-cl-gtitle {
  display: flex; align-items: center; gap: 10px;
  font-size: 15px; font-weight: 700; color: var(--ink);
  padding: 8px 0 9px; margin-bottom: 4px;
  border-bottom: 1px solid var(--line);
}
.tk-cl-gtitle::before { content: ''; width: 4px; height: 16px; border-radius: 3px; background: var(--gold); flex: none; }
.tk-cl-gtitle.is-plain { border-bottom: none; padding-top: 0; }
.tk-cl-gtitle.is-plain::before { background: transparent; width: 0; }
.tk-cl-gtxt { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tk-cl-gplain { font-size: 12px; font-weight: 600; color: var(--ink-soft); }
.tk-cl-gcnt { font-size: 11px; font-weight: 600; color: var(--ink-soft); font-variant-numeric: tabular-nums; }
.tk-cl-rows { display: flex; flex-direction: column; }
/* 清单任务排序动画：勾选完成/取消后平滑沉到组底（FLIP 位移），并给增删一个轻微淡入淡出 */
/* 用 .tk-cl-rows 后代选择器提高特异性，压过 .tk-cl-row 自带的 transition（否则 transform 不被过渡，位移动画失效） */
.tk-cl-rows .tk-clmove-move { transition: transform .3s cubic-bezier(.4, 0, .2, 1); }
.tk-cl-rows .tk-clmove-enter-active,
.tk-cl-rows .tk-clmove-leave-active { transition: opacity .2s ease; }
.tk-cl-rows .tk-clmove-enter-from,
.tk-cl-rows .tk-clmove-enter { opacity: 0; }
.tk-cl-rows .tk-clmove-leave-to,
.tk-cl-rows .tk-clmove-leave { opacity: 0; }

.tk-cl-row {
  display: flex; align-items: flex-start; gap: 11px;
  padding: 9px 10px; border-radius: 9px; cursor: grab;
  /* 按层级深度缩进，体现主任务 / 子任务隶属关系（深度来自 toRecord 的 indent） */
  padding-left: calc(10px + (var(--cl-depth, 0) * 24px));
  transition: background .15s ease;
}
.tk-cl-row:active { cursor: grabbing; }
.tk-cl-row:hover { background: var(--gold-bg); }
.tk-cl-row .tk-check { flex: none; margin-top: 1px; }
.tk-cl-row-main { flex: 1 1 auto; min-width: 0; }
.tk-cl-sum { font-size: 14px; color: var(--ink); line-height: 1.5; word-break: break-word; }
.tk-cl-sum :deep(a) { color: var(--accent, var(--gold)); }
.tk-cl-desc { font-size: 12px; color: var(--ink-soft); line-height: 1.5; margin-top: 2px; word-break: break-word; }
.tk-cl-row.done .tk-cl-sum,
.tk-cl-row.cancel .tk-cl-sum { color: var(--ink-soft); text-decoration: line-through; opacity: .75; }
.tk-cl-row.done .tk-cl-desc,
.tk-cl-row.cancel .tk-cl-desc { opacity: .5; }
.tk-cl-date { flex: none; font-size: 12px; color: var(--text-faint); font-variant-numeric: tabular-nums; padding-top: 3px; }
/* 分栏视图下：日期时间作为任务文字下方的副行（块级、与正文留间距） */
.tk-cl-date-sub { display: block; margin-top: 3px; }
.tk-cl-sub { flex: none; display: inline-flex; align-items: center; gap: 3px; font-size: 11px; color: var(--ink-soft); padding-top: 2px; }
.tk-cl-gempty { padding: 6px 10px 10px; color: var(--ink-soft); font-size: 12px; opacity: .7; }

/* 分栏视图：每个分组一栏，固定宽度，横向滚动；每栏内部独立纵向滚动 */
.tk-cl-cols {
  flex: 1; min-height: 0; display: flex; gap: 14px; align-items: stretch;
  overflow-x: auto; overflow-y: hidden; padding: 12px 20px 20px;
  /* 横向滚动条常驻可见（macOS 默认会隐藏，仅滚动时闪现） */
  scrollbar-width: thin;
  scrollbar-color: var(--ink-soft) transparent;
}
.tk-cl-cols::-webkit-scrollbar { height: 10px; }
.tk-cl-cols::-webkit-scrollbar-track { background: transparent; }
.tk-cl-cols::-webkit-scrollbar-thumb {
  background: var(--ink-soft); border-radius: 999px;
  border: 3px solid transparent; background-clip: padding-box;
}
.tk-cl-cols::-webkit-scrollbar-thumb:hover { background: var(--gold); }
.tk-cl-cols > .tk-cl-none { flex: 1; }
.tk-cl-col {
  flex: none; width: 280px; min-height: 0;
  display: flex; flex-direction: column;
  background: var(--panel); border: 1px solid var(--line); border-radius: 12px;
}
.tk-cl-col .tk-cl-gtitle {
  flex: none; margin: 0; padding: 12px 14px 10px; border-bottom: 1px solid var(--line);
}
.tk-cl-col .tk-cl-gtitle.is-plain { border-bottom: 1px solid var(--line); padding-top: 12px; }
.tk-cl-col .tk-cl-rows {
  flex: 1; overflow-y: auto; padding: 6px 8px 12px; gap: 2px;
  /* 分栏内纵向滚动条同样常驻可见 */
  scrollbar-width: thin; scrollbar-color: var(--ink-soft) transparent;
}
.tk-cl-col .tk-cl-rows::-webkit-scrollbar { width: 8px; }
.tk-cl-col .tk-cl-rows::-webkit-scrollbar-track { background: transparent; }
.tk-cl-col .tk-cl-rows::-webkit-scrollbar-thumb {
  background: var(--ink-soft); border-radius: 999px;
  border: 2px solid transparent; background-clip: padding-box;
}
.tk-cl-col .tk-cl-rows::-webkit-scrollbar-thumb:hover { background: var(--gold); }
/* 窄页面分栏模式：每栏收窄、栏间距收紧，避免横向空间浪费（随面板宽度而非主窗口） */
@container (max-width: 720px) {
  .tk-cl-cols { gap: 10px; padding: 10px 14px 16px; }
  .tk-cl-col { width: 240px; }
}
@container (max-width: 480px) {
  .tk-cl-cols { gap: 6px; padding: 8px 10px 12px; }
  .tk-cl-col { width: 196px; }
}
/* 窄页面列表视图（分组竖向堆叠）：收紧左右内边距、分组间距与行内 gap，避免窄屏留白过多（随面板宽度） */
@container (max-width: 720px) {
  .tk-cl-body { padding: 4px 14px 24px; }
  .tk-cl-main-h { padding: 12px 0 12px 14px; }
  .tk-cl-group { margin-top: 14px; }
  .tk-cl-gtitle { gap: 8px; padding: 7px 0 8px; }
  .tk-cl-row { gap: 9px; padding-right: 8px; }
}
@container (max-width: 480px) {
  .tk-cl-body { padding: 4px 10px 20px; }
  .tk-cl-main-h { padding: 10px 0 10px 10px; }
  .tk-cl-group { margin-top: 10px; }
  .tk-cl-gtitle { gap: 6px; padding: 6px 0 7px; }
  .tk-cl-row { gap: 7px; padding-right: 6px; }
}

/* ===== 随「各自容器宽度」收起次要信息（与日程视图一致，均看本列/本区宽度而非主窗口） ===== */
/* 左侧清单列变窄（≤200px）：隐藏「打开文件」按钮、已完成计数与百分比进度条，仅留清单名称 */
@container (max-width: 200px) {
  .tk-cl-open, .tk-cl-meta, .tk-cl-bar { display: none; }
}
/* 右侧主区变窄（≤420px）：隐藏任务行的日期与时间，仅留正文 */
@container (max-width: 420px) {
  .tk-cl-date { display: none; }
}
</style>

<!-- 右键菜单 teleport 到 body，scoped 样式无法命中，这里用全局（非 scoped）样式确保生效 -->

