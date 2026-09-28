// 任务纯函数（周计算 / 分组，与视图共用）+ 数据访问（指向插件 vault API）。
// 与网页版同名文件保持 API 形状一致，UI 层无需感知存储差异。
import { t } from '../i18n/index.js';
import {
  loadAll, loadChecklists, loadByList, loadByDate, getDetail,
  loadChecklistGroups,
  createTask, createChecklistTask, updateTask, deleteTask, toggleTask, createSubtask, listSubtasks,
  moveChecklistTask
} from '../api/tasks.js';

// ---------- 纯函数 ----------
export function startOfWeek(d) {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (date.getDay() + 6) % 7; // 周一=0 ... 周日=6
  date.setDate(date.getDate() - day);
  return date;
}
export function weekDays(weekStart) {
  const arr = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i);
    arr.push(d);
  }
  return arr;
}

// ---------- 数据访问（形状与网页版一致，但抛错形式统一为 Error） ----------
async function unwrap(p) {
  const r = await p;
  if (r.status >= 400 || r.body.ok === false) {
    const reason = r.body.reason || String(r.status);
    // bad_date 表示「有日期任务需要日记插件，但日记插件未启用」：给出明确引导而非裸错误码
    const msg = reason === 'bad_date' ? t('common.dailyDisabledHint') : (t('common.apiError') + reason);
    const err = new Error(msg);
    err.reason = reason;
    throw err;
  }
  return r.body;
}

const api = {
  async loadAll() { return (await unwrap(loadAll())).items || []; },
  async loadChecklists() { return (await unwrap(loadChecklists())).items || []; },
  async loadByList(listKey) { return (await unwrap(loadByList(listKey))).items || []; },
  async loadChecklistGroups(listKey) { return await unwrap(loadChecklistGroups(listKey)); },
  async loadByDate(dateKey) { return (await unwrap(loadByDate(dateKey))).items || []; },
  async getDetail(guid) {
    const items = await this.loadByDate(String(guid || '').split('#')[0]);
    return items.find((t) => t.guid === guid) || null;
  },
  async createTask(task) { return (await unwrap(createTask(task))).task; },
  async createChecklistTask(listKey, groupTitle, task) {
    return (await unwrap(createChecklistTask(listKey, groupTitle, task))).task;
  },
  async updateTask(guid, patch) { return (await unwrap(updateTask(guid, patch))).task; },
  async deleteTask(guid) { await unwrap(deleteTask(guid)); },
  async toggleComplete(guid, done) { return (await unwrap(toggleTask(guid, done))).task; },
  async listSubtasks(parentGuid) { return (await unwrap(listSubtasks(parentGuid))).items || []; },
  async createSubtask(parentGuid, task) { return (await unwrap(createSubtask(parentGuid, task))).task; },
  async moveChecklistTask(listKey, guid, targetGroupTitle) { return await unwrap(moveChecklistTask(listKey, guid, targetGroupTitle)); }
};

// 聚合命名空间导出，供组件以 Tasks.xxx 调用
export const Tasks = Object.assign({
  startOfWeek, weekDays
}, api);
