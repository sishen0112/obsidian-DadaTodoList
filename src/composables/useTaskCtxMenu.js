import { reactive, computed } from 'vue';
import { Tasks } from './useTasks.js';

/* ============================================================
   任务块右键菜单：单例状态 + 行为。
   日 / 周 / 月 / 日程 / 清单 五个视图共用同一套菜单逻辑与样式，
   故抽成模块级单例（整个应用同一时刻只可能有一个菜单）。
   各视图只需在任务块上 @contextmenu.prevent="openCtxMenu(t, e)"，
   并在模板放一个 <task-context-menu />（teleport 到 body）。
   ============================================================ */

// 菜单状态（响应式，单例）
const ctxMenu = reactive({ open: false, x: 0, y: 0, task: null });

// 外部注入的钩子（由 TasksApp 在 created 时设置一次）
let _i18n = (k) => k;
let _openTask = async () => {};
let _openEdit = async () => {};   // 编辑任务钩子（由 TasksApp 封装打开 TaskEditorModal）
let _reportError = () => {};
let _afterApply = null;     // 应用状态后给视图的回调（如清单视图重算进度）
let _afterDelete = null;    // 删除后给视图的回调（如清单视图重载分组）
let _deleteTask = async () => {};   // 删除任务钩子（由 TasksApp 封装确认弹窗 + API + 重载）
let _menuEl = null;         // 菜单 DOM（由 TaskContextMenu 注册，用于「点击外部关闭」判定）

export function setCtxI18n(fn) { _i18n = fn; }
export function setCtxOpenTask(fn) { _openTask = fn; }
export function setCtxEdit(fn) { _openEdit = fn; }
export function setCtxError(fn) { _reportError = fn; }
export function setCtxDelete(fn) { _deleteTask = fn; }
export function setCtxMenuEl(el) { _menuEl = el; }
// 点击/右键的落点是否在菜单内（用于全局关闭监听判定）
export function ctxMenuContains(target) {
  return !!(_menuEl && target && _menuEl.contains(target));
}

// 任务状态归一：todo（未完成）/ done（已完成）/ cancelled（已取消）
export function statusOf(t) {
  if (!t) return 'todo';
  if (t.cancelled) return 'cancelled';
  if (t.completed) return 'done';
  return 'todo';
}

const ICONS = {
  done: 'la la-check-circle',
  todo: 'la la-undo',
  cancelled: 'la la-ban'
};

// 菜单可选项：跳过任务当前状态，仅给出可切换到的另两种状态（固定顺序：未完成 → 完成 → 取消）
export const ctxMenuOpts = computed(() => {
  const t = ctxMenu.task;
  if (!t) return [];
  const s = statusOf(t);
  if (s === 'todo') {
    return [
      { status: 'done', label: _i18n('app.ctxMarkDone'), icon: ICONS.done },
      { status: 'cancelled', label: _i18n('app.ctxMarkCancel'), icon: ICONS.cancelled }
    ];
  }
  if (s === 'done') {
    return [
      { status: 'todo', label: _i18n('app.ctxMarkTodo'), icon: ICONS.todo },
      { status: 'cancelled', label: _i18n('app.ctxMarkCancel'), icon: ICONS.cancelled }
    ];
  }
  return [
    { status: 'todo', label: _i18n('app.ctxMarkTodo'), icon: ICONS.todo },
    { status: 'done', label: _i18n('app.ctxMarkDone'), icon: ICONS.done }
  ];
});

// 在光标处打开菜单（阻止浏览器原生菜单由调用处的 .prevent 负责）
export function openCtxMenu(task, e, opts = {}) {
  _afterApply = (opts && opts.onAfterApply) || null;
  _afterDelete = (opts && opts.onAfterDelete) || null;
  ctxMenu.open = true;
  ctxMenu.x = e.clientX;
  ctxMenu.y = e.clientY;
  ctxMenu.task = task;
}

export function closeCtxMenu() {
  ctxMenu.open = false;
  ctxMenu.task = null;
  _afterApply = null;
  _afterDelete = null;
}

// 应用所选状态：写文件 + 就地更新本地字段（任务对象是各视图 this.tasks 的同一引用，
// 直接改 t.completed / t.cancelled 即可触发重排与重渲染），并回调视图做额外同步。
export async function applyCtxStatus(opt) {
  const t = ctxMenu.task;
  if (!t) { closeCtxMenu(); return; }
  if (statusOf(t) === opt.status) { closeCtxMenu(); return; }
  try {
    await Tasks.setChecklistStatus(t.guid, opt.status);
    t.completed = opt.status === 'done';
    t.cancelled = opt.status === 'cancelled';
    t.completedAt = t.completed ? (t.completedAt || Date.now()) : null;
    t.cancelledAt = t.cancelled ? (t.cancelledAt || Date.now()) : null;
    if (_afterApply) _afterApply(t);
  } catch (e) {
    _reportError((_i18n('app.opFail')) + ((e && e.message) || e));
  }
  closeCtxMenu();
}

// 「打开文件」：关闭菜单后跳转到任务所在笔记并高亮
export function openCtxFile() {
  const t = ctxMenu.task;
  closeCtxMenu();
  if (t) _openTask(t);
}

// 「编辑任务」：关闭菜单后弹出 TaskEditorModal（打开逻辑由 TasksApp 注入，复用详情补全 + 重载）
export function openCtxEdit() {
  const t = ctxMenu.task;
  closeCtxMenu();
  if (t) _openEdit(t);
}

// 「删除任务」：关闭菜单后交给宿主（TasksApp）做「确认弹窗 + API 删除 + 视图重载」，
// 再回调发起视图（如清单视图重载分组）做本地数据同步
export async function deleteCtxTask() {
  const t = ctxMenu.task;
  closeCtxMenu();
  if (t) {
    try {
      await _deleteTask(t);
      if (_afterDelete) _afterDelete(t.guid);
    } catch (e) {
      _reportError((_i18n('app.opFail')) + ((e && e.message) || e));
    }
  }
}

export function useTaskCtxMenu() {
  return {
    ctxMenu, ctxMenuOpts,
    openCtxMenu, closeCtxMenu, applyCtxStatus, openCtxEdit, openCtxFile, deleteCtxTask,
    ctxMenuContains, setCtxMenuEl
  };
}
