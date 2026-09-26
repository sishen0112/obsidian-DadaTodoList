<template>
  <div class="tk-row-wrap" :class="{ done: task.completed || task.cancelled, sel: selected }">
    <div class="tk-row" @click="onClickRow" :title="$t('app.rowJumpTip')">
      <i class="tk-check" :class="[{ done: task.completed || task.cancelled }, statusIcon(task)]" @click.stop.prevent="$emit('toggle', task)"></i>
      <!-- 名称在前（占满剩余宽度，撑开右侧留白），日期时间在右 -->
      <div class="tk-body">
        <span class="tk-sum" v-html="richSummaryNoTags(task)" @click="onRichClick"></span>
        <div v-if="task.tags && task.tags.length" class="tk-tags">
          <span v-for="tag in task.tags" :key="tag" class="tk-tag">#{{ tag }}</span>
        </div>
      </div>
      <span v-if="right" class="tk-date"><i class="tk-date-ico" :class="right.icon"></i>{{ right.text }}</span>
      <span v-else class="tk-date tk-ph">—</span>
    </div>
  </div>
</template>

<script>
// 任务列表行（待办/已办分组共用）。
// 纯展示组件：勾选 / 选中 / 编辑等动作全部上抛，由容器统一处理。
import { statusIcon, dateText, timeText, richSummaryNoTags } from '../../composables/tasks-logic.js';

export default {
  name: 'TaskRow',
  props: {
    task: { type: Object, required: true },
    selected: { type: Boolean, default: false },
    // 显示模式：true=仅日期（日历图标，用于「最近7天/更远」分组），false=仅时间（时钟图标，其余分组）
    showDate: { type: Boolean, default: false }
  },
  computed: {
    // 右侧日期/时间展示：根据分组模式返回图标与文案
    right() {
      const t = this.task;
      if (!t || !t.dueAt) return null;
      const d = dateText(t);
      if (this.showDate) return { icon: 'la la-calendar', text: d };
      // 时间模式：优先显示具体时间；「全天」或无时间则回退为日期（用日历图标）
      // （不与 timeText 的返回值比较字符串——timeText 已本地化，改用数据字段判断）
      const tm = timeText(t);
      if (tm && !t.dueAllDay) return { icon: 'la la-clock', text: tm };
      return { icon: 'la la-calendar', text: d };
    }
  },
  methods: {
    statusIcon(t) { return statusIcon(t); },
    dateText(t) { return dateText(t); },
    timeText(t) { return timeText(t); },
    richSummaryNoTags(t) { return richSummaryNoTags(t); },
    // 行点击：按住 Ctrl（Win）/Cmd（Mac）直接跳转到任务所在笔记并高亮，无需打开编辑器
    onClickRow(e) {
      if (e && (e.metaKey || e.ctrlKey)) this.$emit('open', this.task);
      else this.$emit('select', this.task);
    },
    // v-html 内的链接点击：阻止冒泡，避免同时触发行选中
    onRichClick(e) {
      if (e.target && e.target.tagName === 'A') e.stopPropagation();
    }
  }
};
</script>
