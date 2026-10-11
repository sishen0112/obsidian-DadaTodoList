<template>
  <div class="tk-dp" :class="{ 'is-disabled': disabled }">
    <div class="tk-dp__control">
      <input
        ref="input"
        class="tk-dp__input"
        type="text"
        readonly
        :value="display"
        :placeholder="placeholder"
        :disabled="disabled"
        @focus="openPanel"
        @click="openPanel"
        @keydown="onKeydown"
      />
    </div>
    <transition name="tk-fade">
      <div v-if="open && !disabled" class="tk-dp__panel" @mousedown.prevent @click.stop>
        <div class="tk-dp__header">
          <button type="button" class="tk-dp__nav" :aria-label="$t('app.prevYearTitle')" aria-label-position="bottom" @mousedown.stop.prevent="stepYear(-1)">«</button>
          <button type="button" class="tk-dp__nav" :aria-label="$t('app.prevMonthTitle')" aria-label-position="bottom" @mousedown.stop.prevent="stepMonth(-1)">‹</button>
          <span class="tk-dp__title">{{ monthLabel }}</span>
          <button type="button" class="tk-dp__nav" :aria-label="$t('app.nextMonthTitle')" aria-label-position="bottom" @mousedown.stop.prevent="stepMonth(1)">›</button>
          <button type="button" class="tk-dp__nav" :aria-label="$t('app.nextYearTitle')" aria-label-position="bottom" @mousedown.stop.prevent="stepYear(1)">»</button>
        </div>
        <div class="tk-dp__weekdays">
          <span v-for="w in weekHeaders" :key="w" class="tk-dp__wd">{{ w }}</span>
        </div>
        <div class="tk-dp__grid">
          <div
            v-for="cell in cells"
            :key="cell.key"
            class="tk-dp__cell"
            :class="{
              'is-out': !cell.inMonth,
              'is-today': cell.isToday,
              'is-selected': cell.ymd === modelValue,
              'is-focus': cell.ymd === focusDate,
              'is-disabled': cell.disabled
            }"
            @mouseenter="focusDate = cell.ymd"
            @mousedown.stop.prevent="select(cell)"
          >{{ cell.day }}</div>
        </div>
        <div class="tk-dp__footer">
          <button type="button" class="tk-dp__today" :disabled="isDisabledYmd(todayYmd)" @mousedown.stop.prevent="selectToday">
            {{ $t('app.backToToday') }}
          </button>
        </div>
      </div>
    </transition>
  </div>
</template>

<script>
// 自实现日期选择器（参考 element-plus 的 DatePicker 交互，但不依赖任何第三方库）：
// - 只读输入框 + 日历弹层；点击 / 聚焦输入框展开，选中后自动收起；
// - 头部：«上一年 ‹上一月 [年 月] ›下一月 »下一年，星期表头与设置项“每周的开始日”对齐；
// - 键盘：↑↓←→ 移动焦点日期（跨月自动翻页），回车选中，Esc 关闭；鼠标悬停即高亮；
// - 今天快捷；min / max 范围内的日期置灰不可选；
// - 仅以 YYYY-MM-DD 字符串与父组件交互（v-model），与后端 / 面板既有约定一致。
import { getWeekStart } from '../composables/tasks-logic.js';

const pad2 = (n) => (n < 10 ? '0' + n : '' + n);

export default {
  name: 'DatePicker',
  props: {
    modelValue: { type: String, default: '' },
    placeholder: { type: String, default: 'YYYY-MM-DD' },
    disabled: { type: Boolean, default: false },
    min: { type: String, default: '' },
    max: { type: String, default: '' },
  },
  emits: ['update:modelValue', 'change'],
  data() {
    return {
      open: false,
      viewYear: 0,
      viewMonth: 0,
      focusDate: '',
      justClosed: false,
      _outside: null,
    };
  },
  computed: {
    weekStart() { return getWeekStart(); },
    todayYmd() { return this.toYmd(new Date()); },
    display() { return this.modelValue || ''; },
    // 表头星期：i18n 的 weekdaysShort 为周一开头数组，按周起始旋转到正确首位
    weekHeaders() {
      const list = this.weekdayList('app.weekdaysShort');
      const rot = (this.weekStart + 6) % 7;
      return list.slice(rot).concat(list.slice(0, rot));
    },
    monthLabel() {
      return this.$t('app.monthLabel', { y: this.viewYear, m: this.viewMonth + 1 });
    },
    // 6 行 × 7 列的日期网格（含上下月补位），每格带 inMonth / today / disabled 标记
    cells() {
      const y = this.viewYear, m = this.viewMonth;
      const firstWd = new Date(y, m, 1).getDay(); // 0=周日 … 6=周六
      const offset = (firstWd - this.weekStart + 7) % 7;
      const daysInMonth = new Date(y, m + 1, 0).getDate();
      const count = 42; // 固定 6 行 × 7 列，保证日历高度一致
      const today = this.todayYmd;
      const out = [];
      for (let i = 0; i < count; i++) {
        const d = new Date(y, m, i - offset + 1);
        const ymd = this.toYmd(d);
        out.push({
          key: ymd,
          ymd,
          day: d.getDate(),
          inMonth: d.getMonth() === m,
          isToday: ymd === today,
          disabled: this.isDisabledYmd(ymd),
        });
      }
      return out;
    },
  },
  beforeUnmount() { this.removeOutside(); },
  methods: {
    // i18next 默认把数组 key 当字符串返回，这里统一取回数组（兼容 returnObjects 与逗号拼接两种返回）
    weekdayList(key) {
      const raw = this.$t(key, { returnObjects: true });
      if (Array.isArray(raw)) return raw;
      if (typeof raw === 'string') return raw.split(',').map((s) => s.trim()).filter(Boolean);
      return [];
    },
    toYmd(d) {
      return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    },
    parseYmd(s) {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
      if (!m) return null;
      const d = new Date(+m[1], +m[2] - 1, +m[3]);
      return isNaN(d.getTime()) ? null : d;
    },
    isDisabledYmd(ymd) {
      if (this.min && ymd < this.min) return true;
      if (this.max && ymd > this.max) return true;
      return false;
    },
    openPanel() {
      // 已打开时不再重置视图，避免切换年/月后被焦点或点击事件弹回初始月
      if (this.open || this.disabled || this.justClosed) return;
      this.open = true;
      const init = this.parseYmd(this.modelValue) || new Date();
      this.viewYear = init.getFullYear();
      this.viewMonth = init.getMonth();
      this.focusDate = this.modelValue || this.todayYmd;
      this.addOutside();
    },
    close() {
      this.open = false;
      this.justClosed = true;
      this.removeOutside();
      setTimeout(() => { this.justClosed = false; }, 250);
    },
    addOutside() {
      if (this._outside) return;
      this._outside = (e) => { if (this.open && !this.$el.contains(e.target)) this.close(); };
      document.addEventListener('mousedown', this._outside);
    },
    removeOutside() {
      if (this._outside) { document.removeEventListener('mousedown', this._outside); this._outside = null; }
    },
    stepMonth(n) {
      let m = this.viewMonth + n, y = this.viewYear;
      while (m < 0) { m += 12; y--; }
      while (m > 11) { m -= 12; y++; }
      this.viewMonth = m; this.viewYear = y;
    },
    stepYear(n) { this.viewYear += n; },
    moveFocus(delta) {
      const base = this.parseYmd(this.focusDate) || new Date();
      const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + delta);
      this.focusDate = this.toYmd(d);
      if (d.getMonth() !== this.viewMonth || d.getFullYear() !== this.viewYear) {
        this.viewMonth = d.getMonth();
        this.viewYear = d.getFullYear();
      }
    },
    onKeydown(e) {
      if (!this.open) {
        if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); this.openPanel(); }
        return;
      }
      if (e.key === 'ArrowLeft') { e.preventDefault(); this.moveFocus(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); this.moveFocus(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); this.moveFocus(-7); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); this.moveFocus(7); }
      else if (e.key === 'Enter') { e.preventDefault(); this.selectByFocus(); }
      else if (e.key === 'Escape') { e.preventDefault(); this.close(); }
    },
    // 选中指定日期并提交，同时关闭面板；日期越界（disabled）时忽略
    selectYmd(ymd) {
      if (!ymd || this.isDisabledYmd(ymd)) return;
      this.commitValue(ymd);
      this.close();
    },
    select(cell) {
      this.selectYmd(cell.ymd);
    },
    selectByFocus() {
      this.selectYmd(this.focusDate);
    },
    selectToday() {
      this.selectYmd(this.todayYmd);
    },
    commitValue(ymd) {
      if (ymd !== this.modelValue) {
        this.$emit('update:modelValue', ymd);
        this.$emit('change', ymd);
      }
    },
  },
};
</script>

<style>
.tk-dp {
  position: relative;
  display: block;
  width: 100%;
}
.tk-dp__control {
  display: flex;
  align-items: center;
}
.tk-dp.is-disabled .tk-dp__control {
  opacity: 0.5;
  cursor: not-allowed;
}
.tk-dp__input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text-normal, #222);
  font-size: 14px;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
  padding: 0;
}
.tk-dp__input::placeholder { color: var(--text-faint, #999); }
.tk-dp__panel {
  position: absolute;
  z-index: 60;
  bottom: calc(100% + 4px);
  left: 0;
  width: 248px;
  padding: 8px;
  background: var(--background-primary, #fff);
  border: 1px solid var(--background-modifier-border, #ccc);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
  user-select: none;
}
.tk-dp__header {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-bottom: 6px;
}
.tk-dp__title {
  flex: 1;
  text-align: center;
  font-weight: 600;
  color: var(--text-normal, #222);
  font-variant-numeric: tabular-nums;
}
.tk-dp__nav {
  border: none;
  background: transparent;
  color: var(--text-muted, #888);
  cursor: pointer;
  font-size: 14px;
  width: 24px;
  height: 24px;
  border-radius: 5px;
}
.tk-dp__nav:hover { background: var(--background-modifier-hover, #f0f0f0); color: var(--text-normal, #222); }
.tk-dp__weekdays, .tk-dp__grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
}
.tk-dp__wd {
  text-align: center;
  font-size: 12px;
  color: var(--text-muted, #888);
  padding: 4px 0;
}
.tk-dp__cell {
  text-align: center;
  font-size: 13px;
  padding: 6px 0;
  border-radius: 5px;
  cursor: pointer;
  color: var(--text-normal, #222);
  font-variant-numeric: tabular-nums;
}
.tk-dp__cell.is-out { color: var(--text-faint, #bbb); }
.tk-dp__cell:hover { background: var(--background-modifier-hover, #f0f0f0); }
.tk-dp__cell.is-focus { background: var(--background-modifier-hover, #f0f0f0); box-shadow: inset 0 0 0 1px var(--interactive-accent, #b8860b); }
.tk-dp__cell.is-today { font-weight: 700; color: var(--interactive-accent, #b8860b); }
.tk-dp__cell.is-selected { background: var(--interactive-accent, #b8860b); color: #fff; font-weight: 600; }
.tk-dp__cell.is-selected.is-today { color: #fff; }
.tk-dp__cell.is-disabled { opacity: 0.4; cursor: not-allowed; }
.tk-dp__cell.is-disabled:hover { background: transparent; }
.tk-dp__footer {
  margin-top: 6px;
  text-align: center;
}
.tk-dp__today {
  border: none;
  background: transparent;
  color: var(--interactive-accent, #b8860b);
  cursor: pointer;
  font-size: 13px;
  padding: 4px 10px;
  border-radius: 5px;
}
.tk-dp__today:hover { background: var(--background-modifier-hover, #f0f0f0); }
.tk-dp__today:disabled { opacity: 0.4; cursor: not-allowed; }
.tk-fade-enter-active, .tk-fade-leave-active { transition: opacity 0.12s ease; }
.tk-fade-enter-from, .tk-fade-leave-to { opacity: 0; }
</style>
