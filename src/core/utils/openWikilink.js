// 标题里的 [[wikilink]] 跳转：复用 Obsidian 原生 openLinkText（与清单/任务跳转同一套 API）。
// newLeaf=false 复用当前页签；sourcePath 留空则按库内相对路径解析（[[笔记名]] 指向同名笔记）。
import { Notice } from 'obsidian';
import { t } from '../i18n/index.js';

export function openWikilink(plugin, linkText) {
  if (!plugin || !linkText) return;
  const app = plugin.app;
  if (!app || !app.workspace || typeof app.workspace.openLinkText !== 'function') return;
  try {
    app.workspace.openLinkText(linkText, '', false);
  } catch (e) {
    new Notice((t('app.openLinkFail') || '打开链接失败：') + (e && e.message ? e.message : e));
  }
}

// v-html 内链接点击统一处理：拦截 .tk-wikilink 跳转；其余 <a>（http 等）仅阻止冒泡，
// 保留其默认跳转行为（如 tk-inline-link 的 target="_blank" 新标签页打开）。
export function handleInlineLinkClick(e, plugin) {
  const a = e.target && e.target.closest ? e.target.closest('a') : null;
  if (!a) return;
  e.stopPropagation();
  if (a.classList.contains('tk-wikilink')) {
    e.preventDefault();
    const link = a.getAttribute('data-link');
    if (link) openWikilink(plugin, link);
  }
}
