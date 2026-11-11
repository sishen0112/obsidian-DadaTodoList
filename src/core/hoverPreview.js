// ============================================================================
// 复用 Obsidian 核心「页面预览」实现自定义 UI 的悬停预览
// ----------------------------------------------------------------------------
// 原理（详见 docs/native-hover-preview 备忘）：
//   核心「页面预览」插件监听工作区 hover-link 事件，收到后由核心自己创建弹窗、
//   渲染目标笔记、管理定位与显隐。插件只需两步——注册来源 + 触发事件，
//   绝不要自己 new HoverPopover + MarkdownRenderer 低配仿制（坑多且不如核心完整）。
//
// 本实现覆盖两类来源：
//   1) 清单视图左侧的文件列表（.tk-cl-item，data-href 为清单笔记路径）
//   2) 任务标题中的 [[双链]]（.tk-wikilink，data-link 为目标笔记名，可带 #标题）
// 二者悬停即弹出对应笔记的页面预览，与原生内链悬停体验完全一致
// （嵌入 / 代码高亮 / Dataview 块均原生支持）。
// ============================================================================

// 上次命中元素，用于同元素判重（同一条目内滑动不重复触发）
let previewTarget = null;

// 触发核心「页面预览」：把链接文本交给核心，由它负责渲染弹窗 / 定位 / 显隐。
// linktext 为笔记名（可带 #标题），不带 .md 后缀。
function fireLinkPreview(plugin, e, targetEl, linktext) {
  if (!linktext) { previewTarget = null; return; }
  const ws = plugin.app.workspace;
  const activeFile = ws.getActiveFile();
  ws.trigger('hover-link', {
    event: e,
    source: plugin.manifest.id, // 必须与 registerHoverLinkSource 的 id 一致
    hoverParent: (ws.activeLeaf && ws.activeLeaf.view) || plugin,
    targetEl, // 弹窗锚定该元素，视觉更稳
    linktext,
    sourcePath: activeFile ? activeFile.path : '',
  });
}

/**
 * 在插件 onload 时调用一次：注册 hover-link 来源 + 挂全局 mousemove 监听。
 * @param {import('obsidian').Plugin} plugin 插件实例（this）
 */
export function setupHoverPreview(plugin) {
  // ① 注册来源：向核心页面预览登记本插件为合法事件来源
  //    （会出现在核心「页面预览」设置页，用户可单独开关；旧版 API 不存在时静默跳过）
  try {
    if (typeof plugin.registerHoverLinkSource === 'function') {
      plugin.registerHoverLinkSource(plugin.manifest.id, {
        display: plugin.manifest.name,
        defaultMod: false, // false = 悬停即预览，无需按住 Cmd/Ctrl
      });
    }
  } catch (e) {
    console.warn('[DadaTodo] registerHoverLinkSource 失败（旧版 Obsidian？）：', e);
  }

  // ② 一个全局 mousemove 监听（registerDomEvent 会在插件卸载时自动清理）
  plugin.registerDomEvent(document, 'mousemove', (e) => {
    const t = e.target;
    if (!t || !t.closest) return;

    // 标题内的 [[双链]]：悬停即弹出目标笔记预览（复用核心页面预览，与原生内链一致）。
    // 优先于清单列表判断：任务标题里本身也可能出现 [[双链]]（包括清单条目内）。
    const wl = t.closest('.tk-wikilink');
    if (wl) {
      if (previewTarget === wl) return; // 同元素判重
      previewTarget = wl;
      // data-link 已是笔记名（可带 #标题），无需像清单那样去 .md 后缀
      fireLinkPreview(plugin, e, wl, wl.getAttribute('data-link') || '');
      return;
    }

    // 区域短路：不在清单左侧文件列表内直接返回（高频事件，先 cheap 判断）
    if (!t.closest('.tk-cl-side')) {
      if (previewTarget) previewTarget = null;
      return;
    }

    // 命中清单条目整行（带 data-href 的那个容器）
    const el = t.closest('.tk-cl-item');
    if (!el) { previewTarget = null; return; }

    // 同元素判重：命中才解析并触发（去防抖，核心自带显示延迟，跟原生一致）
    if (previewTarget === el) return;
    previewTarget = el;

    // data-href 存的是带 .md 的路径，按核心约定去掉后缀
    const linktext = (el.getAttribute('data-href') || '').replace(/\.md$/, '');
    fireLinkPreview(plugin, e, el, linktext);
  });
}

/** 插件卸载时反注册来源（清理核心「页面预览」设置项里的本插件条目） */
export function teardownHoverPreview(plugin) {
  try {
    if (typeof plugin.unregisterHoverLinkSource === 'function') {
      plugin.unregisterHoverLinkSource(plugin.manifest.id);
    }
  } catch (e) { /* 忽略 */ }
  previewTarget = null;
}
