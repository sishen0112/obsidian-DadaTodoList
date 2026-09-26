import { reactive } from 'vue';
import i18next from 'i18next';
import { I18n as LunarI18n } from 'lunar-javascript';
import zhCN from './locales/zh-cn.json';
import en from './locales/en.json';

// ============================================================================
// Dada Todo · i18n（基于 i18next，零额外 Vue 绑定依赖）
// ----------------------------------------------------------------------------
// 语言策略：纯跟随 Obsidian 界面语言。
//   - 优先 app.vault.getConfig('locale')（Obsidian 存储的 UI 语言）
//   - 兜底 window.moment.locale()（Obsidian 全局 moment，跟随 UI 语言）
//   - 中文（zh / zh-cn / zh-tw 等）→ 'zh-cn'，其余 → 'en'
// 资源：locales/zh-cn.json、locales/en.json，按需新增语言只需补 resources。
// ============================================================================

/** 响应式语言状态：t() 内部读取以建立依赖，切语言时使用 t 的视图自动重渲 */
const i18nState = reactive({ lang: 'en' });

/**
 * 翻译函数（i18next 包装）。
 * 用法与 i18next.t 一致：t('key') / t('key', { name })（占位用 {{name}}）。
 * 故意读取 i18nState.lang 以建立响应式依赖（否则切换语言视图不刷新）。
 */
export function t(key, opts) {
  // 触发响应式依赖收集
  void i18nState.lang;
  return i18next.t(key, opts);
}

/** 当前语言码（'zh-cn' | 'en'），供纯函数层（如农历文案）按语言分支 */
export function currentLang() {
  return i18nState.lang;
}

// 语言探测：多来源聚合，全部命中候选后择优。
// 说明：不同版本 Obsidian 的 UI 语言存放位置不一（vault config / localStorage / moment），
// 这里把所有来源都取出来打日志，任一来源以 zh 开头即判定中文。
function detectObsidianLang(app) {
  const candidates = [];
  const push = (src, v) => { if (v) candidates.push([src, String(v)]); };
  try { push('vault.config.locale', app && app.vault && app.vault.getConfig && app.vault.getConfig('locale')); } catch (e) { /* 忽略 */ }
  try { push('localStorage.language', typeof localStorage !== 'undefined' && localStorage.getItem('language')); } catch (e) { /* 忽略 */ }
  try { push('moment.locale', typeof window !== 'undefined' && window.moment && window.moment.locale && window.moment.locale()); } catch (e) { /* 忽略 */ }
  try { push('navigator.language', typeof navigator !== 'undefined' && navigator.language); } catch (e) { /* 忽略 */ }
  // 明确的 UI 语言来源优先；系统语言（navigator）仅在它们全部缺席时作兜底
  const uiSources = candidates.filter(([src]) => src !== 'navigator.language');
  const pool = uiSources.length ? uiSources : candidates;
  for (const [, v] of pool) {
    if (v.toLowerCase().indexOf('zh') === 0) return 'zh-cn';
  }
  return 'en';
}

/** 初始化 i18next：在插件 onload 中 await 调用一次 */
export async function initI18n(app) {
  const lang = detectObsidianLang(app);

  await i18next.init({
    lng: lang,
    fallbackLng: 'en',
    // 关键：i18next 默认会把 'zh-cn' 规范化为 'zh-CN'（语言小写+地区大写），
    // 与全小写的资源键 'zh-cn' 对不上，导致静默回退到英文。锁定全小写。
    lowerCaseLng: true,
    resources: {
      'zh-cn': { translation: zhCN },
      en: { translation: en },
    },
    // Vue 已处理文本渲染，关闭 i18next 的 HTML 转义以免破坏模板
    interpolation: { escapeValue: false },
    // 不强制区分缺失 key 的警告级别，开发期可观察
    saveMissing: false,
  });

  i18nState.lang = lang;
  // lunar-javascript 内置词表（节气 / 节日等）随界面语言切换：
  //   - 注意其语言码为 'chs' / 'en'，与本项目 'zh-cn' / 'en' 不同；
  //   - 必须在任何 Lunar / HolidayUtil 实例化之前调用（实例会缓存计算结果，切换不影响旧实例）。
  LunarI18n.setLanguage(lang === 'zh-cn' ? 'chs' : 'en');
  i18next.on('languageChanged', (lng) => {
    i18nState.lang = lng;
    LunarI18n.setLanguage(lng === 'zh-cn' ? 'chs' : 'en');
  });
  return lang;
}
