# Dada Todo List

> A task & checklist manager for Obsidian, built entirely on plain Markdown checkboxes. Your tasks live in your own notes — daily notes, an inbox note, and checklist files. No account, no cloud, no lock-in.

[简体中文](./README.md) · English

---

**Dada Todo List** turns your Obsidian vault into a full-featured task and checklist manager — powered entirely by plain Markdown checkboxes (`- [ ]` / `- [x]`). No accounts, no cloud services, no proprietary database: your tasks are simply lines in your own notes, and the plugin brings them together with calendar, timeline and agenda views plus a polished editing experience.

### Who is it for?

- **Already managing tasks in Obsidian?** If your to-dos are scattered across daily notes and scattered checklists — and finding them means searching — this plugin is for you. It gathers everything you've already written into six views (day / week / month / agenda / checklists / list) with zero migration: your notes stay exactly where they are.
- **Haven't tried task management in Obsidian yet?** You don't need yet another to-do service. Your vault *is* your task manager: plain Markdown that stays readable forever, stored locally, synced with whatever you already use. Start with a single `- [ ]` and grow your own system from there.

### Highlights

- **Six views** — day timeline, seven-day week timeline with lane layout, month calendar (with Chinese lunar dates, solar terms, festivals and statutory holidays), rolling agenda, grouped checklists, and a filterable list of everything
- **Inline syntax** — write `#tags` and `[links](url)` right in the task title; they render as clickable pills and hyperlinks
- **Flexible time** — single time, time ranges (start – end), all-day, or **cross-date** (start date – end date, shown across multiple days), switchable per task
- **Subtasks** — indented lines become nested subtasks of any depth
- **Drag to reschedule** — drag tasks between days, or drag the handles on the timeline to fine-tune start / end times
- **Smart extras** — overdue postponement in one click, `Ctrl/⌘+click` to jump to the source note

### Installation

**Manual**: download `main.js`, `styles.css` and `manifest.json` into
`your-vault/.obsidian/plugins/dada-todo-list/`, then enable the plugin in Settings → Community plugins.

**BRAT**: install [BRAT](https://github.com/TfTHacker/obsidian42-brat) and add this repository.

### Where your data lives

| Data | Location |
|---|---|
| Dated tasks | Your **core Daily notes** folder (follows its folder & date format) — tasks are checkboxes inside each daily note |
| Dateless tasks (inbox) | `DadaTodoList.md` in the vault root by default; configurable, created automatically |
| Checklists | Any note whose frontmatter `tags` include `todoList` (configurable), anywhere in the vault |

Everything is plain Markdown. Uninstalling the plugin changes nothing — your notes stay as they are.

### Writing checklists

Any note whose frontmatter `tags` include the checklist tag (default `todoList`) becomes a checklist. Use **`###` third-level headings as group separators** — the checklist view renders one group per heading:

```markdown
---
tags:
  - todoList
---

### Work
- [ ] Finish the quarterly report #work
    - [ ] Collect data
- [x] Reply to client emails

### Life
- [ ] Book a dentist appointment
```

- **`###` heading = group name**, freely added/renamed/removed; tasks before any heading fall into "Ungrouped"
- **Indented checkboxes are subtasks**, nesting to any depth
- Switch between **list / columns** layouts; **drag a task onto another group** to move it
- Each group has a **+ button** to add tasks; the sidebar shows live total / done progress per checklist

### Data access disclosure

- **File enumeration**: the plugin lists Markdown file paths and their frontmatter to discover daily notes and checklist files (checklists are identified anywhere in the vault by their tags). Only matched daily notes (within the configured load window), the inbox file, and tag-matched checklist files are actually read — no other file's content is ever touched.
- **localStorage**: stores only non-essential UI preferences (current view, filters, onboarding state) on the local device. It never contains note content and is never synced; it is deliberately *not* written to `data.json` to avoid triggering cloud-sync services on every interaction.

### Settings

| Option | Description |
|---|---|
| Open location | Left sidebar / main workspace tab / right sidebar |
| Theme color scheme | Color scheme for task blocks in the timeline, calendar and other views: Default / Morandi / Jelly / Spring / Summer greens / Autumn / Winter; color derived from the task title |
| Show lunar calendar & holidays | Lunar dates, solar terms and holiday badges in day / week / month views; turn off for Gregorian only |
| Journal folder | Folder holding your journals (dated tasks); the plugin scans it and subfolders for notes whose filename contains a date; default `/` means the vault root |
| Journal load window | Load only the last N days of journals (30 / 90 / 180 / 365 / all; default all) — lower it on large vaults for better performance |
| Inbox file | Where dateless tasks are stored (path relative to vault root); changing it offers to migrate existing tasks |
| Checklist file tag(s) | Notes whose frontmatter `tags` include any of these become checklist files; multiple allowed |
| Week starts on | First column of the week view and month calendar; Sunday through Saturday, default Monday |
| Timeline display range | Start and end hours of the timeline view (0:00 – 24:00) to focus on the hours you use |
| Add completion date marker when completing a task | Appends the completion date to the end of the task line when you check it off (e.g. ✅ 2026-10-06). On by default; turn off to skip the marker while keeping start / due date tags |

### Interface

- **Bilingual** — follows Obsidian's interface language (English / 简体中文)
- **Lunar calendar** — lunar dates, solar terms and festivals in month / week view headers, available in English too
- **Theme aware** — all colors use Obsidian's native variables, adapting to light / dark and custom accents

### Language

The interface follows Obsidian's language setting (English / 简体中文). Restart Obsidian after switching.

---

## 💖 Support the author

If this plugin helps you, feel free to buy me a coffee — it keeps me motivated to keep improving it~ You can also find me on [Xiaohongshu](https://xhslink.cn/o/2G9OTVU76WP) for tips and updates.

WeChat Pay

<img src="docs/donate-wechat.jpg" alt="WeChat donation QR" width="300">

Alipay

<img src="docs/donate-alipay.jpg" alt="Alipay donation QR" width="300">

---

## 🛠 Development

```bash
npm install
npm run build     # production build (outputs: dada-todo-list/main.js, styles.css, manifest.json)
npm run dev       # dev mode: rebuild automatically on src/ changes
```

Local debugging: symlink your test vault's plugin folder to the build output (folder name must match the plugin id):

```bash
ln -s "$(pwd)/dada-todo-list" "your-vault/.obsidian/plugins/dada-todo-list"
```

## 📄 License

MIT
