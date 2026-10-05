// Vue 自定义指令 v-tooltip：用 Obsidian 自带的 setTooltip 实现悬浮提示，
// 替代原生 :title（原生 title 样式与 Obsidian 不一致，且在 Obsidian 容器内可能被遮挡）。
// 用法：<button v-tooltip="$t('app.hideDone')">
// setTooltip 内部仅在首次注册 mouseover 监听（重复调用只更新文案），故 updated 重复调用安全。
import { setTooltip } from 'obsidian';

export const tooltip = {
  mounted(el, binding) {
    if (binding.value) setTooltip(el, binding.value);
  },
  updated(el, binding) {
    // 文案可能随 i18n / 状态切换变化，更新即可；空值则不设置
    if (binding.value) setTooltip(el, binding.value);
  }
};
