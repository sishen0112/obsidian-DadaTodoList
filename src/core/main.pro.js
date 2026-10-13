import DadaTodoPlugin from './main.js';
import { installPro } from '../pro/index.js';

// ============================================================================
// Dada Todo Pro · 入口封装（提交到公开仓库，仅薄封装，不含任何 Pro 私有源码）
// ----------------------------------------------------------------------------
// 复用免费版插件类，仅在其 onload 完成后挂载 Pro 增强。
// src/pro 指向私有子仓库（仅 Pro 构建时 checkout 存在）；免费构建以 main.js 为入口，
// 根本不引用本文件，因此免费产物绝不会包含 Pro 源码。
// Pro 增强约定：导出 installPro(plugin)，plugin 即已加载完成的 DadaTodoPlugin 实例。
// ============================================================================

const origOnload = DadaTodoPlugin.prototype.onload;
DadaTodoPlugin.prototype.onload = async function () {
  await origOnload.call(this);
  try {
    installPro(this);
  } catch (e) {
    console.error('[DadaTodo Pro] installPro 失败：', e);
  }
};

export default DadaTodoPlugin;
