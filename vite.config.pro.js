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
// Dada Todo Pro · 构建配置（与免费版共用源码 core，叠加私有 src/pro）
// ----------------------------------------------------------------------------
// 与 vite.config.js（免费版）的区别：
//   1) 产物目录 = dada-todo-pro（与 manifest.id 一致，作为独立插件安装，不与免费版冲突）
//   2) 拷贝 manifest.pro.json（id=dada-todo-pro / name=Dada Todo List Pro）
//   3) define __DADA_PRO__=true：开启 Pro 增强（动态引入 src/pro），并启用混淆压缩
// 免费版 vite.config.js 保持原样，GitHub Actions 打 tag 仍走免费构建，不受影响。
// ============================================================================

const root = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = 'dada-todo-pro';
const isDev = process.env.DADA_DEV === '1';

/** 构建后把 manifest.pro.json 拷进 Pro 产物目录 */
function copyProManifest() {
  return {
    name: 'dada:copy-pro-manifest',
    writeBundle() {
      copyFileSync(resolve(root, 'manifest.pro.json'), resolve(root, OUT_DIR, 'manifest.json'));
    }
  };
}

export default defineConfig({
  plugins: [laWoff2Only(), vue(), copyProManifest()],
  // 编译期注入 dev 标志 + Pro 开关 + 兜底手机端无 process 全局
  define: {
    __DADA_DEV__: JSON.stringify(isDev),
    __DADA_PRO__: 'true',
    __DADA_PERSONAL__: 'false',
    'process.env': JSON.stringify({ NODE_ENV: isDev ? 'development' : 'production' })
  },
  build: {
    outDir: OUT_DIR,
    emptyOutDir: !isDev,
    minify: 'esbuild', // Pro 闭源：默认 esbuild 混淆压缩（不发布源码）；如需更强混淆可加 obfuscator 插件
    lib: {
      entry: 'src/core/main.pro.js',
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
