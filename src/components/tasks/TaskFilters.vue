<template>
  <aside class="tk-filters">
    <div class="tk-filter-h">{{ $t('app.filterDate') }}</div>
    <button v-for="f in dateFilters" :key="f.key" class="tk-filter-item" type="button"
            :class="{ on: dateFilter === f.key }" @click="$emit('select-date', f.key)">
      <i class="la" :class="f.icon"></i><span>{{ $t(f.labelKey) }}</span>
    </button>

    <template v-if="tagTree.groups.length || tagTree.loose.length">
      <div class="tk-filter-h">{{ $t('app.filterTag') }}</div>
      <div v-for="g in tagTree.groups" :key="g.tag">
        <button class="tk-filter-item tk-filter-parent" type="button"
                :class="{ on: tagFilter === g.tag }" @click="$emit('toggle-tag', g.tag)">
          <i class="la" :class="tagFilter === g.tag ? 'la-folder-open' : 'la-folder'"></i>
          <span>{{ g.label }}</span><span class="cnt">{{ g.n }}</span>
        </button>
        <button v-for="c in g.items" :key="c.tag" class="tk-filter-item tk-filter-child" type="button"
                :class="{ on: tagFilter === c.tag }" @click="$emit('toggle-tag', c.tag)">
          <span>{{ c.label }}</span><span class="cnt">{{ c.n }}</span>
        </button>
      </div>
      <button v-for="t in tagTree.loose" :key="t.tag" class="tk-filter-item" type="button"
              :class="{ on: tagFilter === t.tag }" @click="$emit('toggle-tag', t.tag)">
        <i class="la la-tag"></i><span>{{ t.label }}</span><span class="cnt">{{ t.n }}</span>
      </button>
    </template>

    <!-- 清单：3. Resources/清单 下的 md 文件，文件名即清单名。
         点击名称 = 选中清单并在列表加载其任务；右侧图标 = 打开对应 vault 文件 -->
    <template v-if="checklists.length">
      <div class="tk-filter-h">{{ $t('app.filterChecklist') }}</div>
      <div v-for="c in checklists" :key="c.key" class="tk-filter-row">
        <button class="tk-filter-item" type="button"
                :class="{ on: activeList === c.key }"
                :title="$t('app.checklistCount', { name: c.name, done: c.done, total: c.total })"
                @click="$emit('select-list', c.key)">
          <i class="la la-bookmark-o"></i>
          <span>{{ c.name }}</span><span class="cnt">{{ c.done }}/{{ c.total }}</span>
        </button>
        <button class="tk-filter-open" type="button" :title="$t('app.openChecklistFile')"
                @click.stop="$emit('open-list-file', c.key)">
          <i class="la la-external-link-alt"></i>
        </button>
      </div>
    </template>

    <!-- 状态：已完成 / 已取消，点击进入对应的按日期分组视图（与其他筛选互斥） -->
    <div class="tk-filter-h">{{ $t('app.filterStatus') }}</div>
    <button class="tk-filter-item" type="button"
            :class="{ on: statusView === 'done' }" @click="$emit('select-status', 'done')">
      <i class="la la-check-circle-o"></i><span>{{ $t('app.done') }}</span><span class="cnt">{{ statusCounts.done }}</span>
    </button>
    <button class="tk-filter-item" type="button"
            :class="{ on: statusView === 'cancelled' }" @click="$emit('select-status', 'cancelled')">
      <i class="la la-minus-circle"></i><span>{{ $t('app.cancelled') }}</span><span class="cnt">{{ statusCounts.cancelled }}</span>
    </button>
  </aside>
</template>

<script>
// 列表视图左侧筛选侧栏（日期 / 标签 / 清单）。
// 纯展示组件：所有选择动作上抛，标签与清单的互斥等逻辑由容器处理。
export default {
  name: 'TaskFilters',
  props: {
    dateFilters: { type: Array, default: () => [] },
    dateFilter: { type: String, default: 'all' },
    // 标签树：{ groups: [{label, tag, n, items}], loose: [{label, tag, n}] }
    tagTree: { type: Object, required: true },
    tagFilter: { type: String, default: '' },
    checklists: { type: Array, default: () => [] },
    activeList: { type: String, default: '' },
    // 状态视图：'' | 'done' | 'cancelled'；statusCounts 为当前池内的数量
    statusView: { type: String, default: '' },
    statusCounts: { type: Object, default: () => ({ done: 0, cancelled: 0 }) }
  }
};
</script>

<style scoped>
/* ===== 筛选侧栏 ===== */
.tk-filters {
  flex: 2 1 0; max-width: 260px; min-width: 120px; min-height: 0; overflow-y: auto;
  /* 与清单视图 .tk-cl-side 一致：开放侧栏，仅右侧一条分隔线，不再用浮动卡片边框；
     flex 收缩以随面板变窄，container-type 让内部按钮随「本栏宽度」响应而非主窗口 */
  background: var(--panel); border-right: 1px solid var(--line);
  border-radius: 0; box-shadow: none; padding: 10px 8px;
  container-type: inline-size;
}
.tk-filter-h { font-size: 12px; font-weight: 700; letter-spacing: .6px; color: var(--ink-soft); margin: 2px 4px 8px; }
.tk-filter-h + .tk-filter-h, .tk-filter-item + .tk-filter-h, div + .tk-filter-h { margin-top: 16px; }
.tk-filter-item {
  display: flex; align-items: center; gap: 7px; width: 100%; box-sizing: border-box;
  padding: 6px 8px; margin-bottom: 2px; border: none; border-radius: 8px;
  background: transparent; font: inherit; font-size: 14px; color: var(--ink);
  cursor: pointer; text-align: left;
  transition: background .15s ease, color .15s ease;
}
.tk-filter-item:hover { background: var(--gold-bg); }
.tk-filter-item.on { background: var(--gold); color: var(--text-on-accent); }
.tk-filter-item i { flex: none; width: 15px; text-align: center; font-size: 13px; }
.tk-filter-item span { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tk-filter-item .cnt { flex: none; font-size: 12px; opacity: .7; font-variant-numeric: tabular-nums; }
.tk-filter-parent { font-weight: 600; }
.tk-filter-child { padding-left: 24px; font-size: 13.5px; }
/* 清单行：名称按钮（选中加载任务）+ 打开文件图标 */
.tk-filter-row { display: flex; align-items: center; gap: 4px; }
.tk-filter-row .tk-filter-item { flex: 1 1 auto; min-width: 0; margin-bottom: 2px; }
.tk-filter-open {
  flex: none; width: 26px; height: 26px; margin-bottom: 2px; padding: 0;
  border: none; border-radius: 8px; background: transparent;
  color: var(--ink-soft); cursor: pointer; font-size: 13px;
  display: flex; align-items: center; justify-content: center;
  transition: background .15s ease, color .15s ease;
}
.tk-filter-open:hover { background: var(--gold-bg); color: var(--gold); }
/* 扁平化：抵消主题对按钮加的 box-shadow（仅限本组件） */
.tk-filter-item, .tk-filter-item:hover,
.tk-filter-open, .tk-filter-open:hover { box-shadow: none !important; }
/* 极窄（≤200px）：隐藏「打开文件」按钮与计数，仅留名称与图标，避免拥挤（与清单视图一致） */
@container (max-width: 200px) {
  .tk-filter-open { display: none; }
  .tk-filter-item .cnt { display: none; }
}
</style>
