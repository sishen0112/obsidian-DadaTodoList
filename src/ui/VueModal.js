// Vue-in-Modal 桥：把 Vue 弹窗组件挂进 Obsidian 原生 Modal 的内容区。
// 外壳（遮罩 / 居中 / ESC 关闭 / 主题样式 / 层级）由 Obsidian Modal 提供，
// 组件内部的表单与子组件照常工作；组件 emit update:open=false 时自动关闭 Modal。
import { Modal } from 'obsidian';
import { createApp } from 'vue';
import { t } from '../i18n/index.js';

export class VueModal extends Modal {
  /**
   * @param {App} app
   * @param {object} component Vue 组件定义（如 TaskEditorModal）
   * @param {object} props 传给组件的 props / 事件监听（onSaved 等回调形式）
   * @param {object} [opts] { width: '560px', modalClass: 'cl-cal-modal' }
   */
  constructor(app, component, props = {}, opts = {}) {
    super(app);
    this.component = component;
    this.opts = opts;
    this.vueApp = null;
    // 约定：组件 emit 'update:open' 或 'update:visible' = false → 关闭 Modal（兼容 v-model 用法）
    for (const evt of ['onUpdate:open', 'onUpdate:visible']) {
      const orig = props[evt];
      props[evt] = (v) => {
        if (orig) orig(v);
        if (v === false) this.close();
      };
    }
    this.props = props;
  }

  onOpen() {
    this.modalEl.addClass('mylife-vue-modal');
    if (this.opts.modalClass) this.modalEl.addClass(this.opts.modalClass);
    if (this.opts.width) this.modalEl.style.width = this.opts.width;
    const host = this.contentEl.createDiv('mylife-vue-host');
    this.vueApp = createApp(this.component, this.props);
    // i18n：VueModal 是独立于主视图的 Vue 应用（TaskEditorModal / ChecklistDoneCalendar），
    // $t / provide('t') 必须在此单独注入，否则弹窗内 $t 不存在
    this.vueApp.config.globalProperties.$t = t;
    this.vueApp.provide('t', t);
    this.vueApp.mount(host);
  }

  onClose() {
    if (this.vueApp) {
      this.vueApp.unmount();
      this.vueApp = null;
    }
    this.contentEl.empty();
  }
}
