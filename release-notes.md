## 0.5.2

### 新增 ✨
- 设置项「完成任务时添加完成日期标记」：勾选完成任务时，在任务行末尾追加完成日期（如 ✅ 2026-10-06）。默认开启，可在「设置 → Dada Todo List → 任务标记」中关闭。关闭后仅不再追加该标记，开始/结束等日期标记不受影响，已存在的 ✅ 标记也不会被自动清除。

### 优化 🧹
- 优化 GitHub Issue 模板（Bug 反馈 / 功能建议）措辞，更口语化；移除了不再依赖的「日记核心插件」收集项。

### bug 修复 🐛
- 修复关闭「完成日期标记」开关后，勾选完成任务仍会被追加完成日期标记的 bug（勾选完成路径未受开关控制）。

### 安装 / 更新
- 手动：将 `main.js`、`styles.css`、`manifest.json` 覆盖到 `你的库/.obsidian/plugins/dada-todo-list/`
- BRAT：添加本仓库地址即可自动更新

---

## 0.5.2 (English)

### Added ✨
- New setting "Add completion date marker when completing a task": appends a completion date to the end of the task line (e.g. ✅ 2026-10-06) when you check it off. On by default; turn it off under Settings → Dada Todo List → Task markers. When off, only this marker is skipped — start/due date tags are unaffected and existing ✅ tags are left as-is.

### Improved 🧹
- Polished the GitHub Issue templates (Bug report / Feature request) wording; removed the no-longer-needed "core Daily notes plugin" field.

### Bug fixes 🐛
- Fixed: with the completion-date marker turned off, checking off a task still appended the marker (the toggle-completion path ignored the setting).

### Install / Update
- Manual: overwrite `main.js`, `styles.css`, `manifest.json` into `YourVault/.obsidian/plugins/dada-todo-list/`
- BRAT: add this repo URL to auto-update
