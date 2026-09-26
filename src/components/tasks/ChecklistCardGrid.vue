<template>
  <div class="tk-cl-grid">
    <div v-if="!tasks.length" class="tk-group-empty">{{ emptyText || $t('app.clEmpty') }}</div>
    <div v-for="(t, i) in tasks" :key="t.guid" class="ch-card"
         :class="{ done: t.completed, sel: t.guid === selectedGuid }" @click="$emit('select', t)">
      <span class="ch-idx">{{ i + 1 }}</span>
      <span class="ch-toggle" :title="$t('app.toggleDone')" @click.stop="$emit('toggle', t)"><i v-if="t.completed" class="la la-check"></i></span>
      <el-tooltip class="ch-tt" :content="plainTitle(t)" placement="top" :disabled="!truncated[t.guid]">
        <span class="ch-title" :ref="(el) => regTitle(el, t)" v-html="richSummaryNoTags(t)" @click="onRichClick"></span>
      </el-tooltip>
      <span v-if="t.completed && t.completedAt" class="ch-done-at" :title="$t('app.viewInCal')" @click.stop="$emit('open-cal', t)">{{ $t('app.doneOn', { day: doneDay(t) }) }}</span>
      <div v-if="t.tags && t.tags.length" class="tk-tags">
        <span v-for="tag in t.tags" :key="tag" class="tk-tag">#{{ tag }}</span>
      </div>
    </div>
  </div>
</template>

<script>
// 清单卡片视图网格（样式参考学习模块的章节卡片）：
// 序号徽标 + 完成开关 + 两行截断标题（截断时 tooltip）+ 完成日期 + 标签。
import { plainTitle, richSummaryNoTags, doneDay } from '../../composables/tasks-logic.js';

export default {
  name: 'ChecklistCardGrid',
  props: {
    tasks: { type: Array, default: () => [] },
    selectedGuid: { type: String, default: '' },
    // 空列表文案（「显示已完成」开关状态不同，文案不同）
    emptyText: { type: String, default: '' }
  },
  data() {
    return {
      // 标题截断检测（截断才显示 tooltip）
      truncated: {},
      titleEls: {}
    };
  },
  watch: {
    // 列表变化后重新测量标题截断
    tasks() { this.$nextTick(this.measureTitles); }
  },
  methods: {
    plainTitle(t) { return plainTitle(t); },
    richSummaryNoTags(t) { return richSummaryNoTags(t); },
    doneDay(t) { return doneDay(t); },
    regTitle(el, t) {
      if (!t) return;
      if (el) this.titleEls[t.guid] = el;
      else delete this.titleEls[t.guid];
    },
    measureTitles() {
      const map = {};
      Object.keys(this.titleEls).forEach((guid) => {
        const el = this.titleEls[guid];
        if (el) map[guid] = el.scrollHeight > el.clientHeight + 1;
      });
      if (JSON.stringify(this.truncated) !== JSON.stringify(map)) this.truncated = map;
    },
    // v-html 内的链接点击：阻止冒泡，避免同时触发卡片选中
    onRichClick(e) {
      if (e.target && e.target.tagName === 'A') e.stopPropagation();
    }
  }
};
</script>

<style scoped>
/* ===== 清单卡片网格（样式参考学习模块章节卡片） ===== */
.tk-cl-grid {
  flex: 1 1 auto; min-height: 0; overflow-y: auto;
  display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
  gap: 8px; align-content: start; padding: 10px 10px 12px;
}
.tk-cl-grid .ch-card {
  position: relative; display: flex; flex-direction: column; align-items: flex-start; gap: 4px;
  text-align: left; width: 100%; padding: 12px 14px;
  background: var(--panel); border: 1px solid var(--line); border-radius: 12px; cursor: pointer;
  box-shadow: var(--shadow); transition: box-shadow .15s ease, border-color .15s ease, transform .15s ease;
}
.tk-cl-grid .ch-card:hover { box-shadow: var(--shadow-l); border-color: var(--gold-soft); transform: translateY(-2px); }
.tk-cl-grid .ch-card.done { background: var(--gold-bg); border-color: var(--gold); }
.tk-cl-grid .ch-card.sel { border-color: var(--gold); box-shadow: 0 0 0 2px var(--gold-bg); }
.tk-cl-grid .ch-idx {
  position: absolute; top: -8px; left: -8px;
  min-width: 22px; height: 22px; padding: 0 5px; border-radius: 11px;
  background: var(--ink-soft); color: var(--text-on-accent); font-size: 11px; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
  border: 2px solid var(--panel); box-shadow: var(--shadow); font-variant-numeric: tabular-nums;
}
.tk-cl-grid .ch-card.done .ch-idx { background: var(--gold); }
.tk-cl-grid .ch-toggle {
  position: absolute; top: 8px; right: 8px;
  width: 22px; height: 22px; border-radius: 50%;
  border: 1.5px solid var(--line); background: transparent;
  display: flex; align-items: center; justify-content: center;
  color: var(--text-on-accent); font-size: 11px; cursor: pointer;
  transition: background .15s ease, border-color .15s ease;
}
.tk-cl-grid .ch-toggle:hover { border-color: var(--gold); background: var(--gold-bg); }
.tk-cl-grid .ch-card.done .ch-toggle { background: var(--gold); border-color: var(--gold); }
.tk-cl-grid .ch-tt { display: block; width: 100%; }
.tk-cl-grid .ch-title {
  font-size: 13.5px; font-weight: 600; color: var(--ink); line-height: 1.45;
  padding-right: 26px; word-break: break-word;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  overflow: hidden; text-overflow: ellipsis;
}
.tk-cl-grid .ch-done-at { font-size: 11.5px; color: var(--gold); font-weight: 600; cursor: pointer; }
.tk-cl-grid .ch-done-at:hover { text-decoration: underline; }
</style>
