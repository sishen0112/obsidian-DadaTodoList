import { PluginSettingTab, Notice, AbstractInputSuggest, TFolder, setIcon } from 'obsidian';
import { t } from '../i18n/index.js';
import { countInboxTasks, migrateInboxTasks } from '../api/tasks.js';
import { setColorScheme, setWeekStart, EXTRA_SCHEME_OPTIONS, isImeKey } from '../composables/tasks-logic.js';
import { VIEW_MENU_ITEMS, DEFAULT_MENU_VIEWS, reorderViews } from '../composables/viewMenu.js';

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
export class FolderSuggest extends AbstractInputSuggest {
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
// Dada Todo · 设置页（Obsidian 1.13+ 声明式 API，getSettingDefinitions）
// ----------------------------------------------------------------------------
// 注意：本版本 Obsidian 仅消费 getSettingDefinitions()，经典 display() 已不生效。
// 最外层平铺各基础分区（面板与外观 / 日记设置 / 收件箱与清单 / 视图与日程 /
// 任务标记 / 关于），每个分区用 `type:'group'` + `heading` 给出小标题，组内
// 用 `type:'setting'` + `render` 渲染原有控件（外观与经典 SettingTab 一致）。
// ============================================================================

export class DadaTodoSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  getSettingDefinitions() {
    try {
    const plugin = this.plugin;
    const app = this.app;
    const T = (k) => t('settings.' + k);
    // 临时调试：包裹每个渲染回调，抛错时把错误显示在对应项内而非中断整页渲染
    const safe = (fn) => (s, g) => {
      try { return fn(s, g); } catch (e) {
        try {
          s.setName('⚠ 渲染失败（调试）');
          const pre = s.settingEl.createDiv('dt-debug');
          pre.setText(String((e && e.stack) || e));
        } catch (_) { /* 忽略 */ }
      }
    };
    // 自定义内容挂到 s.controlEl（即 .setting-item-control）——声明式 API 下自定义内容的唯一可靠挂载点，
    // 与 myPara-Plugin 的 s.controlEl.appendChild 写法一致。把整行 setting 改成「无外壳的整块容器」：
    // 整块 block 布局、隐藏名称标签、控件槽占满整行，从而卡片/标题满宽、无 .setting-item 背景框。
    const plainBlock = (s) => {
      s.settingEl.style.display = 'block';
      s.settingEl.style.border = 'none';
      s.settingEl.style.background = 'transparent';
      s.settingEl.style.boxShadow = 'none';
      s.settingEl.style.padding = '0';
      if (s.infoEl) s.infoEl.style.display = 'none';
      s.controlEl.style.flex = '1 1 100%';
      s.controlEl.style.width = '100%';
      s.controlEl.style.marginLeft = '0';
      s.controlEl.empty();
      return s.controlEl;
    };
    // 分组：带小标题的一组设置项
    const group = (headingKey, items) => ({ type: 'group', heading: T(headingKey), items });
    // 行：名称 + 说明 + 控件。name/desc 既写进定义（供搜索/渲染），render 里也显式 set 一次，
    // 兼容「声明式不自动渲染名称」的情况；两种路径文案一致，不会重复。
    const row = (nameKey, descKey, render) => ({
      type: 'setting',
      name: T(nameKey),
      desc: descKey ? T(descKey) : '',
      render: safe((s, g) => {
        s.setName(T(nameKey));
        s.setDesc(descKey ? T(descKey) : '');
        return render(s, g);
      }),
    });

    // 分组：面板与外观
    const appearance = group('groupAppearance', [
      row('openLocation', 'openLocationDesc', (s) => {
        s.addDropdown((dd) => {
          dd.addOption('left', T('locLeft'));
          dd.addOption('main', T('locMain'));
          dd.addOption('right', T('locRight'));
          dd.setValue(plugin.settings.openLocation || 'main');
          dd.onChange(async (value) => {
            plugin.settings.openLocation = value;
            await plugin.saveSettings();
            await plugin.applyOpenLocation();
          });
        });
      }),
      row('menuStyle', 'menuStyleDesc', (s) => {
        s.addDropdown((dd) => {
          dd.addOption('horizontal', T('menuHorizontal'));
          dd.addOption('vertical', T('menuVertical'));
          dd.setValue(plugin.settings.menuStyle || 'horizontal');
          dd.onChange(async (value) => {
            plugin.settings.menuStyle = value;
            await plugin.saveSettings();
          });
        });
      }),
      // 视图菜单：勾选控制显示 / 隐藏，整行拖拽排序；默认全部显示、按当前顺序
      row('menuViews', 'menuViewsDesc', (s) => {
        // 控件整行换行到标题（名称 + 说明）下方，而不是挤在右侧控件列
        s.settingEl.style.flexWrap = 'wrap';
        s.controlEl.style.flex = '1 1 100%';
        s.controlEl.style.width = '100%';
        s.controlEl.style.marginLeft = '0';
        s.controlEl.style.marginTop = '6px';
        const st = plugin.settings;
        const host = s.controlEl.createDiv('dt-menuviews');
        const render = () => {
          host.empty();
          const order = (Array.isArray(st.menuViews) && st.menuViews.length) ? st.menuViews : DEFAULT_MENU_VIEWS;
          const hidden = new Set(Array.isArray(st.menuHiddenViews) ? st.menuHiddenViews : []);
          const byKey = {};
          for (const v of VIEW_MENU_ITEMS) byKey[v.key] = v;
          let dragKey = '';
          for (const key of order) {
            const def = byKey[key];
            if (!def) continue;
            const item = host.createDiv('dt-menuviews-item' + (hidden.has(key) ? ' is-hidden' : ''));
            item.draggable = true;
            const grip = item.createSpan({ cls: 'dt-menuviews-grip' });
            setIcon(grip, 'grip-vertical');
            const cb = item.createEl('input', { type: 'checkbox' });
            cb.checked = !hidden.has(key);
            cb.setAttribute('aria-label', t(def.labelKey));
            cb.addEventListener('change', async () => {
              const set = new Set(Array.isArray(st.menuHiddenViews) ? st.menuHiddenViews : []);
              if (cb.checked) set.delete(key); else set.add(key);
              st.menuHiddenViews = [...set];
              await plugin.saveSettings();
              item.toggleClass('is-hidden', !cb.checked);
            });
            item.createSpan({ text: t(def.labelKey), cls: 'dt-menuviews-label' });
            // 拖拽排序：dragstart 记录源 key，drop 时重排完整顺序（含隐藏项）并重绘
            item.addEventListener('dragstart', () => { dragKey = key; item.addClass('is-dragging'); });
            item.addEventListener('dragend', () => {
              dragKey = '';
              item.removeClass('is-dragging');
              host.querySelectorAll('.dt-menuviews-item.is-over').forEach((n) => n.removeClass('is-over'));
            });
            item.addEventListener('dragover', (e) => {
              if (!dragKey || dragKey === key) return;
              e.preventDefault();
              if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
              item.addClass('is-over');
            });
            item.addEventListener('dragleave', () => item.removeClass('is-over'));
            item.addEventListener('drop', async (e) => {
              e.preventDefault();
              item.removeClass('is-over');
              if (!dragKey || dragKey === key) return;
              const next = reorderViews(order, dragKey, key);
              if (next !== order) {
                st.menuViews = next;
                await plugin.saveSettings();
                render();
              }
            });
          }
        };
        render();
      }),
      row('colorScheme', 'colorSchemeDesc', (s) => {
        s.addDropdown((dd) => {
          dd.addOption('default', T('schemeDefault'));
          dd.addOption('morandi', T('schemeMorandi'));
          dd.addOption('jelly', T('schemeJelly'));
          dd.addOption('spring', T('schemeSpring'));
          dd.addOption('summer', T('schemeSummer'));
          dd.addOption('autumn', T('schemeAutumn'));
          dd.addOption('winter', T('schemeWinter'));
          // 额外配色选项由 EXTRA_SCHEME_OPTIONS 注入；免费版该表为空则不显示
          for (const opt of EXTRA_SCHEME_OPTIONS) dd.addOption(opt.key, t(opt.labelKey));
          dd.setValue(plugin.settings.colorScheme || 'default');
          dd.onChange(async (value) => {
            plugin.settings.colorScheme = value;
            await plugin.saveSettings();
            setColorScheme(value);
            plugin.reloadOpenViews();
          });
        });
      }),
      row('showLunar', 'showLunarDesc', (s) => {
        s.addToggle((tg) => {
          tg.setValue(plugin.settings.showLunar !== false);
          tg.onChange(async (value) => {
            plugin.settings.showLunar = value;
            await plugin.saveSettings();
            plugin.reloadOpenViews();
          });
        });
      }),
    ]);

    // 分组：日记设置（日记文件夹 / 每日笔记加载范围）
    const journal = group('groupJournal', [
      row('journalFolder', 'journalFolderDesc', (s) => {
        s.addText((tx) => {
          tx.setPlaceholder('/');
          tx.setValue(plugin.settings.journalFolder || '/');
          tx.onChange((value) => {
            plugin.settings.journalFolder = (value || '/').trim() || '/';
            plugin.saveSettings();
          });
          new FolderSuggest(app, tx.inputEl, (path) => {
            plugin.settings.journalFolder = (path || '/').trim() || '/';
            plugin.saveSettings();
          });
        });
      }),
      row('dailyWindow', 'dailyWindowDesc', (s) => {
        s.addDropdown((dd) => {
          dd.addOption('30', T('days30'));
          dd.addOption('90', T('days90'));
          dd.addOption('180', T('days180'));
          dd.addOption('365', T('days365'));
          dd.addOption('all', T('daysAll'));
          dd.setValue(plugin.settings.dailyLoadWindow || 'all');
          dd.onChange(async (value) => {
            plugin.settings.dailyLoadWindow = value;
            await plugin.saveSettings();
            plugin.reloadOpenViews();
          });
        });
      }),
    ]);

    // 分组：收件箱与清单（无日期任务文件 / 清单识别标记）
    const inbox = group('groupInbox', [
      row('inboxFile', 'inboxFileDesc', (s) => {
        s.addText((tx) => {
          tx.setPlaceholder('DadaTodoList.md');
          tx.setValue(plugin.settings.inboxFile || 'DadaTodoList.md');
          this._inboxCommitted = plugin.settings.inboxFile || 'DadaTodoList.md';
          tx.onChange((value) => this.handleInboxPathChange(value));
          new MarkdownFileSuggest(app, tx.inputEl, (path) => this.handleInboxPathChange(path));
        });
      }),
      row('checklistTag', 'checklistTagDesc', (s) => {
        // 多标签编辑器：回车添加 → 胶囊展示，× 移除
        const editor = s.controlEl.createDiv('dt-tags-editor');
        const renderChips = () => {
          editor.querySelectorAll('.dt-chip').forEach((n) => n.remove());
          const inputEl = editor.querySelector('input');
          for (const tag of plugin.settings.checklistTags) {
            const chip = editor.createDiv('dt-chip');
            chip.createSpan({ text: tag });
            const del = chip.createEl('button', { text: '×' });
            del.setAttribute('aria-label', tag);
            del.addEventListener('click', async () => {
              plugin.settings.checklistTags = plugin.settings.checklistTags.filter((x) => x !== tag);
              await plugin.saveSettings();
              renderChips();
            });
            if (inputEl) editor.insertBefore(chip, inputEl); else editor.appendChild(chip);
          }
        };
        const tagInput = editor.createEl('input', { type: 'text', placeholder: T('tagPlaceholder') });
        tagInput.addEventListener('keydown', async (e) => {
          // 输入法组字中的回车只上屏候选词，不提交标签
          if (isImeKey(e)) return;
          if (e.key === 'Enter' && tagInput.value.trim()) {
            e.preventDefault();
            const v = tagInput.value.trim().replace(/^#/, '');
            if (!plugin.settings.checklistTags.includes(v)) plugin.settings.checklistTags.push(v);
            await plugin.saveSettings();
            tagInput.value = '';
            renderChips();
          }
        });
        renderChips();
      }),
    ]);

    // 分组：视图与日程（周起始 / 时间轴范围 / 时间选择器步长）
    const views = group('groupViews', [
      row('weekStart', 'weekStartDesc', (s) => {
        s.addDropdown((dd) => {
          dd.addOption('0', T('weekSun'));
          dd.addOption('1', T('weekMon'));
          dd.addOption('2', T('weekTue'));
          dd.addOption('3', T('weekWed'));
          dd.addOption('4', T('weekThu'));
          dd.addOption('5', T('weekFri'));
          dd.addOption('6', T('weekSat'));
          dd.setValue(String(plugin.settings.weekStart ?? 1)); // 默认周一
          dd.onChange(async (value) => {
            const n = parseInt(value, 10) || 0;
            plugin.settings.weekStart = n;
            await plugin.saveSettings();
            setWeekStart(n);
            plugin.reloadOpenViews();
          });
        });
      }),
      row('timelineRange', 'timelineRangeDesc', (s) => {
        s.addDropdown((dd) => {
          for (let h = 0; h <= 23; h++) dd.addOption(String(h), (h < 10 ? '0' : '') + h + ':00');
          dd.setValue(String(plugin.settings.timelineStartHour ?? 0));
          dd.onChange(async (value) => {
            const start = parseInt(value, 10);
            let end = plugin.settings.timelineEndHour ?? 24;
            if (end <= start) { end = start + 1; if (end > 24) end = 24; plugin.settings.timelineEndHour = end; }
            plugin.settings.timelineStartHour = start;
            await plugin.saveSettings();
            plugin.reloadOpenViews();
          });
        }).addDropdown((dd) => {
          for (let h = 1; h <= 24; h++) dd.addOption(String(h), (h < 10 ? '0' : '') + h + ':00');
          dd.setValue(String(plugin.settings.timelineEndHour ?? 24));
          dd.onChange(async (value) => {
            let end = parseInt(value, 10);
            const start = plugin.settings.timelineStartHour ?? 0;
            if (end <= start) end = start + 1;
            if (end > 24) end = 24;
            plugin.settings.timelineEndHour = end;
            await plugin.saveSettings();
            plugin.reloadOpenViews();
          });
        });
      }),
      row('timeStep', 'timeStepDesc', (s) => {
        s.addDropdown((dd) => {
          for (let m = 5; m <= 60; m += 5) dd.addOption(String(m), String(m) + T('minuteUnit'));
          dd.setValue(String(plugin.settings.timeStep || 5));
          dd.onChange(async (value) => {
            plugin.settings.timeStep = parseInt(value, 10) || 5;
            await plugin.saveSettings();
            plugin.reloadOpenViews();
          });
        });
      }),
    ]);

    // 全天任务时间行的 DOM：由开关联动显示 / 隐藏（声明式渲染后再补一次，避免样式被覆盖）
    let allDayTimeRowEl = null;
    const setAllDayTimeVisible = (on) => {
      if (!allDayTimeRowEl) return;
      allDayTimeRowEl.style.display = on ? '' : 'none';
    };
    // 分组：提醒（顺序：总开关 → 全天任务开关 + 时间 → 通知方式 → 测试按钮）
    //   平台限制写在总开关的说明里（带 ⚠️），不再单列提示行
    //   - 提示音：开启提醒即自带，不做开关与音量设置
    //   - 通知方式：系统通知优先，拿不到权限自动回落应用内
    //   - 系统通知权限：打开总开关时顺便申请（点击即用户手势），不单列设置项
    const reminder = group('groupReminder', [
      row('remindEnabled', 'remindEnabledDesc', (s) => {
        s.addToggle((tg) => {
          tg.setValue(plugin.settings.remindEnabled === true); // 默认关
          tg.onChange(async (value) => {
            plugin.settings.remindEnabled = value;
            await plugin.saveSettings();
            if (!value || !plugin.reminder) return;
            // 打开总开关时申请系统通知权限（此刻正处于点击手势中，浏览器才接受申请）
            if (plugin.reminder.permission === 'default') await plugin.reminder.requestPermission();
            // 立刻扫描一遍，不用等下一个 5 分钟窗口
            await plugin.reminder.refresh();
          });
        });
      }),
      row('remindAllDay', 'remindAllDayDesc', (s) => {
        s.addToggle((tg) => {
          tg.setValue(plugin.settings.remindAllDay === true); // 默认关
          tg.onChange(async (value) => {
            plugin.settings.remindAllDay = value;
            await plugin.saveSettings();
            setAllDayTimeVisible(value);
            if (value && plugin.reminder) await plugin.reminder.refresh();
          });
        });
      }),
      row('remindAllDayTime', 'remindAllDayTimeDesc', (s) => {
        // 全天任务开关关闭时整行隐藏（开关与时间在视觉上成一组）
        allDayTimeRowEl = s.settingEl;
        setAllDayTimeVisible(plugin.settings.remindAllDay === true);
        // 声明式渲染可能随后重置行样式，下一帧再补一次
        requestAnimationFrame(() => setAllDayTimeVisible(plugin.settings.remindAllDay === true));
        s.addText((tx) => {
          // 时间选择器：Obsidian 无内置时间控件，用原生 <input type="time">（Electron/Chromium 均支持）
          tx.inputEl.type = 'time';
          tx.inputEl.step = '60';
          tx.setValue(plugin.settings.remindAllDayTime || '10:00');
          tx.onChange(async (value) => {
            const v = String(value || '').trim();
            if (!/^(\d{1,2}):(\d{2})$/.test(v)) return; // 非法值不落盘
            plugin.settings.remindAllDayTime = v;
            await plugin.saveSettings();
            if (plugin.reminder) await plugin.reminder.refresh();
          });
        });
      }),
      row('remindChannel', 'remindChannelDesc', (s) => {
        s.addDropdown((dd) => {
          dd.addOption('system', T('remindSystem'));
          dd.addOption('in-app', T('remindInApp'));
          dd.setValue(plugin.settings.remindChannel === 'in-app' ? 'in-app' : 'system');
          dd.onChange(async (value) => {
            plugin.settings.remindChannel = value;
            await plugin.saveSettings();
          });
        });
      }),
      row('remindTest', 'remindTestDesc', (s) => {
        s.addButton((b) => {
          b.setButtonText(T('remindTestBtn'));
          b.onClick(async () => {
            if (plugin.reminder) await plugin.reminder.sendTest();
          });
        });
      }),
    ]);

    // 分组：任务标记（完成日期标记开关）
    const taskMark = group('groupTaskMark', [
      row('addDoneDateMarker', 'addDoneDateMarkerDesc', (s) => {
        s.addToggle((tg) => {
          tg.setValue(plugin.settings.addDoneDateMarker !== false); // 默认开
          tg.onChange(async (value) => {
            plugin.settings.addDoneDateMarker = value;
            await plugin.saveSettings();
          });
        });
      }),
    ]);

    // 分组：关于（软件信息 / 作者 / 反馈渠道）
    const GH_REPO = 'https://github.com/sishen0112/obsidian-DadaTodoList';
    const GH_ISSUES = GH_REPO + '/issues';
    // 作者小红书主页：用户提供链接后填入此处；留空则不显示小红书按钮
    const XIAOHONGSHU_URL = 'https://xhslink.cn/o/2G9OTVU76WP';
    // 关于：三条标准 setting 行（左侧 name/desc，右侧 版本标签 / 链接按钮），布局参照 EasySync 的关于。
    const COMMUNITY_URL = 'https://community.obsidian.md/plugins/' + plugin.manifest.id;

    // 右侧链接按钮：图标 + 文字，点击新窗打开
    const aboutButton = (parent, icon, label, url) => {
      const a = parent.createEl('a', { cls: 'dt-about-btn' });
      a.setAttribute('href', url);
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener');
      setIcon(a, icon);
      a.createSpan({ text: label });
    };

    const about = group('groupAbout', [
      // 第一行：软件名（左） + 版本标签（右）
      {
        type: 'setting',
        name: plugin.manifest.name,
        desc: '',
        render: safe((s) => {
          s.setName(plugin.manifest.name);
          s.descEl.empty();
          s.controlEl.createSpan({ text: T('version') + ' ' + (plugin.manifest.version || ''), cls: 'dt-about-version-tag' });
        }),
      },
      // 第二行：作者（左：label「作者」+ 作者名） + 插件首页 / GitHub / 小红书 按钮（右）
      {
        type: 'setting',
        name: T('author'),
        desc: plugin.manifest.author || '',
        render: safe((s) => {
          s.setName(T('author'));
          s.setDesc(plugin.manifest.author || '');
          const links = s.controlEl.createDiv('dt-about-links');
          aboutButton(links, 'home', T('pluginHomepage'), COMMUNITY_URL);
          aboutButton(links, 'github', T('github'), plugin.manifest.authorUrl || GH_REPO);
          if (XIAOHONGSHU_URL) aboutButton(links, 'book', T('xiaohongshu'), XIAOHONGSHU_URL);
        }),
      },
      // 第三行：问题反馈（label + 提示文案，「提交 Issue」为跳转 GitHub Issue 的超链接）
      {
        type: 'setting',
        name: T('feedbackTitle'),
        desc: T('feedbackDesc'),
        render: safe((s) => {
          s.setName(T('feedbackTitle'));
          const descEl = s.descEl;
          descEl.empty();
          const tpl = T('feedbackDesc');
          const token = '{issue}';
          const idx = tpl.indexOf(token);
          if (idx === -1) {
            descEl.setText(tpl);
            return;
          }
          descEl.appendText(tpl.slice(0, idx));
          const a = descEl.createEl('a', { text: T('feedbackLink'), href: GH_ISSUES });
          a.setAttribute('target', '_blank');
          a.setAttribute('rel', 'noopener');
          a.addClass('dt-about-feedback-link');
          descEl.appendText(tpl.slice(idx + token.length));
        }),
      },
    ]);

    // 顶部不再单独渲染插件名 + 版本标题行：Obsidian 设置页 Tab 标题本身已是插件名，避免重复

    const defs = [appearance, journal, inbox, views, reminder, taskMark, about];
    return defs;
    } catch (e) {
      // 定义阶段抛错（非常罕见）：直接显示错误
      return [{
        type: 'group',
        heading: '⚠ getSettingDefinitions 抛错（调试）',
        items: [{
          type: 'setting',
          name: 'ERROR',
          desc: String((e && e.message) || e),
          render: (s) => {
            const pre = s.settingEl.createDiv('dt-debug');
            pre.setText(String((e && e.stack) || e));
          }
        }]
      }];
    }
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
      this.plugin.reloadOpenViews();
    });
    const skip = notice.noticeEl.createEl('button', { text: t('common.cancel') });
    skip.addEventListener('click', () => notice.hide());
  }
}
