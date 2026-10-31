// ============================================================================
// 任务到点提醒服务
// ----------------------------------------------------------------------------
// 设计要点（思路参考 TaskNotes 的通知实现，按本插件的数据模型做简化）：
//   - 双计时器：每 5 分钟重建一次「未来 5 分钟」待提醒队列，每 30 秒检查到期项。
//     扫描走 vault.cachedRead（Obsidian 内存缓存），不会每次都落盘读文件。
//   - 去重：fired 集合按 `guid@notifyAt` 记录，同一任务同一时刻只提醒一次。
//   - 双通道：系统通知（标准 Web Notification API，非 Electron 私有接口）优先，
//     未授权 / 移动端不支持时自动回落 Obsidian Notice；两条通道点击都能跳到任务行。
//   - 仅在 Obsidian 运行时提醒（没有后台推送）：合盖 / 关机跨天期间错过的提醒静默丢弃，
//     当天迟到的照常提醒并标注「错过」。
//   - 提示音：AudioContext 合成「哒—哒」两声，不打包任何音频文件；
//     AudioContext 处于 suspended（无用户手势）时先 resume 兜底。
// ============================================================================
import { Notice } from 'obsidian';
import { t } from '../i18n/index.js';
import { Tasks } from '../composables/useTasks.js';
import { plainTitle, todayKey, timeText } from '../composables/tasks-logic.js';
import { openTaskInFile } from '../utils/openTaskInFile.js';

const TICK_MS = 30 * 1000;             // 到期检查间隔
const SCAN_MS = 5 * 60 * 1000;         // 队列重建间隔
const AHEAD_MS = 5 * 60 * 1000;        // 队列窗口：只排未来 5 分钟内到点的
const LATE_MS = 2 * 60 * 1000;         // 迟到超过 2 分钟，文案标注为「错过」
const FIRED_CAP = 500;                 // fired 集合上限（防止长期运行无限增长）
const REPLACE_DELAY_MS = 150;          // 系统通知补发间隔（见 showSystemNotification）

// HH:MM（用于「错过提醒」文案里的时间点）
function hhmm(ms) {
  const d = new Date(ms);
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return p(d.getHours()) + ':' + p(d.getMinutes());
}

export class ReminderService {
  constructor(plugin) {
    this.plugin = plugin;
    this.queue = [];
    this.fired = new Set();
    this.lastScanAt = 0;
    this.tickId = 0;
    this.scanning = false;
    this.timeouts = new Set();
    this.contexts = new Set();
    // 已发出的系统通知要一直持有引用：Electron 的通知对象一旦被 GC，弹窗会立刻消失，
    // 表现就是「点了只响一声、看不见弹窗」。
    this.liveNotifications = [];
  }

  // ---------- 生命周期 ----------
  start() {
    if (this.tickId) return;
    // 诊断：启动时把系统通知的真实权限状态打到控制台（排查「有声音没弹窗」的关键信息）
    console.log('[DadaTodo] 提醒服务启动，系统通知权限=' + this.permission);
    this.tickId = window.setInterval(() => { this.tick(); }, TICK_MS);
    // 启动后延迟一小段再首次扫描，避免与 Obsidian 启动期的文件索引抢资源
    const id = window.setTimeout(() => { this.timeouts.delete(id); this.tick(); }, 3000);
    this.timeouts.add(id);
  }

  stop() {
    if (this.tickId) { window.clearInterval(this.tickId); this.tickId = 0; }
    for (const id of this.timeouts) window.clearTimeout(id);
    this.timeouts.clear();
    for (const ctx of this.contexts) { try { if (ctx.state !== 'closed') ctx.close(); } catch (e) { /* 忽略 */ } }
    this.contexts.clear();
    this.queue = [];
    this.fired.clear();
    this.liveNotifications = [];
  }

  async tick() {
    const s = this.plugin.settings;
    if (!s || !s.remindEnabled) { this.queue = []; return; }
    const now = Date.now();
    if (now - this.lastScanAt >= SCAN_MS) await this.scan();
    this.check();
  }

  // ---------- 队列 ----------
  async scan() {
    if (this.scanning) return;
    this.scanning = true;
    try {
      const now = Date.now();
      let tasks = [];
      try {
        tasks = (await Tasks.loadAll()) || [];
      } catch (e) {
        // 日记插件未启用 / 读取失败：只记日志，不打扰用户（下一轮继续尝试）
        console.warn('[DadaTodo] 提醒扫描读取任务失败：', e);
        return;
      }
      const today = todayKey(now);
      const items = [];
      for (const task of tasks) {
        const at = this.notifyAtOf(task, today);
        if (at == null) continue;
        if (at > now + AHEAD_MS) continue;
        const id = `${task.guid}@${at}`;
        if (this.fired.has(id)) continue;
        items.push({ id, task, notifyAt: at });
      }
      items.sort((a, b) => a.notifyAt - b.notifyAt);
      this.queue = items;
      this.lastScanAt = now;
      // 诊断日志：确认「到底有没有扫到任务 / 排到队列」（开发者工具控制台查看）
      console.log(`[DadaTodo] 提醒扫描：任务 ${tasks.length} 条，待提醒 ${items.length} 条，全天规则 ${this.plugin.settings.remindAllDayTime || '关闭'}`);
    } finally {
      this.scanning = false;
    }
  }

  // 任务的提醒时刻：
  //   - 有具体时刻的任务 → 到点即提醒（dueAt）
  //   - 全天任务 → 按设置「全天任务提醒时间」在当天该时刻提醒；设为关闭则不提醒
  //   - 已完成 / 已取消 → 不提醒
  //   注：🔕 标记不再作为关闭提醒的依据（先保证每条任务都能通知到）。
  notifyAtOf(task, today) {
    if (!task || task.completed || task.cancelled) return null;
    const due = Number(task.dueAt);
    if (!Number.isFinite(due)) return null;
    if (task.dueAllDay) {
      const s = this.plugin.settings;
      // 全天任务是否提醒由独立开关控制（关了就整类不提醒）
      if (!s || s.remindAllDay !== true) return null;
      if (todayKey(due) !== today) return null;
      const timeStr = String(s.remindAllDayTime || '').trim();
      const m = /^(\d{1,2}):(\d{2})$/.exec(timeStr);
      if (!m) return null;
      const d = new Date(due);
      return new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.min(23, Number(m[1])), Math.min(59, Number(m[2])), 0, 0).getTime();
    }
    return due;
  }

  check() {
    if (!this.queue.length) return;
    const now = Date.now();
    const due = [];
    const rest = [];
    for (const item of this.queue) {
      if (item.notifyAt <= now) due.push(item); else rest.push(item);
    }
    this.queue = rest;
    const today = todayKey(now);
    for (const item of due) {
      this.markFired(item.id);
      // 跨天的过期提醒（合盖 / 关机跨天）静默丢弃；当天迟到的照常提醒，文案标注「错过」
      if (todayKey(item.notifyAt) !== today) continue;
      this.fire(item, now - item.notifyAt > LATE_MS);
    }
  }

  /** 设置里打开提醒后立刻扫描一次，不用等下一个 5 分钟窗口 */
  async refresh() {
    this.lastScanAt = 0;
    this.queue = [];
    await this.scan();
    this.check();
  }

  markFired(id) {
    this.fired.add(id);
    if (this.fired.size > FIRED_CAP) {
      // Set 按插入顺序迭代，删掉最早的一批
      const drop = this.fired.size - FIRED_CAP;
      let i = 0;
      for (const key of this.fired) {
        if (i++ >= drop) break;
        this.fired.delete(key);
      }
    }
  }

  /** 应用内提示：timeout 传 0 表示常驻到点击为止；给了 onOpen 时点击可跳到任务 */
  inAppNotice(text, onOpen, timeout) {
    const notice = new Notice(text, timeout == null ? 0 : timeout);
    const el = notice && notice.noticeEl;
    if (!el || !onOpen) return notice;
    el.style.cursor = 'pointer';
    el.addEventListener('click', () => {
      try { notice.hide(); } catch (e) { /* 忽略 */ }
      onOpen();
    });
    return notice;
  }

  // ---------- 送达 ----------
  fire(item, missed) {
    const task = item.task;
    const title = plainTitle(task) || t('remind.title');
    const stamp = task.dueAllDay ? t('remind.allDay') : (timeText(task) || '');
    const base = stamp ? t('remind.body', { title, time: stamp }) : title;
    const body = missed ? `${t('remind.missed', { time: hhmm(item.notifyAt) })}：${base}` : base;
    this.playSound();

    // 通道：默认走系统通知，未授权 / 移动端不支持时自动回落应用内；设为 in-app 则只用应用内
    if (this.plugin.settings.remindChannel !== 'in-app' && this.permission === 'granted') {
      try {
        this.showSystemNotification(t('remind.title'), body, item.id, () => openTaskInFile(this.plugin, task));
        return;
      } catch (e) {
        console.warn('[DadaTodo] 系统通知创建失败，回落应用内提示：', e);
      }
    }
    this.inAppNotice(`${t('remind.title')}：${body}`, () => openTaskInFile(this.plugin, task));
  }

  // ---------- 系统通知权限 ----------
  get permission() {
    if (typeof Notification === 'undefined') return 'unsupported';
    try { return Notification.permission; } catch (e) { return 'unsupported'; }
  }

  /** 必须在用户手势（点击）中调用：浏览器只接受手势触发的授权申请。
   *  兼容三种实现：返回 Promise（现代 Chromium）、只走回调（旧 Electron）、两者都不给（超时兜底）。 */
  requestPermission() {
    if (this.permission === 'unsupported') return Promise.resolve('unsupported');
    if (Notification.permission !== 'default') return Promise.resolve(Notification.permission);
    return new Promise((resolve) => {
      let done = false;
      const finish = (p) => {
        if (done) return;
        done = true;
        resolve(p || Notification.permission);
      };
      try {
        const r = Notification.requestPermission(finish);
        if (r && typeof r.then === 'function') r.then(finish, () => finish(Notification.permission));
        // 旧版实现既不返回 Promise 也不回调：给一个长超时兜底，避免永远悬着
        window.setTimeout(() => finish(Notification.permission), 30000);
      } catch (e) {
        finish(Notification.permission);
      }
    });
  }

  /** 发出一条系统通知。
   *  tag 必须稳定复用（测试固定一个、提醒用 guid@到点时间）：macOS 下「新建」的通知
   *  常常不弹横幅，而「替换同 tag 的已有通知」才会真正弹出来，实测就是这个规律。
   *  同时把通知对象存起来，避免被 GC 后弹窗瞬间消失。 */
  showSystemNotification(title, body, tagKey, onOpen) {
    const make = () => {
      const n = new Notification(title, { body, tag: tagKey });
      // Electron 主进程式的 Notification 需要显式 show()；HTML5 式会自动弹出，这里两者都兼容
      if (typeof n.show === 'function') n.show();
      if (onOpen) {
        n.onclick = () => {
          try { n.close(); } catch (e) { /* 忽略 */ }
          onOpen();
        };
      }
      this.liveNotifications.push(n);
      while (this.liveNotifications.length > 30) this.liveNotifications.shift();
      return n;
    };
    make();
    // 实测规律：macOS 下「新建」通知常常不弹横幅，而「替换同 tag 的已有通知」才会弹。
    // 这里在 REPLACE_DELAY_MS 后用相同内容再建一次，让它必然走替换分支；同 tag 下两条只会
    // 留一条，不会出现重复横幅。
    const id = window.setTimeout(() => {
      this.timeouts.delete(id);
      try { make(); } catch (e) { console.warn('[DadaTodo] 补发系统通知失败：', e); }
    }, REPLACE_DELAY_MS);
    this.timeouts.add(id);
  }

  /** 设置页「发送测试提醒」：顺带完成授权申请（同样在点击手势里） */
  async sendTest() {
    const wantSystem = this.plugin.settings.remindChannel !== 'in-app';
    this.playSound();

    // 应用内通道：直接发一条 Obsidian 提示，不涉及系统通知权限，也不报「未发出」
    if (!wantSystem) {
      this.inAppNotice(t('remind.testBody'), null, 5000);
      return;
    }

    const granted = await this.requestPermission();
    let ok = false;
    if (granted === 'granted') {
      try {
        this.showSystemNotification(t('remind.title'), t('remind.testBody'), 'dada-todo-test');
        ok = true;
      } catch (e) {
        console.warn('[DadaTodo] 测试系统通知创建失败：', e);
      }
    }
    // 诊断日志：控制台里能看到权限 / 是否真的创建成功，便于排查
    console.log('[DadaTodo] 提醒测试：系统通知=' + (ok ? '已发出' : '未发出') + '，权限=' + granted);
    if (ok) return;
    // 权限文案在 settings 命名空间下（此前少了前缀，界面上直接显示了 key 本身）
    const reason = granted === 'denied' ? t('settings.remindPermDenied')
      : granted === 'default' ? t('settings.remindPermDefault') : t('settings.remindPermUnsupported');
    this.inAppNotice(t('remind.testFallback', { reason }), null, 6000);
  }

  // ---------- 提示音（Web Audio 合成，无音频文件） ----------
  // 开提醒就有声音，音量固定（不做设置项）。
  // 音色刻意与常见插件（880→1175 的两声 sine）区分开：「哒—哒」两声，
  //   - 波形用 triangle（比 sine 多一点谐波，听感像小铃/木琴，不是电子蜂鸣）
  //   - 音高 E5 → A5（纯四度上扬），第二声略短促收尾，像念「达—达」
  //   - 每声都有 12ms 起音 + 指数衰减包络，避免 TaskNotes 那种硬起硬停的爆音
  playSound() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    try {
      const ctx = new Ctx();
      this.contexts.add(ctx);
      if (ctx.state === 'suspended' && typeof ctx.resume === 'function') ctx.resume().catch(() => {});
      const master = ctx.createGain();
      master.gain.value = 0.6; // 固定主音量（不做到满幅，避免刺耳）
      master.connect(ctx.destination);
      // at：相对现在的起始秒数；dur：发声时长
      const tone = (freq, at, dur) => {
        const osc = ctx.createOscillator();
        const env = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.value = freq;
        osc.connect(env);
        env.connect(master);
        const t0 = ctx.currentTime + at;
        env.gain.setValueAtTime(0.0001, t0);
        env.gain.exponentialRampToValueAtTime(1, t0 + 0.012);    // 起音
        env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur); // 衰减收尾
        osc.start(t0);
        osc.stop(t0 + dur + 0.02);
      };
      tone(659.25, 0, 0.16);     // E5：第一个「哒」
      tone(880.0, 0.20, 0.24);   // A5：第二个「哒」，略高、余音稍长
      const t3 = window.setTimeout(() => {
        this.timeouts.delete(t3);
        this.contexts.delete(ctx);
        try { if (ctx.state !== 'closed') ctx.close(); } catch (e) { /* 忽略 */ }
      }, 900);
      this.timeouts.add(t3);
    } catch (e) {
      // 提示音失败不影响通知本身
    }
  }
}
