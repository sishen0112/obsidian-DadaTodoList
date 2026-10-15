import DadaTodoPlugin from './main.js';
import { installPro } from '../pro/index.js';
import { installPersonal } from '../personal/index.js';

// ============================================================================
// Dada Todo Personal · 入口封装（提交到公开仓库，仅薄封装，不含任何 Pro/Personal 私有源码）
// ----------------------------------------------------------------------------
// 复用免费版插件类，先挂载 Pro 增强，再挂载 Personal 增强（故天然包含完整 Pro 功能）。
// src/pro 与 src/personal 均指向私有子仓库（仅 Personal 构建时 checkout 存在）；
// 免费 / Pro 构建以 main.js / main.pro.js 为入口，根本不引用本文件，因此 Personal
// 源码（以及 Pro 源码）绝不会泄漏到那两个产物。
// 增强约定：导出 installPro(plugin) / installPersonal(plugin)，plugin 即已加载完成的实例。
// ============================================================================

const origOnload = DadaTodoPlugin.prototype.onload;
DadaTodoPlugin.prototype.onload = async function () {
  await origOnload.call(this);
  try {
    installPro(this);
  } catch (e) {
    console.error('[DadaTodo Pro] installPro 失败：', e);
  }
  try {
    installPersonal(this);
  } catch (e) {
    console.error('[DadaTodo Personal] installPersonal 失败：', e);
  }
};

export default DadaTodoPlugin;
