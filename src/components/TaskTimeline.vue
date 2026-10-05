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

    <!-- 全天任务：按泳道排布，跨日任务一条横跨到底（跨列条），不再每列各放一份 -->
    <div class="tk-tl-allday"
         :style="{ '--tl-lanes': alldayLanes }"
         @dragover.prevent="onAlldayDragOver($event)"
         @drop.prevent="onAlldayDrop($event)">
      <div class="tk-tl-gutter">{{ $t('app.allDay') }}</div>
      <!-- 列背景 / 今日高亮 / 拖拽目标高亮（纯视觉，不拦截事件） -->
      <div v-for="(col, i) in cols" :key="'adbg-' + col.key" class="tk-tl-adbg"
           :style="{ gridColumn: (i + 2) }"
           :class="{ today: col.key === todayKey, 'drop-target': dragOverKey === col.key }"></div>
      <!-- 横跨条：单日任务（1 列宽）与跨日任务（多列宽）共用同一套泳道 -->
      <div v-for="b in alldayBars" :key="b.t.guid" class="tk-tl-aditem"
           :class="{ done: b.t.completed || b.t.cancelled, dragging: dragGuid === b.t.guid, selected: selectedGuid === b.t.guid, 'cont-start': b.contStart, 'cont-end': b.contEnd }"
           :style="alldayBarStyle(b)"
           :draggable="!resizing" :title="helpers.dragHint(b.t)"
           @dragstart="onAdDragStart(b.t, $event)" @dragend="handlers.dragEnd"
           @click.stop="onAdClick(b.t, $event)" @dblclick.stop="handlers.open(b.t, $event)"
           @contextmenu.prevent="handlers.ctx(b.t, $event)">
        <i class="tk-check" :class="[{ done: b.t.completed || b.t.cancelled }, helpers.statusIcon(b.t)]" @click.stop.prevent="handlers.toggle(b.t)"></i>
        <span class="tk-tl-sum" :class="{ done: b.t.completed || b.t.cancelled }" v-html="helpers.richSummaryNoTags(b.t)" @click="helpers.richClick"></span>
        <!-- 跨日期横跨条右侧小字：显示开始-结束日期区间（如 10/2-10/7） -->
        <span v-if="spanRange(b.t)" class="tk-tl-adrange">{{ spanRange(b.t) }}</span>
        <!-- 跨日期横跨条：选中后首/尾出现拖动柄（拖左柄改开始日、拖右柄改结束日，另一端不变） -->
        <div v-if="isSpanSelected(b)" class="tk-tl-span-h tk-tl-span-h-l"
             :title="$t('app.spanMoveTip')"
             @pointerdown.stop.prevent="onSpanResizeDown('start', b, $event)" @mousedown.stop.prevent @click.stop.prevent @dragstart.stop.prevent></div>
        <div v-if="isSpanSelected(b)" class="tk-tl-span-h tk-tl-span-h-r"
             :title="$t('app.spanMoveTip')"
             @pointerdown.stop.prevent="onSpanResizeDown('end', b, $event)" @mousedown.stop.prevent @click.stop.prevent @dragstart.stop.prevent></div>
      </div>
    </div>

    <!-- 其他时间：早于或晚于时间轴显示范围的定时任务，统一归到时间轴上方的单独格子 -->
    <div v-if="hasOther" class="tk-tl-other">
      <div class="tk-tl-gutter">{{ $t('app.otherTime') }}</div>
      <div v-for="col in cols" :key="col.key" class="tk-tl-othercol"
           :class="{ today: col.key === todayKey }">
        <div v-for="t in col.other" :key="t.guid" class="tk-tl-aditem tk-tl-other-item"
             :class="{ done: t.completed || t.cancelled, dragging: dragGuid === t.guid, selected: selectedGuid === t.guid }"
             :style="helpers.itemColor(t)"
             :draggable="!resizing" :title="helpers.dragHint(t)"
             @dragstart="handlers.dragStart(t, $event)" @dragend="handlers.dragEnd"
             @click.stop="onAdClick(t, $event)" @dblclick.stop="handlers.open(t, $event)"
             @contextmenu.prevent="handlers.ctx(t, $event)">
          <i class="tk-check" :class="[{ done: t.completed || t.cancelled }, helpers.statusIcon(t)]" @click.stop.prevent="handlers.toggle(t)"></i>
          <div class="tk-tl-other-body">
            <span class="tk-tl-sum" :class="{ done: t.completed || t.cancelled }" v-html="helpers.richSummaryNoTags(t)" @click="helpers.richClick"></span>
            <span class="tk-tl-time">{{ helpers.timeText(t) }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 时间轴主体：整点刻度 + 日列（按设置的时间轴窗口连续显示） -->
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
             @click.stop="onBlockClick(b.t, $event)" @dblclick.stop="handlers.open(b.t)"
             @contextmenu.prevent="handlers.ctx(b.t, $event)">
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
import { layoutSpanBars, spansDays, spanDateText } from '../composables/tasks-logic.js';
// 时间轴范围（分钟）由父级经 props 传入（默认 00:00–24:00）；吸附步长整点/半点
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
    isWeek: { type: Boolean, default: false },
    // 时间轴显示窗口（分钟）：开始 / 结束，由父级按设置传入
    axisStart: { type: Number, default: 0 },
    axisEnd: { type: Number, default: 24 * 60 }
  },
  data() {
    return { resizing: null, selectedGuid: '' };
  },
  computed: {
    // 时间轴刻度：按显示窗口逐整点（小时数由 axisStart / axisEnd 决定）
    axisRows() {
      const h = this.hourH;
      const sH = this.axisStart / 60;
      const eH = this.axisEnd / 60;
      const rows = [];
      for (let hh = sH; hh < eH; hh++) {
        rows.push({ label: (hh < 10 ? '0' : '') + hh + ':00', height: h });
      }
      return rows;
    },
    // 是否存在「其他时间」任务（窗口之外的定时任务），决定是否渲染该格子
    hasOther() {
      return this.cols.some((c) => c.other && c.other.length);
    },
    // 全天任务泳道排布：跨日任务按列区间横跨，单日任务为 1 列宽
    alldayLayout() {
      const seen = new Map();
      for (const col of this.cols) {
        for (const t of (col.allDay || [])) if (!seen.has(t.guid)) seen.set(t.guid, t);
      }
      return layoutSpanBars(this.cols.map((c) => c.key), Array.from(seen.values()));
    },
    alldayBars() { return this.alldayLayout.bars; },
    alldayLanes() { return Math.max(1, this.alldayLayout.lanes); }
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
    // 全天横跨条样式：按列区间 / 泳道定位，叠加任务配色
    alldayBarStyle(b) {
      return Object.assign({
        gridColumn: (b.startIdx + 2) + ' / ' + (b.endIdx + 3),
        gridRow: String(b.lane + 1)
      }, this.helpers.itemColor(b.t));
    },
    // 全天区落点列：跨列条会挡住逐列 drop 区，故在容器层按落点 x 统一判定
    colKeyFromX(e) {
      const el = e && e.currentTarget;
      if (!el) return '';
      return this.colKeyAt(e.clientX, el);
    },
    // 按客户端 x 坐标 → 所在日期列 key（减去左侧「全天」栏 54px）
    colKeyAt(clientX, el) {
      const n = this.cols.length;
      if (n <= 0 || !el) return '';
      const rect = el.getBoundingClientRect();
      const w = rect.width - 54; // 减去左侧「全天」栏宽度
      if (w <= 0) return '';
      const x = clientX - rect.left - 54;
      let i = Math.floor((x / w) * n);
      if (i < 0) i = 0;
      if (i > n - 1) i = n - 1;
      return this.cols[i] ? this.cols[i].key : '';
    },
    onAlldayDragOver(e) {
      const key = this.colKeyFromX(e);
      if (key) this.handlers.dragOver(key, e);
    },
    onAlldayDrop(e) {
      const key = this.colKeyFromX(e);
      if (key) this.handlers.dropAllDay(key);
    },
    // 全天/跨日期条：首/尾日期柄按下。跨日期→整条平移（只改开始日）；单日全天→延伸为跨日期
    onSpanResizeDown(which, b, e) {
      const container = e.currentTarget.closest('.tk-tl-allday');
      const t = b.t;
      const isSpan = spansDays(t);
      const p2 = (n) => (n < 10 ? '0' + n : '' + n);
      const due = new Date(Number(t.dueAt));
      const dueKey = due.getFullYear() + '-' + p2(due.getMonth() + 1) + '-' + p2(due.getDate());
      let origDays = 1;
      if (isSpan) {
        const sd = new Date(Number(t.startAt)); sd.setHours(0, 0, 0, 0);
        const dd = new Date(Number(t.dueAt)); dd.setHours(0, 0, 0, 0);
        origDays = Math.max(1, Math.round((dd - sd) / 86400000) + 1); // 含首尾的原跨度天数
      }
      // 原始单日锚点（右柄延伸时固定作为开始日，避免反复覆盖 dueAt 后只跨 2 天）
      const anchorMs = new Date(dueKey + 'T00:00:00').getTime();
      this.resizing = { which, t, isSpan, origDays, dueKey, anchorMs, container, lastKey: '' };
      const barEl = e.currentTarget.closest('.tk-tl-aditem');
      if (barEl) barEl.draggable = false; // 立即关闭原生拖拽，避免「拖柄变成拖动任务」
      window.addEventListener('pointermove', this.onSpanResizeMove);
      window.addEventListener('pointerup', this.onSpanResizeUp);
    },
    onSpanResizeMove(e) {
      const r = this.resizing;
      if (!r) return;
      let key = this.colKeyAt(e.clientX, r.container); // 落点所在日期列
      if (!key) return;
      // 单日全天延伸：左柄不能越过原单日、右柄不能早于原单日（否则退化为单日）
      if (!r.isSpan) {
        if (r.which === 'start' && key > r.dueKey) key = r.dueKey;
        else if (r.which === 'end' && key < r.dueKey) key = r.dueKey;
      }
      if (key === r.lastKey) return;
      r.lastKey = key;
      // 跨日期→改所拖那一端（另一端不动）；单日全天→按柄延伸开始/结束日
      this.handlers.resizeSpan(r.t, r.which, key, r.isSpan, r.origDays, r.anchorMs);
    },
    onSpanResizeUp() {
      const r = this.resizing;
      if (!r) return;
      this.resizing = null;
      window.removeEventListener('pointermove', this.onSpanResizeMove);
      window.removeEventListener('pointerup', this.onSpanResizeUp);
      this.handlers.resizeSpanCommit(r.t);
    },
    // 像素 Y（相对列顶，窗口起点对应 0）→ 当日分钟，吸附 SNAP 并限制在窗口内
    yToMin(y) {
      const min = this.axisStart + (y / this.hourH) * 60;
      return Math.max(this.axisStart, Math.min(this.axisEnd, Math.round(min / SNAP) * SNAP));
    },
    // 单击任务：Ctrl/⌘ 时直接跳转到任务所在笔记并高亮；否则选中并显示拖动柄
    onBlockClick(t, e) {
      if (e && (e.metaKey || e.ctrlKey)) { if (this.handlers.open) this.handlers.open(t, e); return; }
      this.selectedGuid = t.guid;
    },
    clearSelection() {
      this.selectedGuid = '';
    },
    // 全天 / 其他时间条：单击选中（跨日期条由此显示首/尾日期柄），Ctrl/⌘ 单击直达编辑框
    onAdClick(t, e) {
      if (e && (e.metaKey || e.ctrlKey)) { if (this.handlers.open) this.handlers.open(t, e); return; }
      this.selectedGuid = t.guid;
    },
    // 全天/跨日期条且当前选中：显示首/尾日期拖动柄（单日全天也可拖成跨日期）
    isSpanSelected(b) {
      return this.selectedGuid === b.t.guid && (b.t.dueAllDay || spansDays(b.t));
    },
    // 跨日期任务起止区间文本（如 10/2-10/7 / 2025/12/30-2026/1/3），供右侧小字显示
    spanRange(t) {
      return spanDateText(t);
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
    // 全天/跨日期条原生拖拽改期：与块一致，拖首尾日期柄（resizing 已置位）时取消原生拖拽，
    // 否则会「拖柄变成拖动整个任务」，导致 resize 的 pointermove 根本不执行。
    onAdDragStart(t, e) {
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
          startMin = Math.max(this.axisStart, Math.min(this.axisEnd - SNAP, startMin));
        } else {
          // 单时间任务：把「原时间 + 1 小时」视为结束锚点（即该任务在时间轴上的绘制底边），
          // 上方手柄只调整开始时间；块底边不动，呈拉伸效果。
          endMin = r.startMin + DEFAULT_MIN;
          startMin = Math.max(this.axisStart, Math.min(endMin - SNAP, r.startMin + deltaMin));
        }
      } else if (r.endMin != null) {
        endMin = r.endMin + deltaMin;
        if (endMin < r.startMin + SNAP) endMin = r.startMin + SNAP;
        endMin = Math.min(this.axisEnd, endMin);
      } else {
        // 单时间任务：向下拖动底部 → 生成时间段。
        // 结束初始 = 开始 + 1 小时（与时间轴上的绘制底边一致，避免一动手就先缩回半小时），
        // 之后随拖动量增减；最小不小于开始 + SNAP，最多到当天 23:59。
        endMin = Math.min(this.axisEnd, r.startMin + DEFAULT_MIN + deltaMin);
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

/* 全天任务行：泳道网格 —— 跨日任务一条横跨多列，单日任务为 1 列宽 */
.tk-tl-allday {
  display: grid; grid-template-columns: 54px repeat(var(--tl-cols, 7), minmax(0, 1fr));
  grid-template-rows: repeat(var(--tl-lanes, 1), 30px);
  row-gap: 3px; padding: 4px 0;
  border-top: 1px solid var(--line); border-bottom: 1px solid var(--line);
}
.tk-tl-gutter {
  display: flex; align-items: flex-start; justify-content: flex-end;
  padding: 2px 8px 4px; font-size: 10.5px; color: var(--ink-soft);
}
/* 全天行左侧「全天」栏：跨所有泳道行（仅在全天网格内定位） */
.tk-tl-allday .tk-tl-gutter { grid-column: 1; grid-row: 1 / -1; }
/* 列背景 / 今日高亮 / 拖拽目标高亮（纯视觉，不拦截事件） */
.tk-tl-adbg { grid-row: 1 / -1; border-left: 1px solid var(--line); pointer-events: none; }
.tk-tl-adbg.drop-target { background: var(--gold-bg); }
.tk-tl-aditem {
  position: relative;
  display: flex; align-items: center; gap: 5px; min-width: 0; cursor: grab;
  margin: 0 1px; padding: 2px 6px; border-radius: 6px;
  background: var(--panel); font-size: 12px; color: var(--ink);
  overflow: hidden;
}
/* 选中态：描边高亮，提示可拖动调整日期 */
.tk-tl-aditem.selected { box-shadow: 0 0 0 2px var(--gold); padding-right: 16px; }
/* 跨日期横跨条右侧小字：开始-结束日期区间（如 10/2-10/7），靠右、小号、低透明度 */
.tk-tl-adrange { flex: none; margin-left: auto; padding-left: 6px; font-size: 9px; opacity: .7; font-variant-numeric: tabular-nums; white-space: nowrap; }
/* 跨日期横跨条首/尾日期拖动柄：平时隐藏，选中时显示；靠左右内边缘，避免被 overflow 裁切 */
.tk-tl-span-h {
  position: absolute; top: 0; bottom: 0; width: 10px;
  cursor: ew-resize; z-index: 4; opacity: 0; pointer-events: none;
  transition: opacity .12s ease;
}
.tk-tl-span-h::before {
  content: ''; position: absolute; top: 22%; bottom: 22%; left: 3px;
  width: 4px; border-radius: 3px; background: var(--gold);
  box-shadow: 0 0 0 2px var(--paper);
}
.tk-tl-span-h-l { left: 0; }
.tk-tl-span-h-r { right: 0; }
.tk-tl-span-h-r::before { left: auto; right: 3px; }
.tk-tl-aditem.selected .tk-tl-span-h { opacity: 1; pointer-events: auto; }
.tk-tl-aditem.selected .tk-tl-span-h:hover::before { filter: brightness(1.12); }
.tk-tl-aditem .tk-check { flex: none; }
.tk-tl-aditem .tk-tl-sum { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 跨日横跨条：续接端（非真实起止）不收圆角，以示「仍在延续」 */
.tk-tl-aditem.cont-start { border-top-left-radius: 0; border-bottom-left-radius: 0; }
.tk-tl-aditem.cont-end { border-top-right-radius: 0; border-bottom-right-radius: 0; }
.tk-tl-aditem .tk-tl-time { margin-left: auto; padding-left: 6px; }
/* 全天 / 凌晨项：已完成、已取消置灰（与月视图 .cel-task.done 一致） */
.tk-tl-aditem.done { color: var(--ink-soft); opacity: .6; }
/* 其他时间行：早于 / 晚于时间轴窗口的定时任务，归到时间轴上方的单独格子 */
.tk-tl-other {
  display: grid; grid-template-columns: 54px repeat(var(--tl-cols, 7), minmax(0, 1fr));
  border-bottom: 1px solid var(--line);
}
.tk-tl-other .tk-tl-gutter { white-space: pre-line; line-height: 1.25; text-align: right; }
.tk-tl-othercol { display: flex; flex-direction: column; gap: 3px; min-height: 34px; padding: 4px; border-left: 1px solid var(--line); }
.tk-tl-othercol.today { background: transparent; }
/* 其他时间任务项：标题在上、时间在标题下方 */
.tk-tl-other-item { align-items: flex-start; line-height: 1.3; padding: 3px 6px; }
.tk-tl-other-body { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.tk-tl-aditem.tk-tl-other-item .tk-tl-sum { white-space: nowrap; }
.tk-tl-aditem.tk-tl-other-item .tk-tl-time { margin-left: 0; padding-left: 0; }

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
}
/* 周视图进一步收窄（面板 ≤480px，等价于窗口或面板 ≤480）：任务时间文字再小一些 */
@container (max-width: 480px) {
  .tk-tl-week .tk-tl-time { font-size: 10px; }
}
</style>
