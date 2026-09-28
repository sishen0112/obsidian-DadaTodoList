import { PluginSettingTab, Notice, Setting, AbstractInputSuggest } from 'obsidian';
import { t } from '../i18n/index.js';
import { countInboxTasks, migrateInboxTasks } from '../api/tasks.js';
import { setColorScheme } from '../composables/tasks-logic.js';

// 收件箱文件路径补全：输入时浮层建议库内 md 文件（也允许手输尚不存在的路径，启动时会自动创建）
class MarkdownFileSuggest extends AbstractInputSuggest {
  constructor(app, inputEl, onPick) {
    super(app, inputEl);
    this.onPick = onPick;
  }

  getSuggestions(query) {
    const q = String(query || '').toLowerCase().replace(/^\/+/, '');
    return this.app.vault.getMarkdownFiles()
      .filter((f) => f.path.toLowerCase().includes(q))
      .slice(0, 30);
  }

  renderSuggestion(file, el) {
    el.setText(file.path);
  }

  selectSuggestion(file) {
    this.setValue(file.path);
    if (this.onPick) this.onPick(file.path);
    this.close();
  }
}

// ============================================================================
// Dada Todo · 设置页
// ----------------------------------------------------------------------------
// 仅一个配置项：面板打开位置（左侧区域 / 主窗口 / 右侧区域），存于 data.json。
// 官方声明式设置 API 在 1.13+ 才稳定，这里用经典 SettingTab 写法，兼容 minAppVersion 1.5.0。
// 文案通过 i18n 的 t() 跟随 Obsidian 界面语言。
// ============================================================================

export class DadaTodoSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: t('settings.title') });

    new Setting(containerEl)
      .setName(t('settings.openLocation'))
      .setDesc(t('settings.openLocationDesc'))
      .addDropdown((dd) => {
        dd.addOption('left', t('settings.locLeft'));
        dd.addOption('main', t('settings.locMain'));
        dd.addOption('right', t('settings.locRight'));
        dd.setValue(this.plugin.settings.openLocation || 'main');
        dd.onChange(async (value) => {
          this.plugin.settings.openLocation = value;
          await this.plugin.saveSettings();
          // 立即按新位置重新打开面板
          await this.plugin.applyOpenLocation();
        });
      });

    new Setting(containerEl)
      .setName(t('settings.inboxFile'))
      .setDesc(t('settings.inboxFileDesc'))
      .addText((tx) => {
        tx.setPlaceholder('DadaTodoList.md');
        tx.setValue(this.plugin.settings.inboxFile || 'DadaTodoList.md');
        // 上次确认的收件箱路径（迁移询问以它为源，避免逐字符输入产生中间态）
        this._inboxCommitted = this.plugin.settings.inboxFile || 'DadaTodoList.md';
        tx.onChange((value) => this.handleInboxPathChange(value));
        // 路径自动补全（输入时浮层建议库内 md 文件）
        new MarkdownFileSuggest(this.app, tx.inputEl, (path) => this.handleInboxPathChange(path));
      });

    const tagSetting = new Setting(containerEl)
      .setName(t('settings.checklistTag'))
      .setDesc(t('settings.checklistTagDesc'));
    // 多标签编辑器：回车添加 → 胶囊展示，× 移除
    const editor = tagSetting.controlEl.createDiv('dt-tags-editor');
    const renderChips = () => {
      editor.querySelectorAll('.dt-chip').forEach((n) => n.remove());
      const inputEl = editor.querySelector('input');
      for (const tag of this.plugin.settings.checklistTags) {
        const chip = editor.createDiv('dt-chip');
        chip.createSpan({ text: tag });
        const del = chip.createEl('button', { text: '×' });
        del.setAttribute('aria-label', tag);
        del.addEventListener('click', async () => {
          this.plugin.settings.checklistTags = this.plugin.settings.checklistTags.filter((x) => x !== tag);
          await this.plugin.saveSettings();
          renderChips();
        });
        if (inputEl) editor.insertBefore(chip, inputEl); else editor.appendChild(chip);
      }
    };
    const tagInput = editor.createEl('input', { type: 'text', placeholder: t('settings.tagPlaceholder') });
    tagInput.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter' && tagInput.value.trim()) {
        e.preventDefault();
        const v = tagInput.value.trim().replace(/^#/, '');
        if (!this.plugin.settings.checklistTags.includes(v)) this.plugin.settings.checklistTags.push(v);
        await this.plugin.saveSettings();
        tagInput.value = '';
        renderChips();
      }
    });
    renderChips();

    new Setting(containerEl)
      .setName(t('settings.dailyWindow'))
      .setDesc(t('settings.dailyWindowDesc'))
      .addDropdown((dd) => {
        dd.addOption('30', t('settings.days30'));
        dd.addOption('90', t('settings.days90'));
        dd.addOption('180', t('settings.days180'));
        dd.addOption('365', t('settings.days365'));
        dd.addOption('all', t('settings.daysAll'));
        dd.setValue(this.plugin.settings.dailyLoadWindow || 'all');
        dd.onChange(async (value) => {
          this.plugin.settings.dailyLoadWindow = value;
          await this.plugin.saveSettings();
          // 立即生效：加载范围影响每日笔记读取集合，刷新已打开的面板
          this.plugin.reloadOpenViews();
        });
      });

    new Setting(containerEl)
      .setName(t('settings.autoOpen'))
      .setDesc(t('settings.autoOpenDesc'))
      .addToggle((tg) => {
        tg.setValue(this.plugin.settings.autoOpen);
        tg.onChange(async (value) => {
          this.plugin.settings.autoOpen = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName(t('settings.showLunar'))
      .setDesc(t('settings.showLunarDesc'))
      .addToggle((tg) => {
        tg.setValue(this.plugin.settings.showLunar !== false);
        tg.onChange(async (value) => {
          this.plugin.settings.showLunar = value;
          await this.plugin.saveSettings();
          // 立即生效：刷新已打开的面板（农历渲染非响应式，靠重载触发重算）
          this.plugin.reloadOpenViews();
        });
      });

    new Setting(containerEl)
      .setName(t('settings.colorScheme'))
      .setDesc(t('settings.colorSchemeDesc'))
      .addDropdown((dd) => {
        dd.addOption('default', t('settings.schemeDefault'));
        dd.addOption('morandi', t('settings.schemeMorandi'));
        dd.addOption('jelly', t('settings.schemeJelly'));
        dd.setValue(this.plugin.settings.colorScheme || 'default');
        dd.onChange(async (value) => {
          this.plugin.settings.colorScheme = value;
          await this.plugin.saveSettings();
          // 立即生效：切换到对应配色方案并刷新已打开的面板
          setColorScheme(value);
          this.plugin.reloadOpenViews();
        });
      });
  }

  // 收件箱路径变更（输入逐字符触发 / 补全选中触发）：去抖 1s 后统一处理
  handleInboxPathChange(value) {
    const newPath = String(value || '').trim() || 'DadaTodoList.md';
    this.plugin.settings.inboxFile = newPath;
    this.plugin.saveSettings();
    if (newPath === this._inboxCommitted) return;
    const from = this._inboxCommitted;
    clearTimeout(this._inboxMoveTimer);
    this._inboxMoveTimer = setTimeout(async () => {
      await this.offerInboxMove(from, newPath);
      this._inboxCommitted = newPath;
    }, 1000);
  }

  // 收件箱换路径：旧文件还有任务时询问是否整体迁移
  async offerInboxMove(oldPath, newPath) {
    const n = await countInboxTasks(oldPath);
    // 无论迁移与否，收件箱路径变了 → 任务池变化，刷新已打开的面板
    this.plugin.reloadOpenViews();
    if (!n) return;
    const notice = new Notice(t('settings.inboxMoveAsk', { n }), 0);
    const go = notice.noticeEl.createEl('button', { text: t('settings.inboxMoveGo') });
    go.style.marginRight = '8px';
    go.addEventListener('click', async () => {
      const moved = await migrateInboxTasks(oldPath, newPath);
      notice.hide();
      new Notice(t('settings.inboxMoved', { n: moved }));
      this.plugin.reloadOpenViews(); // 迁移落盘后再刷新一次
    });
    const skip = notice.noticeEl.createEl('button', { text: t('common.cancel') });
    skip.addEventListener('click', () => notice.hide());
  }
}
