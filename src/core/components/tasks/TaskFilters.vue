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
          <span>{{ g.label }}</span>
          <span class="tk-tagdot" :class="{ empty: !hexOf(g.tag) }" :style="hexOf(g.tag) ? { background: hexOf(g.tag) } : null" :title="$t('app.tagColorTip')"
                @click.stop="openColorPop(g.tag, $event)"></span>
          <span class="cnt">{{ g.n }}</span>
        </button>
        <button v-for="c in g.items" :key="c.tag" class="tk-filter-item tk-filter-child" type="button"
                :class="{ on: tagFilter === c.tag }" @click="$emit('toggle-tag', c.tag)">
          <span>{{ c.label }}</span>
          <span class="tk-tagdot" :class="{ empty: !hexOf(c.tag) }" :style="hexOf(c.tag) ? { background: hexOf(c.tag) } : null" :title="$t('app.tagColorTip')"
                @click.stop="openColorPop(c.tag, $event)"></span>
          <span class="cnt">{{ c.n }}</span>
        </button>
      </div>
      <button v-for="t in tagTree.loose" :key="t.tag" class="tk-filter-item" type="button"
              :class="{ on: tagFilter === t.tag }" @click="$emit('toggle-tag', t.tag)">
        <i class="la la-tag"></i><span>{{ t.label }}</span>
        <span class="tk-tagdot" :class="{ empty: !hexOf(t.tag) }" :style="hexOf(t.tag) ? { background: hexOf(t.tag) } : null" :title="$t('app.tagColorTip')"
              @click.stop="openColorPop(t.tag, $event)"></span>
        <span class="cnt">{{ t.n }}</span>
      </button>
    </template>

    <!-- 清单：frontmatter tags 命中识别标记的 md 文件，文件名即清单名。
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

    <!-- 标签取色面板（issue #8）：预设色板 + 自定义（+ 弹系统取色器）+ 保存 / 取消 -->
    <div v-if="colorPop" class="tk-colorpop" :style="{ left: colorPop.x + 'px', top: colorPop.y + 'px' }"
         @pointerdown.stop @click.stop>
      <div class="tk-colorpop-row">
        <button v-for="c in presets" :key="c" type="button" class="tk-colorpop-swatch"
                :class="{ on: colorPop.color === c }" :style="{ background: c }"
                @click="colorPop.color = c"></button>
        <span class="tk-colorpop-custom" :title="$t('app.tagColorCustom')">
          <i class="la la-plus"></i>
          <input type="color" :value="colorPop.color" @input="colorPop.color = $event.target.value" />
        </span>
      </div>
      <div class="tk-colorpop-actions">
        <button type="button" class="tk-colorpop-btn" @click="closeColorPop">{{ $t('common.cancel') }}</button>
        <button type="button" class="tk-colorpop-btn primary" @click="saveColorPop">{{ $t('common.save') }}</button>
      </div>
    </div>
  </aside>
</template>

<script>
// 列表视图左侧筛选侧栏（日期 / 标签 / 清单）。
// 纯展示组件：所有选择动作上抛，标签与清单的互斥等逻辑由容器处理。
export default {
  name: 'TaskFilters',
  data() {
    return {
      // 取色面板状态：{ tag, color, x, y } | null；x/y 为相对侧栏的 absolute 坐标
      colorPop: null,
      // 预设色板（issue #8）：与设置页标签颜色分组一致的常用色
      presets: ['#e5484d', '#e5683c', '#d9a514', '#3fa144', '#2aa198',
        '#3b82f6', '#7c6bd9', '#c15bc0', '#8d6e63', '#6b7280']
    };
  },
  methods: {
    // 标签已配置颜色时返回 #hex（供圆点实色显示），否则空串（空心圆点）
    hexOf(tag) {
      const c = this.tagColors && this.tagColors[tag];
      return /^#[0-9a-fA-F]{6}$/.test(String(c || '')) ? c : '';
    },
    // 打开取色面板：absolute 定位到圆点下方（侧栏有 container-type，不能用 fixed）
    openColorPop(tag, e) {
      const aside = this.$el;
      const a = aside.getBoundingClientRect();
      const d = e.currentTarget.getBoundingClientRect();
      // 圆点位置换算成侧栏内坐标（含滚动偏移），再水平收进面板宽度内
      const popW = 172;
      let x = d.left - a.left + aside.scrollLeft;
      let y = d.bottom - a.top + aside.scrollTop + 6;
      x = Math.max(4, Math.min(x, aside.clientWidth - popW - 4));
      this.colorPop = { tag, color: this.hexOf(tag) || '#7c6bd9', x, y };
      this.bindPopClosers();
    },
    closeColorPop() {
      this.colorPop = null;
      this.unbindPopClosers();
    },
    // 保存：把选中的颜色上抛给容器（TasksApp.setTagColor 落盘并刷新各视图）
    saveColorPop() {
      if (this.colorPop) this.$emit('set-tag-color', this.colorPop.tag, this.colorPop.color);
      this.closeColorPop();
    },
    // 面板打开期间：点面板外 / 滚动 / Esc 关闭。
    // pointerdown 必须用冒泡阶段（不能用捕获）：面板靠 @pointerdown.stop 拦截，
    // 捕获阶段 document 先于面板触发，会导致点预设色块面板立即关闭
    bindPopClosers() {
      if (this._popClosers) return;
      const onDocDown = () => this.closeColorPop();
      const onKey = (ev) => { if (ev.key === 'Escape') this.closeColorPop(); };
      const onScroll = () => this.closeColorPop();
      document.addEventListener('pointerdown', onDocDown);
      document.addEventListener('keydown', onKey, true);
      window.addEventListener('scroll', onScroll, true);
      this._popClosers = [
        ['pointerdown', onDocDown, document, false],
        ['keydown', onKey, document, true],
        ['scroll', onScroll, window, true]
      ];
    },
    unbindPopClosers() {
      if (!this._popClosers) return;
      for (const [type, fn, target, capture] of this._popClosers) target.removeEventListener(type, fn, capture);
      this._popClosers = null;
    }
  },
  beforeUnmount() {
    this.unbindPopClosers();
  },
  props: {
    dateFilters: { type: Array, default: () => [] },
    dateFilter: { type: String, default: 'all' },
    // 标签树：{ groups: [{label, tag, n, items}], loose: [{label, tag, n}] }
    tagTree: { type: Object, required: true },
    tagFilter: { type: String, default: '' },
    // 标签颜色映射（issue #8）：圆点据此显示实色 / 空心
    tagColors: { type: Object, default: () => ({}) },
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
  /* 取色面板 .tk-colorpop 的定位基准（侧栏有 container-type，内部不能用 fixed） */
  position: relative;
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
/* 标签颜色圆点（issue #8）：纯 CSS 圆点负责视觉（已配置实色底、未配置空心描边），
   透明 color input 覆盖其上负责弹系统取色器。
   用 .tk-filter-item / .tk-filter-row 前缀提权，压掉 .tk-filter-item span 的 flex 撑满规则
   （否则圆点被拉成椭圆） */
.tk-filter-item .tk-tagdot,
.tk-filter-row .tk-tagdot {
  position: relative; flex: none; width: 12px; height: 12px;
  border: 1px solid var(--ink-soft); border-radius: 50%;
  display: inline-block; cursor: pointer;
  transition: transform .12s ease;
}
.tk-filter-item .tk-tagdot:not(.empty),
.tk-filter-row .tk-tagdot:not(.empty) { border-color: transparent; }
.tk-filter-item .tk-tagdot:hover,
.tk-filter-row .tk-tagdot:hover { transform: scale(1.15); }
.tk-tagdot input {
  position: absolute; left: 0; top: 0; width: 100%; height: 100%;
  opacity: 0; border: none; padding: 0; margin: 0; cursor: pointer;
}
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

/* ===== 标签取色面板（issue #8）：预设色板 + 自定义 + 保存 / 取消 ===== */
.tk-colorpop {
  position: absolute; z-index: 50; width: 172px; box-sizing: border-box;
  background: var(--panel); border: 1px solid var(--line); border-radius: 10px;
  box-shadow: 0 4px 16px rgba(0,0,0,.18); padding: 10px;
  display: flex; flex-direction: column; gap: 8px;
}
.tk-colorpop-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
/* 预设色块：圆形，选中时描边 */
.tk-colorpop-swatch {
  flex: none; width: 20px; height: 20px; border-radius: 50%;
  border: none; padding: 0; cursor: pointer;
  box-shadow: inset 0 0 0 1px rgba(0,0,0,.12);
  transition: transform .12s ease;
}
.tk-colorpop-swatch:hover { transform: scale(1.12); }
.tk-colorpop-swatch.on { box-shadow: 0 0 0 2px var(--panel), 0 0 0 3.5px var(--ink); }
/* + 自定义：瓷砖样式，透明 color input 覆盖其上弹系统取色器 */
.tk-colorpop-custom {
  position: relative; flex: none; width: 20px; height: 20px; border-radius: 50%;
  border: 1px dashed var(--ink-soft); color: var(--ink-soft);
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 10px; cursor: pointer; box-sizing: border-box;
}
.tk-colorpop-custom:hover { color: var(--ink); border-color: var(--ink); }
.tk-colorpop-custom input {
  position: absolute; left: 0; top: 0; width: 100%; height: 100%;
  opacity: 0; border: none; padding: 0; margin: 0; cursor: pointer;
}
.tk-colorpop-actions { display: flex; justify-content: flex-end; gap: 6px; }
.tk-colorpop-btn {
  padding: 3px 10px; font: inherit; font-size: 12px;
  border: 1px solid var(--line); border-radius: 6px; background: transparent;
  color: var(--ink); cursor: pointer; box-shadow: none !important;
  transition: background .15s ease;
}
.tk-colorpop-btn:hover { background: var(--gold-bg); }
.tk-colorpop-btn.primary { background: var(--gold); border-color: var(--gold); color: var(--text-on-accent); }
.tk-colorpop-btn.primary:hover { filter: brightness(1.05); background: var(--gold); }
</style>
