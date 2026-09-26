// 打开任务所在的笔记，并把编辑器/预览滚动定位到任务行。
// 抽出自 TaskEditorModal.openFile：既供编辑弹窗的「打开文件」按钮调用，
// 也供任务列表 / 首页待办面板里 Ctrl/Cmd + 点击任务项直接跳转（不弹编辑器）。
//
// 跳转策略（参考 obsidian-next-toc 的 scrollToHeading）：
//   - 优先用 Obsidian「隐式 block id」：openLinkText('文件#^id') 在源/阅读两种视图下都会
//     原生滚动定位 + 原生 .block-highlight 闪烁（保留原生高亮），且不污染笔记正文。
//   - 取不到 block id 时，退回 leaf.openFile(file, { eState: { line, mode } })：
//     eState.line 在两种视图下均由 Obsidian 原生滚动（参考 next-toc 的做法），无需任何 DOM 文本匹配。
// 因此不再有任何自定义高亮/滚动叠加。
import { TFile, Notice } from 'obsidian';
import { taskFilePath } from '../api/tasks.js';
import { t } from '../i18n/index.js';

// 从已取到的 metadataCache 中按完整文件行号查该任务行的「隐式 block id」。
// Obsidian 给每个块（含每条任务行）自动生成 block id，无需在笔记正文里写 ^id；
// 命中即返回 id（用于 openLinkText 的 #^id），查不到返回 null。
function findBlockIdAtLine(cache, line) {
  if (!cache || !cache.blocks) return null;
  for (const id in cache.blocks) {
    const b = cache.blocks[id];
    if (b && b.position && b.position.start.line === line) return id;
  }
  return null;
}

// 打开任务所在笔记并定位。
//   plugin：插件实例（plugin.app 提供 Obsidian App）
//   task：任务记录（需 task.date 与 task.lineNo）
export async function openTaskInFile(plugin, task) {
  const dateKey = task && task.date; // YYYY-MM-DD / inbox / cl:清单名
  if (!dateKey || !plugin) return;
  const path = taskFilePath(dateKey);
  if (!path) { new Notice(t('app.locateFail')); return; }
  const app = plugin.app;
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) { new Notice(t('app.fileMissing') + path); return; }

  // 行号前置校验：task.lineNo 缺失则无法定位（也避免后续无谓的文件读取）
  const lineNo = (task && typeof task.lineNo === 'number') ? task.lineNo : null;
  if (typeof lineNo !== 'number') {
    new Notice(t('app.noLineNo'));
    return;
  }

  // 取一次 metadataCache 复用到底：frontmatter 行数 + 块 id 都从这里拿，
  // 避免重复查询，也避免为算 frontmatter 偏移去读取整篇文件内容。
  const cache = app.metadataCache.getFileCache(file);
  // task.lineNo 是相对“正文(body)”的下标，而编辑器/预览用完整文件行号；
  // 有 YAML frontmatter 时两者相差 head 行数，须修正，否则定位偏移到错误行。
  let headLineCount = 0;
  if (cache && cache.frontmatter && cache.frontmatter.position) {
    // 优先用缓存的 frontmatter 位置：精确，且不依赖换行符（\n / \r\n）
    headLineCount = cache.frontmatter.position.end.line + 1;
  } else {
    // 兜底：缓存未就绪时再读文件用正则算（极少路径）
    const raw = await app.vault.cachedRead(file);
    const hm = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(raw || '');
    headLineCount = hm ? hm[0].split('\n').length - 1 : 0;
  }
  const fullLineNo = headLineCount + lineNo;

  try {
    // 复用当前/已有的 markdown 标签，避免每次都开新标签页：
    // 1) 已打开该文件的标签；2) 最近使用的 markdown 标签（按 activeTime 倒序，即用户视角里的“当前标签”）
    const mdLeaves = app.workspace.getLeavesOfType('markdown');
    let leaf = mdLeaves.find((l) => l.view && l.view.file && l.view.file.path === path);
    if (!leaf && mdLeaves.length) {
      leaf = mdLeaves.slice().sort((a, b) => (b.activeTime || 0) - (a.activeTime || 0))[0];
    }
    if (!leaf) {
      // 没有任何 markdown 标签时才复用当前活动标签（避免误把插件自身视图替换掉）
      const act = app.workspace.activeLeaf;
      leaf = (act && act.view && act.view.getViewType && act.view.getViewType() === 'markdown') ? act : app.workspace.getLeaf(true);
    }
    // mode 沿用目标标签当前视图模式（source/preview/live），eState.line 下两种模式都原生滚动
    const mode = (leaf.view && typeof leaf.view.getMode === 'function') ? leaf.view.getMode() : undefined;
    const blockId = findBlockIdAtLine(cache, fullLineNo);
    if (blockId) {
      // 先让目标标签成为活动标签，openLinkText(newLeaf=false) 才会落在它上面（避免替换插件面板）
      if (typeof app.workspace.setActiveLeaf === 'function') app.workspace.setActiveLeaf(leaf, { focus: true });
      else if (leaf.view && leaf.view.leaf && typeof leaf.view.leaf.setActive === 'function') leaf.view.leaf.setActive(true);
      await app.workspace.openLinkText(`${file.path}#^${blockId}`, '', false, { active: true });
    } else {
      // 兜底：参考 next-toc，leaf.openFile + eState.line 在两种视图下原生滚动，无需 DOM 文本匹配
      await leaf.openFile(file, { active: true, eState: { line: fullLineNo, mode } });
    }
  } catch (e) {
    new Notice(t('app.openFileFail') + (e && e.message || e));
  }
}
