<template>
  <div class="tk-listview">
    <div class="tk-split">
      <!-- 左侧筛选：日期 + 标签 + 清单（纯展示，互斥逻辑在容器） -->
      <task-filters :date-filters="ctx.dateFilters" :date-filter="ctx.dateFilter"
                    :tag-tree="ctx.tagTree" :tag-filter="ctx.tagFilter"
                    :checklists="ctx.checklists" :active-list="ctx.activeList"
                    :status-view="ctx.statusView" :status-counts="ctx.statusCounts"
                    @select-date="ctx.selectDate" @toggle-tag="ctx.toggleTagFilter"
                    @select-list="ctx.selectList" @select-status="ctx.selectStatus"
                    @open-list-file="ctx.openListFile" />

      <section class="tk-card tk-list">
        <div class="tk-card-title">
          {{ ctx.listTitle }}<span class="cnt">{{ ctx.listSource.length }}</span>
        </div>
        <div class="tk-quick">
          <input ref="quickInput" :value="ctx.quick" class="tk-quick-input" type="text"
                 :placeholder="ctx.activeList ? $t('app.quickAddTo', { name: ctx.activeListName }) : $t('app.quickAdd')"
                 :disabled="ctx.adding" @keyup.enter="quickAdd" @input="ctx.setQuick($event.target.value)" />
          <button class="tk-quick-btn" type="button" :disabled="ctx.adding || !ctx.quick.trim()" @click="quickAdd" :title="$t('common.save')"><i class="la la-save"></i></button>
        </div>

        <!-- 状态视图（已完成 / 已取消）：按日期分组倒序，日期头可折叠 -->
        <div v-if="ctx.statusView" class="tk-groups">
          <div v-for="g in ctx.statusGroups" :key="g.key" class="tk-group">
            <button class="tk-group-h tk-group-toggle" type="button"
                    :aria-expanded="!ctx.dayCollapsed[g.key] ? 'true' : 'false'"
                    :title="ctx.dayCollapsed[g.key] ? $t('app.expandDay') : $t('app.collapseDay')"
                    @click="ctx.toggleDay(g.key)">
              <i class="la la-caret-right tk-caret" :class="{ open: !ctx.dayCollapsed[g.key] }"></i>
              <span>{{ g.label }}</span><span class="cnt">{{ g.n }}</span>
            </button>
            <template v-if="!ctx.dayCollapsed[g.key]">
              <task-row v-for="t in g.tasks" :key="t.guid" :task="t"
                        :selected="t.guid === ctx.selectedGuid"
                        @select="ctx.openEdit" @toggle="ctx.toggle" @open="ctx.openTask" />
            </template>
          </div>
          <div v-if="!ctx.statusGroups.length" class="tk-group-empty">{{ $t('app.noTasks') }}</div>
        </div>

        <div v-else class="tk-groups">
          <div class="tk-group">
            <div class="tk-group-h">{{ $t('common.todo') }}<span class="cnt">{{ ctx.listIncomplete.length }}</span></div>
            <div v-if="!ctx.listIncomplete.length" class="tk-group-empty">{{ $t('app.noTodos') }}</div>
            <!-- 按日期分桶：已过期 / 今天 / 明天 / 最近7天 / 更远 / 无日期，各桶可折叠 -->
            <div v-for="b in ctx.todoBuckets" :key="b.key" class="tk-bucket">
              <div class="tk-bucket-h">
                <button class="tk-bucket-toggle" type="button"
                        :aria-expanded="!ctx.todoCollapsed[b.key] ? 'true' : 'false'"
                        :title="ctx.todoCollapsed[b.key] ? $t('app.expand') : $t('app.collapse')"
                        @click="ctx.toggleBucket(b.key)">
                  <i class="la la-caret-right tk-caret" :class="{ open: !ctx.todoCollapsed[b.key] }"></i>
                  <span>{{ b.label }}</span><span class="cnt">{{ b.n }}</span>
                </button>
                <button v-if="b.key === 'overdue'" class="tk-postpone-link" type="button"
                        :title="$t('app.postponeAllTip')" @click="ctx.openPostpone">{{ $t('app.postponeBtn') }}</button>
              </div>
              <template v-if="!ctx.todoCollapsed[b.key]">
                <task-row v-for="t in b.tasks" :key="t.guid" :task="t"
                          :selected="t.guid === ctx.selectedGuid"
                          :show-date="b.key === 'overdue' || b.key === 'week7' || b.key === 'far'"
                          @select="ctx.openEdit" @toggle="ctx.toggle" @open="ctx.openTask" />
              </template>
            </div>
          </div>

          <div class="tk-group">
            <button class="tk-group-h tk-group-toggle" type="button"
                    :aria-expanded="ctx.showCompleted ? 'true' : 'false'"
                    :title="ctx.showCompleted ? $t('app.collapseDone') : $t('app.expandDone')"
                    @click="ctx.toggleShowCompleted()">
              <i class="la la-caret-right tk-caret" :class="{ open: ctx.showCompleted }"></i>
              <span>{{ $t('app.done') }}</span><span class="cnt">{{ ctx.listCompleted.length }}</span>
            </button>
            <template v-if="ctx.showCompleted">
              <div v-if="!ctx.listCompleted.length" class="tk-group-empty">{{ $t('app.noDone') }}</div>
              <task-row v-for="t in ctx.listCompleted" :key="t.guid" :task="t"
                        :selected="t.guid === ctx.selectedGuid"
                        @select="ctx.openEdit" @toggle="ctx.toggle" @open="ctx.openTask" />
            </template>
          </div>

          <div class="tk-group">
            <button class="tk-group-h tk-group-toggle" type="button"
                    :aria-expanded="ctx.showCancelled ? 'true' : 'false'"
                    :title="ctx.showCancelled ? $t('app.collapseCancelled') : $t('app.expandCancelled')"
                    @click="ctx.toggleShowCancelled()">
              <i class="la la-caret-right tk-caret" :class="{ open: ctx.showCancelled }"></i>
              <span>{{ $t('app.cancelled') }}</span><span class="cnt">{{ ctx.listCancelled.length }}</span>
            </button>
            <template v-if="ctx.showCancelled">
              <div v-if="!ctx.listCancelled.length" class="tk-group-empty">{{ $t('app.noCancelled') }}</div>
              <task-row v-for="t in ctx.listCancelled" :key="t.guid" :task="t"
                        :selected="t.guid === ctx.selectedGuid"
                        @select="ctx.openEdit" @toggle="ctx.toggle" @open="ctx.openTask" />
            </template>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<script>
// 列表视图（所有）：左侧筛选 + 右侧分组列表 / 卡片。
// 共享状态与方法都在父级（ctx）；仅「快速新增」交互在此组件内（需本地 ref 聚焦）。
import { Tasks } from '../../composables/useTasks.js';
import TaskFilters from './TaskFilters.vue';
import TaskRow from './TaskRow.vue';

export default {
  name: 'TaskListView',
  components: { TaskFilters, TaskRow },
  props: {
    ctx: { type: Object, required: true },
    plugin: { type: Object, default: null }
  },
  methods: {
    async quickAdd() {
      const summary = (this.ctx.quick || '').trim();
      if (!summary || this.ctx.adding) return;
      this.ctx.setAdding(true);
      try {
        // 选中清单时，新任务直接写入该清单文件
        await Tasks.createTask(this.ctx.activeList ? { summary, list: this.ctx.activeList } : { summary });
        await this.ctx.reload();
        this.ctx.setQuick('');
        this.$nextTick(() => { if (this.$refs.quickInput) this.$refs.quickInput.focus(); });
      } catch (e) {
        this.ctx.setError(this.$t('app.createFail') + (e && e.message || e));
      } finally {
        this.ctx.setAdding(false);
      }
    }
  }
};
</script>

<!-- 非 scoped：列表视图类名 tk- 前缀限定，随 tasks-shared.css 一并全局可用 -->
<style>
/* ===== 列表视图 ===== */
.tk-listview { flex: 1 1 auto; min-height: 0; display: flex; }
.tk-split { display: flex; gap: 0; align-items: stretch; flex: 1 1 auto; min-height: 0; }


/* 右侧主区：与清单视图 .tk-cl-main 一致——无卡片边框，靠标题底部分隔线区隔 */
.tk-card {
  flex: 5 1 0; min-width: 0; min-height: 0;
  background: transparent; border: none; box-shadow: none; border-radius: 0;
  padding: 0; display: flex; flex-direction: column;
  /* container-type 让内部标题/快速新增/分组间距随「本区宽度」响应，而非主窗口（与清单视图 .tk-cl-main 一致） */
  container-type: inline-size;
}
/* 标题行：与清单视图 .tk-cl-main-h 一致（大标题 + 右侧操作 + 底部分隔线） */
.tk-card-title { font-size: 18px; font-weight: 700; color: var(--ink); margin: 0; padding: 14px 20px; display: flex; align-items: center; gap: 8px; flex: none; border-bottom: 1px solid var(--line); }
.tk-card-title .cnt, .tk-group-h .cnt { font-size: 11px; font-weight: 400; color: var(--ink-soft); background: var(--panel-2); border: 1px solid var(--line); border-radius: 8px; padding: 0 7px; }
.tk-quick {
  flex: none; display: flex; align-items: center; gap: 6px; margin: 14px 20px;
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
  border: none !important; background: transparent; font: inherit;
  font-size: 13px; font-weight: 600; color: var(--ink-soft);
  padding: 3px 6px; border-radius: 7px; cursor: pointer;
  text-align: left;
  box-shadow: none !important;
  transition: background .15s ease, color .15s ease;
}
.tk-bucket-toggle:hover { background: var(--gold-bg); color: var(--ink); }
.tk-bucket-toggle .cnt { font-size: 11px; opacity: .7; font-variant-numeric: tabular-nums; }
.tk-postpone-link {
  margin-left: auto; border: none !important; background: transparent;
  font: inherit; font-size: 12px; font-weight: 600; color: var(--c-cancel) !important;
  padding: 2px 8px; border-radius: 7px; cursor: pointer;
  box-shadow: none !important;
  transition: background .15s ease;
}
.tk-postpone-link:hover { background: var(--background-modifier-hover); }
.tk-groups { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 0 20px 20px; }
.tk-group { margin-bottom: 12px; }
.tk-group-h { font-size: 12px; font-weight: 700; color: var(--ink-soft); margin: 4px 2px 8px; display: flex; align-items: center; gap: 8px; letter-spacing: .5px; text-align: left; }
/* 「已办」分组标题：可点击展开 / 收起 */
.tk-group-toggle {
  box-sizing: border-box; margin: 0 0 8px; padding: 4px 2px;
  border: none !important; background: transparent; font: inherit; font-size: 12px;
  font-weight: 700; color: var(--ink-soft); cursor: pointer; text-align: left;
  box-shadow: none !important;
  transition: color .15s ease;
}
.tk-group-toggle:hover { color: var(--gold); }
.tk-caret { width: 11px; font-size: 11px; transition: transform .18s ease; }
.tk-caret.open { transform: rotate(90deg); }
.tk-group-empty { color: var(--ink-soft); font-size: 12.5px; padding: 8px 4px 14px; opacity: .7; }
/* 窄面板：收紧标题 / 快速新增 / 分组与分桶的左右内边距与间距，避免留白过多（随本区宽度） */
@container (max-width: 720px) {
  .tk-card-title { padding: 12px 14px; }
  .tk-quick { margin: 12px 14px; }
  .tk-groups { padding: 0 14px 18px; }
  .tk-group { margin-bottom: 10px; }
  .tk-bucket { margin: 2px 0 6px; }
}
@container (max-width: 480px) {
  .tk-card-title { padding: 10px 10px; }
  .tk-quick { margin: 10px 10px; }
  .tk-groups { padding: 0 10px 16px; }
  .tk-group { margin-bottom: 8px; }
  .tk-bucket { margin: 2px 0 4px; }
}
</style>
