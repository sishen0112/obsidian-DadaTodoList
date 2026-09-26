<template>
  <!-- 自绘遮罩弹窗（约定：弹层不用 Element 组件）+ 自绘月历（替代 el-calendar） -->
  <div v-if="visible" class="tk-mask cl-mask" @click.self="close">
    <div class="tk-modal cl-modal">
      <button class="tk-close" type="button" @click="close"><i class="la la-times"></i></button>
      <h3 class="tk-modal-title">{{ title }}</h3>
      <div class="cl-cal-wrap">
        <div class="cl-cal-box">
          <div class="cl-cal-nav">
            <button class="cl-nav-btn" type="button" @click="shiftMonth(-1)"><i class="la la-angle-left"></i></button>
            <span class="cl-nav-label">{{ monthLabel }}</span>
            <button class="cl-nav-btn" type="button" @click="shiftMonth(1)"><i class="la la-angle-right"></i></button>
          </div>
          <div class="cl-cal-weekdays">
            <span v-for="w in weekdayLabels" :key="w" class="cl-wd">{{ w }}</span>
          </div>
          <div class="cl-cal-grid">
            <div v-for="c in monthCells" :key="c.day" class="cl-cell"
                 :class="{ other: c.other, today: c.today, hot: c.day === activeDay }"
                 @click="activeDay = c.day; activeGuid = ''">
              <span class="cl-cal-num">{{ c.day.split('-')[2] }}</span>
              <div v-if="doneMap[c.day]" class="cl-cal-titles">
                <div v-for="(it, i) in doneMap[c.day].slice(0, 3)" :key="it.guid" class="cl-cal-line" :title="plainTitle(it)">{{ plainTitle(it) }}</div>
                <div v-if="doneMap[c.day].length > 3" class="cl-cal-more">+{{ doneMap[c.day].length - 3 }}</div>
              </div>
            </div>
          </div>
        </div>
        <aside class="cl-cal-side">
          <div class="cl-cal-side-h">{{ $t('app.calDayCount', { day: activeDay, n: dayItems.length }) }}</div>
          <div class="cl-cal-side-list">
            <div v-for="it in dayItems" :key="it.guid"
                 class="cl-cal-item" :class="{ on: it.guid === activeGuid }"
                 @click="activeGuid = it.guid">
              <div class="cl-cal-item-title">{{ plainTitle(it) }}</div>
              <div v-if="it.tags && it.tags.length" class="cl-cal-item-tags">
                <span v-for="tg in it.tags" :key="tg" class="tk-tag">#{{ tg }}</span>
              </div>
            </div>
            <div v-if="!dayItems.length" class="cl-cal-empty">{{ $t('app.calDayEmpty') }}</div>
          </div>
        </aside>
      </div>
    </div>
  </div>
</template>

<script>
// 清单完成日历：按完成日期（✅ 标记）展示清单内已完成任务的分布，
// 打开时可定位到指定任务完成的那天（参考学习模块的学习日历）。
import { plainTitle } from '../../composables/tasks-logic.js';

const pad = (n) => (n < 10 ? '0' + n : '' + n);
function ymd(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

export default {
  name: 'ChecklistDoneCalendar',
  props: {
    visible: { type: Boolean, default: false },
    // 清单显示名（弹窗标题用）
    listName: { type: String, default: '' },
    // 清单任务池（记录含完成时间戳 completedAt）
    tasks: { type: Array, default: () => [] },
    // 打开时定位：{ guid, day: 'YYYY-MM-DD' }；null 则定位今天
    focus: { type: Object, default: null }
  },
  data() {
    return {
      calMonth: new Date(),
      activeDay: ymd(new Date()),
      activeGuid: ''
    };
  },
  computed: {
    title() {
      return this.$t('app.calTitle', { name: this.listName || this.$t('app.viewCl') });
    },
    monthLabel() {
      const d = this.calMonth;
      return this.$t('app.monthLabel', { y: d.getFullYear(), m: d.getMonth() + 1 });
    },
    weekdayLabels() { return this.$t('app.weekdaysShort', { returnObjects: true }); },
    doneItems() {
      return (this.tasks || []).filter((t) => t.completed && t.completedAt);
    },
    // 按完成日期分组
    doneMap() {
      const m = {};
      this.doneItems.forEach((t) => {
        const k = ymd(new Date(Number(t.completedAt)));
        (m[k] = m[k] || []).push(t);
      });
      return m;
    },
    dayItems() {
      return this.doneMap[this.activeDay] || [];
    },
    // 自绘月历格子（周一为首列，含前后月补位）
    monthCells() {
      const base = new Date(this.calMonth.getFullYear(), this.calMonth.getMonth(), 1);
      const year = base.getFullYear(), month = base.getMonth() + 1;
      const dim = new Date(year, month, 0).getDate();
      const startOffset = (base.getDay() + 6) % 7;
      const cells = [];
      for (let i = startOffset; i > 0; i--) {
        const d = new Date(year, month - 1, 1 - i);
        cells.push({ date: d, day: ymd(d), other: true });
      }
      for (let d = 1; d <= dim; d++) {
        const dt = new Date(year, month - 1, d);
        cells.push({ date: dt, day: ymd(dt), other: false, today: ymd(dt) === ymd(new Date()) });
      }
      while (cells.length % 7 !== 0) {
        const last = cells[cells.length - 1].date;
        const nd = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1);
        cells.push({ date: nd, day: ymd(nd), other: true });
      }
      return cells;
    }
  },
  watch: {
    // 每次打开时按 focus 定位（或回到今天）；immediate：VueModal 桥挂载时 visible 已为 true
    visible: {
      handler(open) {
      if (!open) return;
      if (this.focus && this.focus.day) {
        this.activeGuid = this.focus.guid || '';
        this.activeDay = this.focus.day;
        this.calMonth = new Date(this.focus.day + 'T00:00:00');
      } else {
        this.activeGuid = '';
        this.activeDay = ymd(new Date());
        this.calMonth = new Date();
      }
      },
      immediate: true
    }
  },
  methods: {
    plainTitle(t) { return plainTitle(t); },
    shiftMonth(n) {
      const d = this.calMonth;
      this.calMonth = new Date(d.getFullYear(), d.getMonth() + n, 1);
    },
    close() { this.$emit('update:visible', false); }
  }
};
</script>

<style scoped>
/* ===== 清单完成日历弹窗 ===== */
.cl-mask { z-index: 70; }
.cl-modal { max-width: 900px; }
.cl-cal-wrap { display: flex; gap: 16px; align-items: stretch; }
.cl-cal-box { flex: 1 1 auto; min-width: 0; }
.cl-cal-nav { display: flex; align-items: center; justify-content: center; gap: 14px; margin-bottom: 8px; }
.cl-nav-btn {
  width: 26px; height: 26px; border: 1px solid var(--line); border-radius: 8px;
  background: transparent; color: var(--ink-soft); font-size: 13px; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
}
.cl-nav-btn:hover { background: var(--gold-bg); color: var(--gold); }
.cl-nav-label { font-size: 14px; font-weight: 700; color: var(--ink); font-variant-numeric: tabular-nums; }
.cl-cal-weekdays { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 5px; margin-bottom: 5px; }
.cl-wd { text-align: center; font-size: 11.5px; font-weight: 600; color: var(--ink-soft); }
.cl-cal-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 5px; }
.cl-cell {
  min-width: 0; min-height: 74px; padding: 5px 6px;
  display: flex; flex-direction: column; gap: 2px; border-radius: 8px; cursor: pointer;
  background: var(--gold-bg); border: 1px solid transparent;
  transition: background .15s ease, border-color .15s ease;
}
.cl-cell.other { opacity: .4; }
.cl-cell.hot { background: var(--gold-bg); border-color: var(--gold); }
.cl-cell.hot .cl-cal-num { color: var(--gold); }
.cl-cal-num { font-size: 12.5px; font-weight: 600; color: var(--ink); flex: none; }
.cl-cal-titles { flex: 1 1 auto; min-width: 0; width: 100%; display: flex; flex-direction: column; gap: 1px; overflow: hidden; }
.cl-cal-line { font-size: 10.5px; line-height: 14px; color: var(--gold); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; width: 100%; }
.cl-cal-more { font-size: 10px; color: var(--ink-soft); font-weight: 600; }
.cl-cal-side {
  flex: none; width: 230px; display: flex; flex-direction: column;
  border: 1px solid var(--line); border-radius: 10px; background: var(--panel); overflow: hidden;
}
.cl-cal-side-h { padding: 10px 12px; font-size: 13px; font-weight: 700; color: var(--ink); border-bottom: 1px solid var(--line); background: var(--panel-2); }
.cl-cal-side-list { flex: 1 1 auto; overflow-y: auto; padding: 8px; max-height: 420px; }
.cl-cal-item {
  padding: 9px 10px; border: 1px solid var(--line); border-radius: 8px; margin-bottom: 6px;
  cursor: pointer; transition: border-color .12s ease, background .12s ease;
}
.cl-cal-item:hover { border-color: var(--gold-soft); }
.cl-cal-item.on { border-color: var(--gold); background: var(--gold-bg); }
.cl-cal-item-title { font-size: 13px; font-weight: 600; color: var(--ink); line-height: 1.4; word-break: break-word; }
.cl-cal-item-tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
.cl-cal-empty { font-size: 12.5px; color: var(--ink-soft); text-align: center; padding: 18px 0; }
@media (max-width: 720px) {
  .cl-cal-wrap { flex-direction: column; }
  .cl-cal-side { width: 100%; max-height: 200px; }
}
</style>
