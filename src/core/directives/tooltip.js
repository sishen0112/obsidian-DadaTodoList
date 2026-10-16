// Vue 自定义指令 v-tooltip：用 Obsidian 自带的 setTooltip 实现悬浮提示，
// 仅用 setTooltip，绝不额外设置原生 :title（否则会与 Obsidian 提示叠加成两个 tooltip，
// 且原生 title 样式与 Obsidian 不一致、在容器内可能被遮挡）。
// 用法：
//   <button v-tooltip="$t('app.hideDone')">                     // 默认（Obsidian 默认方位：上）
//   <button v-tooltip="{ text: $t('app.hideDone'), placement: 'right' }">  // 指定方位
// setTooltip 内部仅在首次注册 mouseover 监听（重复调用只更新文案），故 updated 重复调用安全。
import { setTooltip } from 'obsidian';

function apply(el, binding) {
  const v = binding.value;
  const text = v && typeof v === 'object' ? v.text : v;
  const placement = v && typeof v === 'object' && v.placement ? v.placement : undefined;
  if (text) {
    setTooltip(el, text, placement ? { placement } : undefined);
  } else {
    // 无值时清空提示，避免保留旧文案（展开态下菜单项已有文字标签，无需 tooltip）
    setTooltip(el, '');
  }
}

export const tooltip = {
  mounted(el, binding) { apply(el, binding); },
  updated(el, binding) { apply(el, binding); }
};
