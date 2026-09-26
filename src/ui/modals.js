import { Modal, Notice, Setting } from 'obsidian';
import { t } from '../i18n/index.js';

// ============================================================================
// Obsidian 原生 Modal 辅助
// ----------------------------------------------------------------------------
// 弹窗 / 确认框优先用 Obsidian 自带 Modal + Setting 体系：样式（边框、底色、
// 按钮强调色）完全跟随主题，不受 Element Plus 与 Obsidian 全局样式互相污染。
// 文案通过 i18n 的 t() 跟随 Obsidian 界面语言。
// ============================================================================

/** 任务链接编辑弹窗（原生 Modal；link 为 null 表示新增） */
export class LinkFormModal extends Modal {
  /**
   * @param {object} opts
   * @param {object|null} opts.link 编辑时传 { text, url }，新增传 null
   * @param {(item: { text: string, url: string }) => void} opts.onSave 确认回调
   * @param {() => void} [opts.onDelete] 删除回调（仅编辑态显示按钮）
   */
  constructor(app, { link = null, onSave, onDelete }) {
    super(app);
    this.link = link;
    this.onSave = onSave;
    this.onDelete = onDelete;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    this.modalEl.addClass('mylife-form-modal');
    this.titleEl.setText(this.link ? t('modals.linkEdit') : t('modals.linkAdd'));

    const textInput = contentEl.createEl('input', { cls: 'mylife-input', type: 'text' });
    textInput.placeholder = t('modals.linkTextPlaceholder');
    textInput.value = (this.link && this.link.text) || '';
    const urlInput = contentEl.createEl('input', { cls: 'mylife-input', type: 'text' });
    urlInput.placeholder = 'https://';
    urlInput.value = (this.link && this.link.url) || '';

    const ops = new Setting(contentEl);
    if (this.link) {
      ops.addButton((b) => b.setButtonText(t('modals.linkDelete')).setWarning().onClick(() => {
        const cb = this.onDelete;
        this.close();
        if (cb) cb();
      }));
    }
    ops.addButton((b) => b.setButtonText(t('common.cancel')).onClick(() => this.close()));
    ops.addButton((b) => b.setButtonText(t('common.confirm')).setCta().onClick(() => {
      const url = (urlInput.value || '').trim();
      if (!url) { new Notice(t('modals.linkUrlRequired')); return; }
      const text = (textInput.value || '').trim() || url;
      const cb = this.onSave;
      this.close();
      if (cb) cb({ text, url });
    }));

    setTimeout(() => { textInput.focus(); textInput.select(); }, 50);
  }

  onClose() {
    this.contentEl.empty();
  }
}

/** 通用确认弹窗（删除等危险操作） */
export class ConfirmModal extends Modal {
  /**
   * @param {object} opts
   * @param {string} opts.title 标题
   * @param {string} opts.message 正文说明
   * @param {string} [opts.confirmText] 确认按钮文案（默认「确定」）
   * @param {boolean} [opts.danger] 确认按钮用警示色
   * @param {() => void} opts.onConfirm 确认后回调
   */
  constructor(app, { title = t('common.confirm'), message = '', confirmText = t('common.confirm'), danger = false, onConfirm }) {
    super(app);
    this.title = title;
    this.message = message;
    this.confirmText = confirmText;
    this.danger = danger;
    this.onConfirm = onConfirm;
  }

  onOpen() {
    this.titleEl.setText(this.title);
    this.contentEl.createEl('p', { text: this.message });

    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText(t('common.cancel')).onClick(() => this.close()))
      .addButton((b) => {
        b.setButtonText(this.confirmText);
        if (this.danger) b.setWarning();
        b.onClick(() => {
          const cb = this.onConfirm;
          this.close();
          if (cb) cb();
        });
      });
  }

  onClose() {
    this.contentEl.empty();
  }
}
