import { Notice } from 'obsidian';

// ============================================================================
// 开发期热更新
// ----------------------------------------------------------------------------
// 原理：`npm run dev` 时 Vite 以 watch 模式重建 dist/main.js，本模块用
//      Obsidian 的 vault.adapter.stat 轮询该文件 mtime，一旦变化就调用
//      disablePlugin / enablePlugin 让插件重新 onload。
// 说明：只在 DADA_DEV=1 的构建里被引用（见 main.js 的 __DADA_DEV__ 判断），
//      生产构建会被摇掉，不会带进发布产物。
// ============================================================================

const POLL_INTERVAL = 600; // 轮询 mtime 的间隔（ms）
const DEBOUNCE = 500; // 一次构建可能连写多次，等 mtime 落定后再重载

export function setupDevReload(plugin) {
  const { vault, plugins } = plugin.app;
  // 相对 vault 根的产物路径：软链接接到 .obsidian/plugins/obsidian-dada-todo 时同样可用
  const file = `${vault.configDir}/plugins/${plugin.manifest.id}/main.js`;

  let lastMtime = null;
  let pending = null;
  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    const stat = await vault.adapter.stat(file).catch(() => null);
    if (!stat || !stat.mtime) return;

    if (lastMtime === null) {
      lastMtime = stat.mtime; // 首次只记录基线
      return;
    }
    if (stat.mtime <= lastMtime) return;
    lastMtime = stat.mtime;

    if (pending) window.clearTimeout(pending);
    pending = window.setTimeout(() => {
      pending = null;
      reload(plugin, plugins);
    }, DEBOUNCE);
  };

  const timer = window.setInterval(tick, POLL_INTERVAL);

  plugin.register(() => {
    stopped = true;
    window.clearInterval(timer);
    if (pending) window.clearTimeout(pending);
  });
}

function reload(plugin, plugins) {
  const { id } = plugin.manifest;

  plugins.disablePlugin(id);
  plugins.enablePlugin(id);

  new Notice('Dada Todo List 已热更新', 1500);
  // 重载会 detach 视图，顺带把面板重新打开
  const fresh = plugins.plugins[id];
  if (fresh && typeof fresh.activateView === 'function') fresh.activateView();
}
