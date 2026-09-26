<template>
  <div class="tk-tl" :class="{ 'tk-tl-week': isWeek }" :style="{ '--hour': hourH + 'px', '--tl-cols': cols.length }">
    <!-- 表头：日期 -->
    <div class="tk-tl-top">
      <div class="tk-tl-corner"></div>
      <div v-for="col in cols" :key="col.key" class="tk-tl-dayhead"
           :class="{ today: col.key === todayKey, 'drop-target': dragOverKey === col.key }">
        <div class="tk-tl-dh-row1">
          <span class="tk-tl-wd">{{ $t('app.weekShort', { wd: col.weekday }) }}</span>
          <span class="tk-tl-dt">{{ col.md }}</span>
          <span v-if="col.label" class="tk-tl-today-badge">{{ col.label }}</span>
          <span v-else-if="col.label" class="tk-tl-rel">{{ col.label }}</span>
          <button class="tk-add" @click="handlers.add(col.key)" :title="$t('app.addDayTask')"><i class="la la-plus-circle"></i></button>
        </div>
        <div class="tk-tl-dh-row2">
          <!-- 法定节假日：休/班 自绘徽标（对齐月视图） -->
          <span v-if="helpers.holidayOf(col.key)" class="tk-tl-hb" :class="helpers.holidayOf(col.key).rest ? 'is-rest' : 'is-work'" :title="helpers.holidayOf(col.key).name">
            {{ helpers.holidayOf(col.key).rest ? $t('app.rest') : $t('app.work') }}
          </span>
          <span class="tk-tl-lunar">{{ helpers.lunarDayText(col.date) }}</span>
          <span v-if="helpers.lunarTagText(col.date)" class="tk-tl-lunar-tag">{{ helpers.lunarTagText(col.date) }}</span>
        </div>
      </div>
    </div>

    <!-- 全天任务 -->
    <div class="tk-tl-allday">
      <div class="tk-tl-gutter">{{ $t('app.allDay') }}</div>
      <div v-for="col in cols" :key="col.key" class="tk-tl-adcol"
           :class="{ today: col.key === todayKey, 'drop-target': dragOverKey === col.key }"
           @dragover.prevent="handlers.dragOver(col.key, $event)"
           @drop.prevent="handlers.dropAllDay(col.key)">
        <div v-for="t in col.allDay" :key="t.guid" class="tk-tl-aditem"
             :class="{ done: t.completed || t.cancelled, dragging: dragGuid === t.guid }"
             :style="helpers.itemColor(t)"
             draggable="true" :title="helpers.dragHint(t)"
             @dragstart="handlers.dragStart(t, $event)" @dragend="handlers.dragEnd" @click="handlers.open(t, $event)">
          <i class="tk-check" :class="[{ done: t.completed || t.cancelled }, helpers.statusIcon(t)]" @click.stop.prevent="handlers.toggle(t)"></i>
          <span class="tk-tl-sum" :class="{ done: t.completed || t.cancelled }" v-html="helpers.richSummaryNoTags(t)" @click="helpers.richClick"></span>
        </div>
      </div>
    </div>

    <!-- 凌晨任务（00:00–07:00）：以列表显示，不进时间轴 -->
    <div class="tk-tl-early">
      <div class="tk-tl-gutter">00:00<br>–07:00</div>
      <div v-for="col in cols" :key="col.key" class="tk-tl-earlycol"
           :class="{ today: col.key === todayKey, 'drop-target': dragOverKey === col.key }"
           @dragover.prevent="handlers.dragOver(col.key, $event)"
           @drop.prevent="handlers.dropEarly(col.key)">
        <div v-for="t in col.early" :key="t.guid" class="tk-tl-aditem"
             :class="{ done: t.completed || t.cancelled, dragging: dragGuid === t.guid }"
             :style="helpers.itemColor(t)"
             draggable="true" :title="helpers.dragHint(t)"
             @dragstart="handlers.dragStart(t, $event)" @dragend="handlers.dragEnd" @click="handlers.open(t, $event)">
          <i class="tk-check" :class="[{ done: t.completed || t.cancelled }, helpers.statusIcon(t)]" @click.stop.prevent="handlers.toggle(t)"></i>
          <span class="tk-tl-sum" :class="{ done: t.completed || t.cancelled }" v-html="helpers.richSummaryNoTags(t)" @click="helpers.richClick"></span>
          <span class="tk-tl-time">{{ helpers.timeText(t) }}</span>
        </div>
      </div>
    </div>

    <!-- 时间轴主体：整点刻度 + 日列 -->
    <div class="tk-tl-grid">
      <div class="tk-tl-axis">
        <div v-for="(r, i) in axisRows" :key="i" class="tk-tl-tick" :style="{ height: r.height + 'px' }">
          <span>{{ r.label }}</span>
        </div>
      </div>
      <div v-if="nowTop !== null" class="tk-tl-now" :style="{ top: nowTop + 'px' }"></div>
      <div v-for="col in cols" :key="col.key" class="tk-tl-col"
           :class="{ today: col.key === todayKey, 'drop-target': dragOverKey === col.key }"
           @dragover.prevent="handlers.dragOver(col.key, $event)"
           @drop.prevent="handlers.dropTimeline(col.key, $event)"
           @click="clearSelection" @dblclick="onColDblClick(col, $event)">
        <div v-if="helpers.dropInfo(col.key)" class="tk-tl-dropline" :style="{ top: helpers.dropInfo(col.key).top + 'px' }">
          <span class="tk-tl-drop-time">{{ helpers.dropInfo(col.key).label }}</span>
        </div>
        <div v-for="b in col.blocks" :key="b.t.guid" class="tk-tl-block"
             :class="{ done: b.t.completed || b.t.cancelled, dragging: dragGuid === b.t.guid, selected: selectedGuid === b.t.guid }"
             :style="helpers.blockStyle(b)"
             :draggable="!resizing" :title="helpers.dragHint(b.t)"
             @dragstart="onBlockDragStart(b.t, $event)" @dragend="handlers.dragEnd"
             @click.stop="onBlockClick(b.t, $event)" @dblclick.stop="handlers.open(b.t)">
          <div class="tk-tl-rsz tk-tl-rsz-top" :title="$t('app.resizeStartTip')"
               @pointerdown.stop.prevent="onResizeDown('top', b, $event)" @mousedown.stop.prevent @click.stop.prevent
               @dragstart.stop.prevent></div>
          <div class="tk-tl-bc">
            <div class="tk-tl-bt">
              <i class="tk-check" :class="[{ done: b.t.completed || b.t.cancelled }, helpers.statusIcon(b.t)]" @click.stop.prevent="handlers.toggle(b.t)"></i>
              <span class="tk-tl-sum" :class="{ done: b.t.completed || b.t.cancelled }" v-html="helpers.richSummaryNoTags(b.t)" @click="helpers.richClick"></span>
            </div>
            <span class="tk-tl-time">{{ helpers.timeText(b.t) }}</span>
          </div>
          <div class="tk-tl-rsz tk-tl-rsz-bot" :title="$t('app.resizeEndTip')"
               @pointerdown.stop.prevent="onResizeDown('bottom', b, $event)" @mousedown.stop.prevent @click.stop.prevent
               @dragstart.stop.prevent></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
// 时间轴范围与吸附步长（分钟）：07:00 起、23:59 止，整点/半点吸附
const AXIS_START = 7 * 60;
const AXIS_END = 23 * 60 + 59;
const SNAP = 30;
// 单时间任务在时间轴上的绘制时长（分钟），与 WeekDayView.layoutBlocks 的 DEFAULT_MIN 一致
const DEFAULT_MIN = 60;
export default {
  name: 'TaskTimeline',
  props: {
    cols: { type: Array, required: true },
    todayKey: { type: String, required: true },
    hourH: { type: Number, default: 48 },
    nowTop: { type: Number, default: null },
    dragOverKey: { type: String, default: '' },
    dragGuid: { type: String, default: '' },
    helpers: { type: Object, required: true },
    handlers: { type: Object, required: true },
    isWeek: { type: Boolean, default: false }
  },
  data() {
    return { resizing: null, selectedGuid: '' };
  },
  computed: {
    // 时间轴刻度：从 07:00 起逐整点（00:00–07:00 不作为时间轴，改用列表显示）
    axisRows() {
      const h = this.hourH;
      const rows = [];
      for (let hh = 7; hh <= 23; hh++) {
        rows.push({ label: (hh < 10 ? '0' : '') + hh + ':00', top: (hh - 7) * h, height: h });
      }
      return rows;
    }
  },
  beforeDestroy() {
    if (this.resizing) {
      window.removeEventListener('pointermove', this.onResizeMove);
      window.removeEventListener('pointerup', this.onResizeUp);
    }
  },
  methods: {
    minOfDay(ms) {
      const d = new Date(ms);
      return d.getHours() * 60 + d.getMinutes();
    },
    // 像素 Y（相对列顶，07:00 对应 0）→ 当日分钟，吸附 SNAP 并限制在时间轴范围内
    yToMin(y) {
      const min = AXIS_START + (y / this.hourH) * 60;
      return Math.max(AXIS_START, Math.min(AXIS_END, Math.round(min / SNAP) * SNAP));
    },
    // 单击任务：Ctrl/⌘ 时直接跳转到任务所在笔记并高亮；否则选中并显示拖动柄
    onBlockClick(t, e) {
      if (e && (e.metaKey || e.ctrlKey)) { if (this.handlers.open) this.handlers.open(t, e); return; }
      this.selectedGuid = t.guid;
    },
    clearSelection() {
      this.selectedGuid = '';
    },
    // 双击时间轴空白处：在落点时刻新增任务
    onColDblClick(col, e) {
      let y = 0;
      if (e && e.currentTarget) {
        const rect = e.currentTarget.getBoundingClientRect();
        y = e.clientY - rect.top;
      }
      if (this.handlers.addAt) this.handlers.addAt(col.key, this.yToMin(y));
    },
    // 块原生拖拽改期：拖动手柄调整时间时（resizing 已置位）取消原生拖拽，避免「移动整块」
    onBlockDragStart(t, e) {
      if (this.resizing) { e.preventDefault(); return; }
      this.handlers.dragStart(t, e);
    },
    // 上下手柄拖动：实时改开始/结束时间（点手柄把单时间任务拉成时间段）
    onResizeDown(which, b, e) {
      const t = b.t;
      this.resizing = {
        which,
        t,
        startMin: this.minOfDay(t.dueAt),
        endMin: t.dueEndAt ? this.minOfDay(t.dueEndAt) : null,
        y0: e.clientY
      };
      // 关键：立即同步关闭块的原生拖拽。
      // `:draggable="!resizing"` 是 Vue 异步补丁（微任务刷新），在 pointerdown 与
      // 刷新之间 Chromium 可能已锁定拖拽意图，导致「拖手柄变成拖动任务」。
      // 这里直接改 DOM 属性，绕过异步补丁；pointerup 后由 Vue 绑定恢复。
      const blockEl = e.currentTarget && e.currentTarget.closest('.tk-tl-block');
      if (blockEl) blockEl.draggable = false;
      window.addEventListener('pointermove', this.onResizeMove);
      window.addEventListener('pointerup', this.onResizeUp);
    },
    onResizeMove(e) {
      const r = this.resizing;
      if (!r) return;
      const deltaMin = Math.round(((e.clientY - r.y0) / this.hourH) * 60 / SNAP) * SNAP;
      let { startMin, endMin } = r;
      if (r.which === 'top') {
        if (r.endMin != null) {
          // 时间段任务：结束固定，拖动上方手柄调整开始
          startMin = r.startMin + deltaMin;
          if (startMin > r.endMin - SNAP) startMin = r.endMin - SNAP;
          startMin = Math.max(AXIS_START, Math.min(AXIS_END - SNAP, startMin));
        } else {
          // 单时间任务：把「原时间 + 1 小时」视为结束锚点（即该任务在时间轴上的绘制底边），
          // 上方手柄只调整开始时间；块底边不动，呈拉伸效果。
          endMin = r.startMin + DEFAULT_MIN;
          startMin = Math.max(AXIS_START, Math.min(endMin - SNAP, r.startMin + deltaMin));
        }
      } else if (r.endMin != null) {
        endMin = r.endMin + deltaMin;
        if (endMin < r.startMin + SNAP) endMin = r.startMin + SNAP;
        endMin = Math.min(AXIS_END, endMin);
      } else {
        // 单时间任务：向下拖动底部 → 生成时间段。
        // 结束初始 = 开始 + 1 小时（与时间轴上的绘制底边一致，避免一动手就先缩回半小时），
        // 之后随拖动量增减；最小不小于开始 + SNAP，最多到当天 23:59。
        endMin = Math.min(AXIS_END, r.startMin + DEFAULT_MIN + deltaMin);
        if (endMin < r.startMin + SNAP) endMin = r.startMin + SNAP;
      }
      this.handlers.resize(r.t, startMin, endMin);
    },
    onResizeUp() {
      const r = this.resizing;
      if (!r) return;
      this.resizing = null;
      window.removeEventListener('pointermove', this.onResizeMove);
      window.removeEventListener('pointerup', this.onResizeUp);
      this.handlers.resizeCommit(r.t);
    }
  }
};
</script>

<style scoped>
.tk-tl { flex: 1 1 auto; padding-bottom: 8px; min-height: 0; overflow: auto; align-self: stretch; container-type: inline-size; }
/* 表头：日期行（吸顶） */
.tk-tl-top {
  display: grid; grid-template-columns: 54px repeat(var(--tl-cols, 7), minmax(0, 1fr));
  position: sticky; top: 0; z-index: 3;
  background: var(--background-primary);
}
.tk-tl-dayhead {
  display: flex; flex-direction: column; align-items: stretch; gap: 2px; min-width: 0;
  padding: 6px 8px; border-left: 1px solid var(--line);
}
/* 第一行：周几 + 日期 + 今日/相对徽标 + 添加；第二行：农历 + 节气 + 休/班 */
.tk-tl-dh-row1 { display: flex; align-items: center; gap: 6px; min-width: 0; }
.tk-tl-dh-row2 { display: flex; align-items: center; gap: 6px; min-width: 0; }
.tk-tl-wd { flex: none; font-weight: 700; font-size: 13px; color: var(--ink); }
.tk-tl-dt { min-width: 0; color: var(--ink-soft); font-size: 11px; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* 周视图表头：节假日休/班徽标 + 农历（对齐月视图 .cel-hb/.cel-lunar） */
.tk-tl-hb { flex: none; font-size: 8px; font-weight: 700; line-height: 12px; padding: 0 3px; border-radius: 9px; }
.tk-tl-hb.is-rest { color: var(--text-on-accent); background: var(--c-done); }
.tk-tl-hb.is-work { color: var(--text-on-accent); background: var(--c-cancel); }
.tk-tl-lunar { flex: none; font-size: 11px; color: var(--ink-soft); white-space: nowrap; }
.tk-tl-lunar-tag { flex: none; font-size: 11px; color: var(--c-cancel); white-space: nowrap; }
.tk-tl-today-badge { flex: none; background: #e53935; color: #fff; font-size: 10.5px; font-weight: 600; line-height: 1; padding: 2px 7px; border-radius: 999px; }
.tk-tl-rel { flex: none; color: var(--ink-soft); font-size: 11px; }
.tk-tl-dayhead.today .tk-tl-wd { color: var(--gold); }
/* 新增按钮：透明背景 + la-plus-circle 线性图标，默认隐藏，hover 日列才显示 */
.tk-tl-dayhead .tk-add {
  margin-left: auto; opacity: 0; flex: none; width: auto; height: auto; border: none; border-radius: 0;
  background: transparent; color: var(--gold); font-size: 16px; line-height: 1; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  transition: opacity .15s ease, color .15s ease; box-shadow: none;
}
.tk-tl-dayhead .tk-add i { font-size: 16px; line-height: 1; }
.tk-tl-dayhead:hover .tk-add { opacity: 1; }
.tk-tl-dayhead .tk-add:hover { filter: brightness(1.1); }

/* 全天任务行 */
.tk-tl-allday {
  display: grid; grid-template-columns: 54px repeat(var(--tl-cols, 7), minmax(0, 1fr));
  border-top: 1px solid var(--line); border-bottom: 1px solid var(--line);
}
.tk-tl-gutter { display: flex; align-items: flex-start; justify-content: flex-end; padding: 6px 8px 4px; font-size: 10.5px; color: var(--ink-soft); }
.tk-tl-adcol { display: flex; flex-direction: column; gap: 3px; min-height: var(--hour); padding: 4px; border-left: 1px solid var(--line); }
.tk-tl-adcol.today { background: transparent; }
.tk-tl-dayhead.drop-target { box-shadow: none; }
.tk-tl-adcol.drop-target { box-shadow: none; }
.tk-tl-aditem {
  display: flex; align-items: center; gap: 5px; min-width: 0; cursor: grab;
  padding: 2px 6px; border-radius: 6px;
  background: var(--panel); font-size: 12px; color: var(--ink);
  line-height: 30px;
}
.tk-tl-aditem .tk-check { flex: none; }
.tk-tl-aditem .tk-tl-sum { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tk-tl-aditem .tk-tl-time { margin-left: auto; padding-left: 6px; }
/* 全天 / 凌晨项：已完成、已取消置灰（与月视图 .cel-task.done 一致） */
.tk-tl-aditem.done { color: var(--ink-soft); opacity: .6; }

/* 凌晨任务行（00:00–07:00）：列表形式，不进时间轴 */
.tk-tl-early {
  display: grid; grid-template-columns: 54px repeat(var(--tl-cols, 7), minmax(0, 1fr));
}
.tk-tl-early .tk-tl-gutter { line-height: 1.25; text-align: right; }
.tk-tl-earlycol { display: flex; flex-direction: column; gap: 3px; min-height: 34px; padding: 4px; border-left: 1px solid var(--line); }
.tk-tl-earlycol.today { background: transparent; }
.tk-tl-earlycol.drop-target { box-shadow: none; }

/* 主体：整点刻度 + 日列（小时线用重复渐变绘制） */
.tk-tl-grid { display: grid; grid-template-columns: 54px repeat(var(--tl-cols, 7), minmax(0, 1fr)); position: relative; }
/* 当前时间线：跨所有日列，主题金色虚线；左端小圆点落在时间轴刻度区 */
.tk-tl-now { position: absolute; left: 54px; right: 0; height: 0; border-top: 2px dashed var(--gold); opacity: .8; pointer-events: none; z-index: 6; }
.tk-tl-now::before { content: ''; position: absolute; left: -5px; top: -5px; width: 9px; height: 9px; border-radius: 50%; background: var(--gold); box-shadow: 0 0 0 2px var(--paper); }
.tk-tl-axis { display: flex; flex-direction: column; border-top: 1px solid var(--line); }
.tk-tl-tick { position: relative; border-bottom: 1px solid var(--line); box-sizing: border-box; }
.tk-tl-tick > span { position: absolute; top: -7px; right: 8px; font-size: 10.5px; color: var(--ink-soft); font-variant-numeric: tabular-nums; white-space: nowrap; }
.tk-tl-axis .tk-tl-tick:first-child > span { top: 4px; }
.tk-tl-col {
  position: relative; border-left: 1px solid var(--line);
  background-image: repeating-linear-gradient(to bottom, var(--line) 0 1px, transparent 1px var(--hour));
}
.tk-tl-dropline {
  position: absolute;
  left: 0;
  right: 0;
  height: 0;
  border-top: 2px dashed var(--accent, #4a90d9);
  pointer-events: none;
  z-index: 6;
}
.tk-tl-drop-time {
  position: absolute;
  left: 2px;
  top: -9px;
  font-size: 9.5px;
  line-height: 14px;
  color: #fff;
  background: var(--accent, #4a90d9);
  padding: 0 3px;
  border-radius: 3px;
  font-variant-numeric: tabular-nums;
}
.tk-tl-col.today { background-color: transparent; }
.tk-tl-col.drop-target { box-shadow: none; }

/* 时间轴任务块 */
.tk-tl-block {
  position: absolute; box-sizing: border-box; overflow: visible; cursor: grab;
  border-radius: 7px;
  transition: filter .15s ease;
}
.tk-tl-block:hover { filter: brightness(.97); }
.tk-tl-block.dragging { opacity: .5; }
/* 文字内容包裹层：负责原本的裁剪、内边距与字号，块本身 overflow:visible 让手柄能溢出显示 */
.tk-tl-bc {
  position: absolute; inset: 0; overflow: hidden; border-radius: 7px;
  padding: 3px 6px; font-size: 11.5px; line-height: 1.35;
}
.tk-tl-bt { display: flex; align-items: center; gap: 5px; min-width: 0; line-height: 24px; }
.tk-tl-bt .tk-check { flex: none; }
.tk-tl-bt .tk-tl-sum { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tk-tl-block .tk-tl-sum { font-weight: 400; }
.tk-tl-time { display: block; margin-left: 24px; color: var(--ink-soft); font-variant-numeric: tabular-nums; }
.tk-tl-block.done { opacity: .45; }
/* 选中态：描边高亮，提示可拖动调整 */
.tk-tl-block.selected { box-shadow: 0 0 0 2px var(--gold); z-index: 5; }
/* 上下拖动调整时间的手柄：主题色小圆圈，平时隐藏，仅选中(可操作)时显示 */
.tk-tl-rsz {
  position: absolute; width: 11px; height: 11px; border-radius: 50%;
  background: var(--gold); box-shadow: 0 0 0 2px var(--paper), 0 1px 3px rgba(0,0,0,.35);
  cursor: ns-resize; z-index: 6; opacity: 0; pointer-events: none;
  transition: opacity .12s ease, transform .12s ease;
}
.tk-tl-rsz-top { top: -6px; left: 3px; }   /* 上方手柄靠左 */
.tk-tl-rsz-bot { bottom: -6px; right: 3px; } /* 下方手柄靠右 */
.tk-tl-block.selected .tk-tl-rsz { opacity: 1; pointer-events: auto; }
.tk-tl-block.selected .tk-tl-rsz:hover { transform: scale(1.18); }

/* 窄屏（面板 ≤700px，等价于窗口或面板 ≤700）：周/日视图表头收紧
   1) 隐藏「今日」徽标，省出表头横向空间
   2) 农历 / 休班 信息由横排改为纵向分行，避免窄列被挤压换行
   根 .tk-tl 为 container-type: inline-size 容器，其宽度 ≤ 窗口宽度，
   故「面板 ≤700」已涵盖「窗口 ≤700」，无需再写 @media（窗口）块。 */
@container (max-width: 700px) {
  .tk-tl-today-badge { display: none; }
  .tk-tl-dh-row2 { flex-direction: column; align-items: flex-start; gap: 1px; }
  /* 仅周视图：隐藏任务前方的圆圈操作区（日视图保留圆圈）；标题换行、行高收紧 */
  .tk-tl-week .tk-tl-aditem .tk-check,
  .tk-tl-week .tk-tl-bt .tk-check { display: none; }
  .tk-tl-week .tk-tl-aditem .tk-tl-sum,
  .tk-tl-week .tk-tl-bt .tk-tl-sum { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden; white-space: normal; word-break: break-word; line-height: 1; text-overflow: ellipsis; text-align: justify; }
  .tk-tl-week .tk-tl-time { margin-left: 0; }
  /* 凌晨(00:00–07:00)任务：名称换行后，时间落到新行显示 */
  .tk-tl-week .tk-tl-early .tk-tl-aditem { flex-wrap: wrap; }
  .tk-tl-week .tk-tl-early .tk-tl-time { flex-basis: 100%; }
}
/* 周视图进一步收窄（面板 ≤480px，等价于窗口或面板 ≤480）：任务时间文字再小一些 */
@container (max-width: 480px) {
  .tk-tl-week .tk-tl-time { font-size: 10px; }
}
</style>
