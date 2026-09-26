import { ItemView, Plugin } from 'obsidian';
import { createApp } from 'vue';
import { ElTooltip, ElButton, ElButtonGroup, ElDropdown, ElDropdownMenu, ElDropdownItem, ElRadioGroup, ElRadioButton } from 'element-plus';
import 'element-plus/es/components/tooltip/style/css';
import 'element-plus/es/components/button/style/css';
import 'element-plus/es/components/button-group/style/css';
import 'element-plus/es/components/dropdown/style/css';
import 'element-plus/es/components/dropdown-menu/style/css';
import 'element-plus/es/components/dropdown-item/style/css';
import 'element-plus/es/components/radio/style/css';
import 'element-plus/es/components/radio-group/style/css';
import 'element-plus/es/components/radio-button/style/css';
import TasksApp from './views/TasksApp.vue';
import { initTasksApi, ensureInboxFile } from './api/tasks.js';
import { setupDevReload } from './dev/devReload.js';
import { DadaTodoSettingTab } from './ui/settings.js';
import { initI18n, t } from './i18n/index.js';
import 'line-awesome/dist/line-awesome/css/line-awesome.min.css';
import './styles/tokens.css';
import './styles/modals.css';
import './styles/task-modal.css';

// ============================================================================
// Dada Todo · Obsidian 插件入口（任务模块来自 myLife-Plugin）
// ----------------------------------------------------------------------------
// 技术栈：Vue 3（createApp / unmount）。
// 注意：本文件只允许 default 导出插件类（Obsidian 以 module.exports 取它）。
//   插件实例同时挂到 app.config.globalProperties.plugin（TasksApp 等用 this.plugin）
//   与 app.provide('plugin', this)（兼容 inject 写法），数据层走 saveData / api/tasks.js。
// ============================================================================

const VIEW_TYPE_DADA_TODO = 'dada-todo-view';

/** 待办视图：Obsidian 侧栏面板，挂载 Vue 应用 */
class DadaTodoView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.vueApp = null;
  }

  getViewType() { return VIEW_TYPE_DADA_TODO; }
  // 视图标题跟随界面语言：中文「达达清单」，英文「Dada Todo List」
  getDisplayText() { return t('app.viewTitle'); }
  getIcon() { return 'check-square'; }

  async onOpen() {
    const root = this.contentEl.createDiv('dada-todo-root');
    root.style.height = '100%';

    this.vueApp = createApp(TasksApp);
    // 仅按需引入 Element Plus 的 Tooltip 组件（含最小样式：base 变量 + popper + tooltip）
    this.vueApp.component('ElTooltip', ElTooltip);
    // 顶栏控件：按钮 / 按钮组 / 下拉菜单（主题色由 tokens.css 的 --el-color-primary 映射为 --gold）
    this.vueApp.component('ElButton', ElButton);
    this.vueApp.component('ElButtonGroup', ElButtonGroup);
    this.vueApp.component('ElDropdown', ElDropdown);
    this.vueApp.component('ElDropdownMenu', ElDropdownMenu);
    this.vueApp.component('ElDropdownItem', ElDropdownItem);
    // 清单视图「列表 / 分栏」单选（主题色：--el-color-primary 已映射为 --gold）
    this.vueApp.component('ElRadioGroup', ElRadioGroup);
    this.vueApp.component('ElRadioButton', ElRadioButton);
    // 插件实例挂为全局属性（TasksApp 用 this.plugin）并一并 provide（兼容 inject）
    this.vueApp.config.globalProperties.plugin = this.plugin;
    this.vueApp.provide('plugin', this.plugin);
    // i18n 翻译函数：组件内可用 inject('t') 或模板 $t（均已响应式，切语言自动重渲）
    this.vueApp.config.globalProperties.$t = t;
    this.vueApp.provide('t', t);
    // mount 返回根组件公共代理：供数据相关设置变更后触发面板重载
    this.vueRoot = this.vueApp.mount(root);
  }

  async onClose() {
    if (this.vueApp) {
      this.vueApp.unmount();
      this.vueApp = null;
      this.vueRoot = null;
    }
    this.contentEl.empty();
  }
}

export default class DadaTodoPlugin extends Plugin {
  async onload() {
    // 配置常驻内存（官方推荐模式：onload 时 await 读取）
    await this.loadSettings();

    // 初始化 i18n：跟随 Obsidian 界面语言（zh-cn / en）
    await initI18n(this);

    // 任务数据层注入插件实例（vault / metadataCache 读写）
    initTasksApi(this);
    // 核心「日记」插件未启用的提醒改为面板顶部提醒条（TasksApp 内，随面板实时检测）

    // 收件箱文件不存在时创建（首次使用 / 用户改路径后）；
    // 创建失败不阻断插件加载（仅后续写任务会报错）
    try {
      await ensureInboxFile();
    } catch (e) {
      console.warn('[DadaTodo] 创建收件箱文件失败：', e);
    }

    this.registerView(VIEW_TYPE_DADA_TODO, (leaf) => new DadaTodoView(leaf, this));

    this.addRibbonIcon('check-square', t('app.openDada'), () => this.activateView());

    this.addCommand({
      id: 'open-dada-todo',
      name: t('app.openDada'),
      callback: () => this.activateView()
    });

    this.addSettingTab(new DadaTodoSettingTab(this.app, this));

    // 启动 Obsidian 后自动打开本插件面板（需在 workspace 布局就绪后操作）
    this.app.workspace.onLayoutReady(() => {
      if (this.settings.autoOpen) this.activateView();
    });

    console.log('[DadaTodo] 插件已加载');

    // 开发期热更新（生产构建下 __DADA_DEV__ 为 false，整段会被摇掉）
    if (__DADA_DEV__) {
      setupDevReload(this);
    }
  }

  /** 在指定区域打开待办视图（left=左侧栏 / main=主窗口标签页 / right=右侧栏） */
  async openInLocation(loc) {
    const { workspace } = this.app;
    let leaf;
    if (loc === 'left') leaf = workspace.getLeftLeaf(true);
    else if (loc === 'right') leaf = workspace.getRightLeaf(true);
    else leaf = workspace.getLeaf('tab'); // 主窗口
    await leaf.setViewState({ type: VIEW_TYPE_DADA_TODO, active: true });
    workspace.revealLeaf(leaf);
  }

  /** 已打开则聚焦；否则按配置位置打开 */
  async activateView() {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(VIEW_TYPE_DADA_TODO);
    if (existing.length) {
      workspace.revealLeaf(existing[0]);
      return;
    }
    await this.openInLocation(this.settings.openLocation || 'main');
  }

  /** 切换打开位置：关闭现有面板并按新位置重新打开 */
  async applyOpenLocation() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_DADA_TODO);
    await this.openInLocation(this.settings.openLocation || 'main');
  }

  onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_DADA_TODO);
  }

  async loadSettings() {
    const data = (await this.loadData()) || {};
    // 清单识别标记（数组，任一命中即识别清单文件）：兼容旧单值 checklistTag → 数组
    const checklistTags = Array.isArray(data.checklistTags) && data.checklistTags.length
      ? data.checklistTags.map((s) => String(s).trim()).filter(Boolean)
      : (typeof data.checklistTag === 'string' && data.checklistTag.trim()
        ? [data.checklistTag.trim()]
        : ['todoList']);
    this.settings = {
      // 打开位置：左侧栏 / 主工作区标签页 / 右侧栏
      openLocation: data.openLocation || 'main',
      // 启动 Obsidian 后是否自动打开本插件面板
      autoOpen: data.autoOpen ?? false,
      // 是否显示农历与节假日（日 / 周 / 月视图表头与日历格）
      showLunar: data.showLunar ?? true,
      // 无日期任务的存放文件（相对库根目录）
      inboxFile: data.inboxFile || 'DadaTodoList.md',
      // 清单识别标记：frontmatter tags 含任一标签的笔记即清单文件
      checklistTags,
      // 每日笔记加载窗口（天）：默认 'all'；大库可调小以提升加载性能
      dailyLoadWindow: data.dailyLoadWindow || 'all',
    };
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  // 数据相关设置（每日笔记加载范围 / 收件箱路径）变更后调用：
  // 刷新所有已打开的面板，让新配置立即生效，无需手动重开面板
  reloadOpenViews() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_DADA_TODO)) {
      const v = leaf.view;
      if (v && v.vueRoot && typeof v.vueRoot.load === 'function') v.vueRoot.load();
    }
  }
}
