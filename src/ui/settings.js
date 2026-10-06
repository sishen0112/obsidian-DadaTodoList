import { PluginSettingTab, Notice, Setting, AbstractInputSuggest, TFolder } from 'obsidian';
import { t } from '../i18n/index.js';
import { countInboxTasks, migrateInboxTasks } from '../api/tasks.js';
import { setColorScheme, setWeekStart } from '../composables/tasks-logic.js';

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

// 日记文件夹输入补全：输入时浮层建议库内文件夹（含库根 /）
class FolderSuggest extends AbstractInputSuggest {
  constructor(app, inputEl, onPick) {
    super(app, inputEl);
    this.onPick = onPick;
  }

  getSuggestions(query) {
    const q = String(query || '').toLowerCase().replace(/^\/+/, '');
    return this.app.vault.getAllLoadedFiles()
      .filter((f) => f instanceof TFolder && f.path.toLowerCase().includes(q))
      .slice(0, 30);
  }

  renderSuggestion(folder, el) {
    el.setText(folder.path || '/');
  }

  selectSuggestion(folder) {
    const v = folder.path || '/';
    this.setValue(v);
    if (this.onPick) this.onPick(v);
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

    // 分组：面板与外观
    new Setting(containerEl).setHeading().setName(t('settings.groupAppearance'));

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
      .setName(t('settings.colorScheme'))
      .setDesc(t('settings.colorSchemeDesc'))
      .addDropdown((dd) => {
        dd.addOption('default', t('settings.schemeDefault'));
        dd.addOption('morandi', t('settings.schemeMorandi'));
        dd.addOption('jelly', t('settings.schemeJelly'));
        dd.addOption('spring', t('settings.schemeSpring'));
        dd.addOption('summer', t('settings.schemeSummer'));
        dd.addOption('autumn', t('settings.schemeAutumn'));
        dd.addOption('winter', t('settings.schemeWinter'));
        dd.setValue(this.plugin.settings.colorScheme || 'default');
        dd.onChange(async (value) => {
          this.plugin.settings.colorScheme = value;
          await this.plugin.saveSettings();
          // 立即生效：切换到对应配色方案并刷新已打开的面板
          setColorScheme(value);
          this.plugin.reloadOpenViews();
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

    // 分组：日记设置（日记文件夹 / 每日笔记加载范围）
    new Setting(containerEl).setHeading().setName(t('settings.groupJournal'));

    new Setting(containerEl)
      .setName(t('settings.journalFolder'))
      .setDesc(t('settings.journalFolderDesc'))
      .addText((tx) => {
        tx.setPlaceholder('/');
        tx.setValue(this.plugin.settings.journalFolder || '/');
        tx.onChange((value) => {
          this.plugin.settings.journalFolder = (value || '/').trim() || '/';
          this.plugin.saveSettings();
        });
        // 输入时浮层建议库内文件夹（含库根 /）
        new FolderSuggest(this.app, tx.inputEl, (path) => {
          this.plugin.settings.journalFolder = (path || '/').trim() || '/';
          this.plugin.saveSettings();
        });
      });

    // 日记文件宽松匹配：默认打开；暂不在设置页暴露开关，待用户反馈后再决定是否保留
    // new Setting(containerEl)
    //   .setName(t('settings.journalLooseMatch'))
    //   .setDesc(t('settings.journalLooseMatchDesc'))
    //   .addToggle((tg) => {
    //     tg.setValue(this.plugin.settings.journalLooseMatch !== false); // 默认开
    //     tg.onChange(async (value) => {
    //       this.plugin.settings.journalLooseMatch = value;
    //       await this.plugin.saveSettings();
    //       this.plugin.reloadOpenViews();
    //     });
    //   });

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

    // 分组：收件箱与清单（无日期任务文件 / 清单识别标记）
    new Setting(containerEl).setHeading().setName(t('settings.groupInbox'));

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

    // 分组：视图与日程（周起始 / 时间轴范围）
    new Setting(containerEl).setHeading().setName(t('settings.groupViews'));

    new Setting(containerEl)
      .setName(t('settings.weekStart'))
      .setDesc(t('settings.weekStartDesc'))
      .addDropdown((dd) => {
        dd.addOption('0', t('settings.weekSun'));
        dd.addOption('1', t('settings.weekMon'));
        dd.addOption('2', t('settings.weekTue'));
        dd.addOption('3', t('settings.weekWed'));
        dd.addOption('4', t('settings.weekThu'));
        dd.addOption('5', t('settings.weekFri'));
        dd.addOption('6', t('settings.weekSat'));
        dd.setValue(String(this.plugin.settings.weekStart ?? 1)); // 默认周一
        dd.onChange(async (value) => {
          const n = parseInt(value, 10) || 0;
          this.plugin.settings.weekStart = n;
          await this.plugin.saveSettings();
          // 立即生效：更新全局周起始并刷新已打开的面板（周 / 月视图与日历格首列重排）
          setWeekStart(n);
          this.plugin.reloadOpenViews();
        });
      });

    new Setting(containerEl)
      .setName(t('settings.timelineRange'))
      .setDesc(t('settings.timelineRangeDesc'))
      .addDropdown((dd) => {
        for (let h = 0; h <= 23; h++) dd.addOption(String(h), (h < 10 ? '0' : '') + h + ':00');
        dd.setValue(String(this.plugin.settings.timelineStartHour ?? 0));
        dd.onChange(async (value) => {
          const start = parseInt(value, 10);
          let end = this.plugin.settings.timelineEndHour ?? 24;
          if (end <= start) { end = start + 1; if (end > 24) end = 24; this.plugin.settings.timelineEndHour = end; }
          this.plugin.settings.timelineStartHour = start;
          await this.plugin.saveSettings();
          this.plugin.reloadOpenViews();
          this.display();
        });
      })
      .addDropdown((dd) => {
        for (let h = 1; h <= 24; h++) dd.addOption(String(h), (h < 10 ? '0' : '') + h + ':00');
        dd.setValue(String(this.plugin.settings.timelineEndHour ?? 24));
        dd.onChange(async (value) => {
          let end = parseInt(value, 10);
          const start = this.plugin.settings.timelineStartHour ?? 0;
          if (end <= start) end = start + 1;
          if (end > 24) end = 24;
          this.plugin.settings.timelineEndHour = end;
          await this.plugin.saveSettings();
          this.plugin.reloadOpenViews();
          this.display();
        });
      });

    // 分组：任务标记（完成日期标记开关）
    new Setting(containerEl).setHeading().setName(t('settings.groupTaskMark'));

    new Setting(containerEl)
      .setName(t('settings.addDoneDateMarker'))
      .setDesc(t('settings.addDoneDateMarkerDesc'))
      .addToggle((tg) => {
        tg.setValue(this.plugin.settings.addDoneDateMarker !== false); // 默认开
        tg.onChange(async (value) => {
          this.plugin.settings.addDoneDateMarker = value;
          await this.plugin.saveSettings();
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
