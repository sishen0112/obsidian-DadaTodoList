<template>
  <div class="tk-topbar">
    <div class="tk-tb-left">
      <!-- 周 / 日 / 月：区间文案 + 待办面板开关 + 上/本/下导航 + 仅显示待办（三分支结构相同，差异在导航文案） -->
      <template v-if="nav">
        <span class="tk-range">{{ rangeLabel }}</span>
        <button class="tk-btn tk-tb-todo" type="button" :class="{ on: todoPanelOpen }"
                :title="todoPanelOpen ? $t('app.collapseTodo') : $t('app.expandTodo')"
                @click="$emit('toggle-todo-panel')">
          <i class="la la-list"></i><span>{{ $t('common.todo') }}</span>
          <i class="la la-angle-left tk-side-caret" :class="{ collapsed: !todoPanelOpen }"></i>
        </button>
        <div class="tk-btn-group">
          <button class="tk-btn ico" type="button" @click="$emit('navigate', 'prev')" :title="$t(nav.prev)"><i class="la la-angle-left"></i></button>
          <button class="tk-btn" type="button" @click="$emit('navigate', 'this')">{{ $t(nav.current) }}</button>
          <button class="tk-btn ico" type="button" @click="$emit('navigate', 'next')" :title="$t(nav.next)"><i class="la la-angle-right"></i></button>
        </div>
        <button class="tk-btn ico" type="button" :class="{ on: hideDone }"
                :title="hideDone ? $t('app.showAll') : $t('app.hideDone')" @click="$emit('toggle-hide-done')">
          <i class="la" :class="hideDone ? 'la-eye-slash' : 'la-eye'"></i>
        </button>
      </template>

      <!-- 日程视图：区间 + 回到今天 + 仅显示待办 -->
      <template v-else-if="view === 'agenda'">
        <span class="tk-range">{{ rangeLabel }}</span>
        <button class="tk-btn" type="button" @click="$emit('back-to-today')" :title="$t('app.backToToday')">
          <i class="la la-clock-o"></i><span>{{ $t('app.backToToday') }}</span>
        </button>
        <button class="tk-btn ico" type="button" :class="{ on: hideDone }"
                :title="hideDone ? $t('app.showAll') : $t('app.hideDone')" @click="$emit('toggle-hide-done')">
          <i class="la" :class="hideDone ? 'la-eye-slash' : 'la-eye'"></i>
        </button>
      </template>

      <!-- 清单视图：列表/分栏分段切换 + 仅显示待办，贴近右侧视图切换 -->
      <template v-else-if="view === 'cl'">
        <div class="tk-cl-hide">
          <div class="tk-btn-group tk-cl-radio">
            <button class="tk-btn" type="button" :class="{ on: clMainView === 'list' }" @click="$emit('set-cl-main-view', 'list')"><i class="la la-list"></i>{{ $t('app.list') }}</button>
            <button class="tk-btn" type="button" :class="{ on: clMainView === 'cols' }" @click="$emit('set-cl-main-view', 'cols')"><i class="la la-columns"></i>{{ $t('app.cols') }}</button>
          </div>
          <button class="tk-btn ico" type="button" :class="{ on: hideDone }"
                  :title="hideDone ? $t('app.showAll') : $t('app.hideDone')" @click="$emit('toggle-hide-done')">
            <i class="la" :class="hideDone ? 'la-eye-slash' : 'la-eye'"></i>
          </button>
        </div>
      </template>
    </div>

    <!-- 视图切换已迁至底部悬浮胶囊菜单 <view-pill />（见 TasksApp.vue） -->
  </div>
</template>

<script>
// 顶栏：左侧各视图控件（区间文案 / 待办面板开关 / 前后导航 / 仅显示待办）+ 右侧视图切换下拉。
// 从 TasksApp 抽离：导航等交互以事件交还父级（navigate('prev'|'this'|'next')），
// 视图名等文案经 $t 跟随 Obsidian 界面语言。
export default {
  name: 'TaskTopBar',
  props: {
    // 当前视图 key：four / day / month / agenda / cl / all
    view: { type: String, required: true },
    // 区间文案（周视图日期区间 / 日视图日期 / 月份 / 日程区间），由父级按视图给入
    rangeLabel: { type: String, default: '' },
    todoPanelOpen: { type: Boolean, default: false },
    hideDone: { type: Boolean, default: false },
    clMainView: { type: String, default: 'cols' }
  },
  emits: ['navigate', 'toggle-todo-panel', 'toggle-hide-done', 'set-cl-main-view', 'back-to-today'],
  computed: {
    // 周/日/月共用的导航文案（i18n key）；其余视图返回 null 走各自分支
    nav() {
      if (this.view === 'four') return { current: 'app.thisWeek', prev: 'app.prevWeekTitle', next: 'app.nextWeekTitle' };
      if (this.view === 'day') return { current: 'app.today', prev: 'app.prevDayTitle', next: 'app.nextDayTitle' };
      if (this.view === 'month') return { current: 'app.thisMonth', prev: 'app.prevMonthTitle', next: 'app.nextMonthTitle' };
      return null;
    }
  }
};
</script>

<style scoped>
/* ===== 顶栏（自 TasksApp.vue 迁入）：一行两端——左侧各视图控件、右侧视图切换 ===== */
.tk-topbar { flex: none; position: sticky; top: 0; z-index: 5; display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; flex-wrap: wrap; background: var(--paper); padding: 2px 0; container-type: inline-size; }
.tk-tb-left { flex: 1 1 auto; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; min-width: 0; }
/* 左分组内：日期区间靠左，待办/隐藏/切换按钮组靠右（贴近视图切换） */
.tk-tb-left .tk-range { margin-right: auto; }
.tk-range { font-size: 16px; font-weight: 700; color: var(--ink); font-variant-numeric: tabular-nums; }
/* 清单视图无日期区间，单独把「列表/分栏 + 仅显示待办」推到右侧贴近视图切换 */
.tk-cl-hide { margin-left: auto; display: inline-flex; align-items: center; gap: 8px; }

/* ===== 入场动画 ===== */
@keyframes tkTopbarRise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
.tk-topbar { animation: tkTopbarRise .45s ease both; }

/* 日/周/月视图：窄屏隐藏「展开待办」按钮（窗口级），并收紧左分组间距 */
@media (max-width: 480px) {
  .tk-tb-left { gap: 8px; }
  .tk-tb-todo { display: none !important; }
}
/* 日/周/月视图：面板过窄时隐藏「展开待办」按钮（面板级，随顶栏自身宽度） */
@container (max-width: 480px) {
  .tk-tb-todo { display: none !important; }
}
@media (prefers-reduced-motion: reduce) {
  .tk-topbar { animation: none !important; }
}
</style>
