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

/** 标签颜色预设色板（issue #8）：侧栏取色弹窗与设置页共用一组常用色 */
export const TAG_COLOR_PRESETS = ['#e5484d', '#e5683c', '#d9a514', '#3fa144', '#2aa198',
  '#3b82f6', '#7c6bd9', '#c15bc0', '#8d6e63', '#6b7280'];

/**
 * 标签取色弹窗（issue #8，原生 Modal）：预设色板 + 用户已自定义的颜色 + 自定义取色器。
 * 确认后经 onSave 上抛，由调用方落盘（settings.tagColors → data.json）并刷新视图。
 */
export class TagColorModal extends Modal {
  /**
   * @param {object} opts
   * @param {string} opts.tag 标签名
   * @param {string} [opts.color] 当前颜色 #hex（未设置为空串）
   * @param {string[]} [opts.customColors] 用户已用过的自定义色（去重后追加在预设之后）
   * @param {(tag: string, color: string) => void} opts.onSave 确认回调（color 为 #hex）
   */
  constructor(app, { tag, color = '', customColors = [], onSave }) {
    super(app);
    this.tag = tag;
    this.color = color;
    this.customColors = customColors;
    this.onSave = onSave;
    this.selected = /^#[0-9a-fA-F]{6}$/.test(color) ? color : '';
    this.gridEl = null;
    this.previewEl = null;
    this.inputEl = null;
    this.hexEl = null;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    this.modalEl.addClass('tk-tagcolor-modal');
    this.titleEl.setText(t('app.tagColorTitle'));

    contentEl.createEl('div', { cls: 'tk-tagcolor-tag', text: '#' + this.tag });

    // 色板：「无颜色」在最前，预设其次，用户自定义过的颜色追加在后（去重，不与预设重复）
    const grid = contentEl.createEl('div', { cls: 'tk-tagcolor-grid' });
    this.gridEl = grid;
    const none = grid.createEl('button', {
      cls: 'tk-tagcolor-swatch tk-tagcolor-none',
      attr: { type: 'button', 'data-c': '', title: t('app.tagColorNone') }
    });
    none.addEventListener('click', () => this.apply(''));
    const all = [...TAG_COLOR_PRESETS, ...this.customColors.filter((c) => !TAG_COLOR_PRESETS.includes(c))];
    for (const c of all) {
      const b = grid.createEl('button', { cls: 'tk-tagcolor-swatch', attr: { type: 'button', 'data-c': c } });
      b.style.background = c;
      if (c === this.selected) b.addClass('on');
      b.addEventListener('click', () => this.apply(c));
    }

    // 自定义行：点预览色块弹系统取色器实时预览，点「保存」才生效
    const row = contentEl.createEl('div', { cls: 'tk-tagcolor-customrow' });
    row.createEl('span', { cls: 'tk-tagcolor-label', text: t('app.tagColorCustom') });
    const preview = row.createEl('span', { cls: 'tk-tagcolor-preview' });
    const hexEl = row.createEl('span', { cls: 'tk-tagcolor-hex' });
    const input = preview.createEl('input', { type: 'color' });
    this.previewEl = preview;
    this.hexEl = hexEl;
    this.inputEl = input;
    input.addEventListener('input', () => this.apply(input.value));

    new Setting(contentEl)
      .addButton((b) => b.setButtonText(t('common.cancel')).onClick(() => this.close()))
      .addButton((b) => b.setButtonText(t('common.save')).setCta().onClick(() => {
        // selected 为空串 = 选了「无颜色」：由调用方删除该标签已有颜色
        const cb = this.onSave;
        const { tag, selected } = this;
        this.close();
        if (cb) cb(tag, selected);
      }));

    this.apply(this.selected);
  }

  /** 选中颜色：同步色板高亮、预览色块、hex 文本与取色器初值 */
  apply(c) {
    this.selected = c;
    if (this.gridEl) {
      this.gridEl.querySelectorAll('.tk-tagcolor-swatch').forEach((el) => {
        el.classList.toggle('on', el.dataset.c === c);
      });
    }
    if (this.previewEl) this.previewEl.style.background = c || 'transparent';
    if (this.inputEl) this.inputEl.value = c || '#7c6bd9';
    if (this.hexEl) this.hexEl.setText(c || '—');
  }

  onClose() {
    this.contentEl.empty();
  }
}
