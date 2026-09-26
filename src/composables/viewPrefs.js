// 任务/视图类「界面记忆」的本地持久化。
//
// 以前这类偏好（任务顶层视图、列表/卡片模式、仅显示待办）写在 data.json 的
// settings.tasks 里，每次切换视图都 this.plugin.saveSettings() 写盘，导致云盘反复同步
// data.json。现改为仅存本机 localStorage：
//   - Obsidian 插件运行在渲染进程，window.localStorage 可用；
//   - 随渲染窗口持久存在，重开插件 / 重启 Obsidian 后仍在；
//   - 仅本机有效、不进入 vault 同步，正好契合「界面偏好」这类不该跨设备同步的状态。
const KEY = 'mylife:viewPrefs';

function readAll() {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function writeAll(patch) {
  try {
    if (typeof localStorage === 'undefined') return;
    const next = Object.assign({}, readAll(), patch);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch (e) {
    // 隐私模式 / 容量超限等：静默失败，降级为本次会话的内存态
  }
}

// 读取任务视图偏好（仅来自 localStorage，不再依赖 data.json）
export function getTaskViewPref() {
  const s = readAll();
  return {
    view: s.view || 'day',
    listView: s.listView || 'list',
    hideDone: typeof s.hideDone === 'boolean' ? s.hideDone : true
  };
}

// 局部更新任务视图偏好（只传变化的字段即可）
export function setTaskViewPref(patch) {
  writeAll(patch);
}

// 读取清单主区展示方式（列表 / 分栏）
export function getClMainViewPref() {
  const s = readAll();
  return s.clMainView || 'cols';
}

// 写入清单主区展示方式（不再写 data.json）
export function setClMainViewPref(view) {
  writeAll({ clMainView: view });
}
