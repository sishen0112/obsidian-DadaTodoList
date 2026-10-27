// ============================================================================
// 视图菜单元数据：ViewPill（菜单渲染 / 菜单上拖拽排序）与设置页（显隐 + 拖拽排序）共用，
// 保证三处（横向胶囊 / 竖向折叠列表 / 左侧竖栏 / 设置页）看到的视图集合与顺序口径一致。
// ============================================================================

// 全部视图定义（labelKey / icon 与原 ViewPill 内置表一致，key 即 TasksApp 的 view 状态值）
export const VIEW_MENU_ITEMS = [
  { key: 'day', labelKey: 'app.viewDay', icon: 'la la-sun-o' },
  { key: 'four', labelKey: 'app.viewWeek', icon: 'la la-stream' },
  { key: 'month', labelKey: 'app.viewMonth', icon: 'la la-calendar-alt' },
  { key: 'agenda', labelKey: 'app.viewAgenda', icon: 'la la-list-alt' },
  { key: 'matrix', labelKey: 'app.viewMatrix', icon: 'la la-th-large' },
  { key: 'cl', labelKey: 'app.viewCl', icon: 'la la-tasks' },
  { key: 'all', labelKey: 'app.viewAll', icon: 'la la-list' }
];

// 默认：全部显示，按当前顺序
export const DEFAULT_MENU_VIEWS = VIEW_MENU_ITEMS.map((v) => v.key);

// 归一化「视图顺序」：剔除未知 key / 去重；缺失的视图（如升级新增）按默认顺序补到末尾
export function normalizeMenuViews(v) {
  const known = new Set(DEFAULT_MENU_VIEWS);
  const arr = Array.isArray(v) ? v.filter((k) => known.has(k)) : [];
  const out = [...new Set(arr)];
  for (const k of DEFAULT_MENU_VIEWS) if (!out.includes(k)) out.push(k);
  return out;
}

// 归一化「隐藏视图」：仅保留合法 key 并去重
export function normalizeMenuHidden(v) {
  const known = new Set(DEFAULT_MENU_VIEWS);
  return Array.isArray(v) ? [...new Set(v.filter((k) => known.has(k)))] : [];
}

// 拖拽排序：把 dragKey 移动到 overKey 之前/之后（按原相对位置决定前后），返回新顺序数组。
// all 为完整顺序（含隐藏项）：隐藏项不参与拖拽，但保持原位随之顺移。
export function reorderViews(all, dragKey, overKey) {
  const from = all.indexOf(dragKey);
  const to = all.indexOf(overKey);
  if (from < 0 || to < 0 || from === to) return all;
  const out = all.slice();
  out.splice(from, 1);
  let idx = out.indexOf(overKey);
  if (from < to) idx += 1; // 向后拖：落到目标之后
  out.splice(idx, 0, dragKey);
  return out;
}
