import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { copyFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// line-awesome 的 @font-face 带 eot/woff2/woff/ttf/svg 五种格式，CSS url() 不吃
// assetsInlineLimit 函数，兜底格式会被全部内联（styles.css 暴涨）。这里在转换期直接把
// 每个 @font-face 改写为仅保留 woff2（Obsidian 桌面端 Chromium 必够用），字体以
// data-uri 内联进 styles.css。
function laWoff2Only() {
  return {
    name: 'dada:la-woff2-only',
    enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('line-awesome.min.css')) return null;
      const next = code.replace(
        /src:url\(([^)]*)\.eot\);src:url\([^)]*\) format\("embedded-opentype"\),url\(([^)]*)\.woff2\) format\("woff2"\),url\([^)]*\) format\("woff"\),url\([^)]*\) format\("truetype"\),url\([^)]*\) format\("svg"\)/g,
        'src:url($1.woff2) format("woff2")'
      );
      return { code: next, map: null };
    }
  };
}

// ============================================================================
// Dada Todo Personal · 构建配置（在 Pro 之上叠加私有 src/personal）
// ----------------------------------------------------------------------------
// 与 vite.config.pro.js 的区别：
//   1) 产物目录 = dada-todo-personal（独立插件 id，可与免费版 / Pro 并存）
//   2) 拷贝 manifest.personal.json（id=dada-todo-personal / name=Dada Todo List Personal）
//   3) 入口 = src/core/main.personal.js（installPro + installPersonal）
//   4) define __DADA_PRO__=true（保留完整 Pro 功能）+ __DADA_PERSONAL__=true（个人专属分支）
// 免费版 / Pro 版构建不引用本配置；本配置也不走公开仓库的 Release 工作流（仅本地自用）。
// ============================================================================

const root = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = 'dada-todo-personal';
const isDev = process.env.DADA_DEV === '1';

/** 构建后把 manifest.personal.json 拷进 Personal 产物目录 */
function copyPersonalManifest() {
  return {
    name: 'dada:copy-personal-manifest',
    writeBundle() {
      copyFileSync(resolve(root, 'manifest.personal.json'), resolve(root, OUT_DIR, 'manifest.json'));
    }
  };
}

export default defineConfig({
  plugins: [laWoff2Only(), vue(), copyPersonalManifest()],
  // 编译期注入 dev 标志 + Pro 开关 + Personal 开关 + 兜底手机端无 process 全局
  define: {
    __DADA_DEV__: JSON.stringify(isDev),
    __DADA_PRO__: 'true',
    __DADA_PERSONAL__: 'true',
    'process.env': JSON.stringify({ NODE_ENV: isDev ? 'development' : 'production' })
  },
  build: {
    outDir: OUT_DIR,
    emptyOutDir: !isDev,
    minify: 'esbuild', // Personal 闭源：默认 esbuild 混淆压缩（含 Pro + Personal 私有源码）；如需更强混淆可加 obfuscator 插件
    lib: {
      entry: 'src/core/main.personal.js',
      formats: ['cjs'],
      fileName: () => 'main.js'
    },
    rollupOptions: {
      external: ['obsidian', 'electron', '@electron/remote'],
      output: {
        banner: `try{if(typeof process==='undefined'){globalThis.process={env:{NODE_ENV:${JSON.stringify(isDev ? 'development' : 'production')}}};}}catch(e){}`,
        assetFileNames: (info) => (info.name && info.name.endsWith('.css') ? 'styles.[ext]' : '[name].[ext]')
      }
    },
    cssCodeSplit: false,
    target: 'chrome108',
    assetsInlineLimit: (filePath) => filePath.endsWith('.woff2')
  }
});
