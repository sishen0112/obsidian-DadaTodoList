// 列表视图状态域（自 TasksApp.vue 抽离）：
//   - 左侧筛选状态（日期 / 标签 / 清单 / 状态视图）与互斥清空逻辑
//   - 选中清单的任务加载、列表/卡片视图数据源与分组 computed
//   - 待办分桶、过期顺延（ConfirmModal）、完成日历入口
// 依赖经 hooks 注入（tasks / view / plugin 取自宿主实例，错误与偏好持久化回调宿主），
// 返回 ref / computed / methods 的平铺对象，供 Options API 组件在 setup() 中展开绑定。
import { computed, ref } from 'vue';
import { Notice } from 'obsidian';
import { Tasks } from './useTasks.js';
import { weekdayLong, weekdayShort } from './tasks-logic.js';
import { t } from '../i18n/index.js';
import { taskFilePath } from '../api/tasks.js';
import { ConfirmModal } from '../ui/modals.js';
import { VueModal } from '../ui/VueModal.js';
import ChecklistDoneCalendar from '../components/tasks/ChecklistDoneCalendar.vue';

const pad = (n) => (n < 10 ? '0' + n : '' + n);
function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
// 今日零点（本地时区）
function today0() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * @param {object} hooks
 * @param {() => Array} hooks.tasks 宿主全部任务池
 * @param {() => Array} hooks.checklists 宿主清单列表（{ key, name }）
 * @param {() => string} hooks.view 宿主当前视图 key（listSource 仅在 'all' 下供数）
 * @param {() => object} hooks.plugin 插件实例（打开 vault 文件 / Obsidian Modal）
 * @param {(msg: string) => void} hooks.setError 错误写回宿主
 * @param {() => Promise<void>} hooks.reloadTasks 静默重载任务池（顺延落盘后由宿主执行）
 * @param {() => void} hooks.persistTaskView 任务视图偏好持久化（宿主）
 * @param {string} [hooks.listViewInit] 列表/卡片模式初始值（localStorage 记忆）
 */
export function useListState({ tasks, checklists, view, plugin, setError, reloadTasks, persistTaskView, listViewInit = 'list' }) {
  // ---------- 状态 ----------
  const dateFilter = ref('');
  const tagFilter = ref('');
  // 状态视图：'' | 'done' | 'cancelled'（左侧「状态」入口触发）
  const statusView = ref('');
  // 状态视图里被折叠的日期（key = YYYY-MM-DD 或 ''，默认全部展开）
  const dayCollapsed = ref({});
  // 待办分桶：被折叠的桶（key = 桶 key，默认全部展开）
  const todoCollapsed = ref({});
  // 列表视图「已办」/「已取消」分组（默认收起）
  const showCompleted = ref(false);
  const showCancelled = ref(false);
  // 清单（frontmatter tags 命中识别标记的 md 文件，全库任意位置）；activeList 为空表示「全部任务」
  const activeList = ref('');
  const checklistTasks = ref([]);
  const selectedGuid = ref('');
  const quick = ref('');
  const adding = ref(false);
  // 清单视图模式：列表 / 卡片（界面记忆，存 localStorage）
  const listView = ref(listViewInit);
  const cardShowDone = ref(false);
  // 顺延（原生 ConfirmModal 防重入）
  const postponing = ref(false);
  // 日期筛选入口（今天 / 明天 / 最近 7 天）；labelKey 由渲染方经 $t 翻译
  const dateFilters = [
    { key: 'all', labelKey: 'app.dateAll', icon: 'la la-list-ul' },
    { key: 'today', labelKey: 'app.dateToday', icon: 'la la-sun-o' },
    { key: 'tomorrow', labelKey: 'app.dateTomorrow', icon: 'la la-calendar-plus-o' },
    { key: 'week7', labelKey: 'app.dateWeek7', icon: 'la la-calendar-check-o' }
  ];

  // ---------- computed ----------
  // 列表视图可用标签：`复习/天涯神贴` → 父「复习」+ 子「天涯神贴」；无 `/` 的按顶层标签列出
  const tagTree = computed(() => {
    const groups = new Map();
    const loose = new Map();
    for (const t of tasks()) {
      for (const tag of t.tags || []) {
        const i = tag.indexOf('/');
        if (i > 0) {
          const parent = tag.slice(0, i);
          const child = tag.slice(i + 1) || parent;
          if (!groups.has(parent)) groups.set(parent, new Map());
          const m = groups.get(parent);
          m.set(child, (m.get(child) || 0) + 1);
        } else {
          loose.set(tag, (loose.get(tag) || 0) + 1);
        }
      }
    }
    const byCount = (a, b) => b.n - a.n || a.label.localeCompare(b.label);
    const out = [];
    for (const [parent, children] of groups) {
      const items = [...children.entries()]
        .map(([child, n]) => ({ label: child, tag: parent + '/' + child, n }))
        .sort(byCount);
      out.push({
        label: parent,
        tag: parent,
        n: items.reduce((s, x) => s + x.n, 0),
        items
      });
    }
    return {
      groups: out.sort(byCount),
      loose: [...loose.entries()].map(([tag, n]) => ({ label: tag, tag, n })).sort(byCount)
    };
  });
  // 选中清单的显示名
  const activeListName = computed(() => {
    const lists = checklists() || [];
    const c = lists.find((x) => x.key === activeList.value);
    return c ? c.name : '';
  });
  // 状态视图数据源：沿用当前池（全部任务或选中清单）与日期/标签筛选，再按状态过滤
  const statusList = computed(() => {
    if (statusView.value === 'done') return filteredTasks.value.filter((t) => t.completed && !t.cancelled);
    if (statusView.value === 'cancelled') return filteredTasks.value.filter((t) => t.cancelled);
    return [];
  });
  // 状态视图按日期分组：日期倒序（最新在最上），无日期排最后
  const statusGroups = computed(() => {
    const map = new Map();
    for (const t of statusList.value) {
      const k = t.dueAt ? ymd(new Date(t.dueAt)) : '';
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(t);
    }
    const wd = (k) => weekdayLong(new Date(k + 'T00:00:00'));
    return [...map.entries()]
      .map(([k, list]) => ({
        key: k,
        label: k
          ? t('app.dateFull', { y: Number(k.slice(0, 4)), m: Number(k.slice(5, 7)), d: Number(k.slice(8, 10)), wd: wd(k) })
          : t('app.noDate'),
        n: list.length,
        tasks: list.slice().sort((a, b) => (a.dueAt || 0) - (b.dueAt || 0))
      }))
      .sort((a, b) => b.key.localeCompare(a.key));
  });
  // 左侧「状态」计数：跟随当前池（全部任务或选中清单）
  const statusCounts = computed(() => {
    const pool = activeList.value ? checklistTasks.value : tasks();
    let done = 0, cancelled = 0;
    for (const t of pool) {
      if (t.cancelled) cancelled++;
      else if (t.completed) done++;
    }
    return { done, cancelled };
  });
  // 中间列表标题：清单名 > 状态视图名 > 任务
  const listTitle = computed(() => {
    if (activeList.value) return activeListName.value;
    if (statusView.value === 'done') return t('app.listDone');
    if (statusView.value === 'cancelled') return t('app.listCancelled');
    return t('app.listTasks');
  });
  // 卡片视图数据：保持文件中的章节顺序，「显示已完成」关闭时滤掉已完成
  const cardTasks = computed(() => {
    const list = activeList.value ? checklistTasks.value : [];
    return cardShowDone.value ? list : list.filter((t) => !t.completed);
  });
  // 当前清单是否存在已完成项（控制「完成日历」入口显隐）
  const clHasDone = computed(() => {
    return (activeList.value ? checklistTasks.value : []).some((t) => t.completed && t.completedAt);
  });
  // 日期筛选（今天 / 明天 / 最近 7 天，均按本地零点计算）；选中清单时以清单任务为基础
  const filteredTasks = computed(() => {
    let list = activeList.value ? checklistTasks.value : tasks();
    if (dateFilter.value && dateFilter.value !== 'all') {
      const base = new Date();
      base.setHours(0, 0, 0, 0);
      const day = 86400000;
      let from = base.getTime();
      let to = from + day;
      if (dateFilter.value === 'tomorrow') { from += day; to += day; }
      else if (dateFilter.value === 'week7') { to = from + 7 * day; }
      list = list.filter((t) => t.dueAt && t.dueAt >= from && t.dueAt < to);
    }
    if (tagFilter.value) list = list.filter((t) => matchTag(t));
    return list;
  });
  const listSource = computed(() => (view() === 'all' ? filteredTasks.value : []));
  const byDue = (a, b) => {
    const av = a.dueAt ? a.dueAt : Infinity;
    const bv = b.dueAt ? b.dueAt : Infinity;
    return av - bv;
  };
  const listIncomplete = computed(() => listSource.value.filter((t) => !t.completed && !t.cancelled).slice().sort(byDue));
  const listCompleted = computed(() => listSource.value.filter((t) => t.completed && !t.cancelled).slice().sort(byDue));
  const listCancelled = computed(() => listSource.value.filter((t) => t.cancelled).slice().sort(byDue));
  // 待办分桶：已过期（今天之前）/ 今天 / 明天 / 最近7天（后天~第7天）/ 更远 / 无日期
  const todoBuckets = computed(() => {
    const day = 86400000;
    const today0Ms = today0();
    const defs = [
      { key: 'overdue', label: t('app.overdue') },
      { key: 'today', label: t('app.bucketToday', { wd: weekdayShort(new Date(today0Ms)) }) },
      { key: 'tomorrow', label: t('app.bucketTomorrow', { wd: weekdayShort(new Date(today0Ms + day)) }) },
      { key: 'week7', label: t('app.bucketWeek7') },
      { key: 'far', label: t('app.far') },
      { key: 'nodate', label: t('app.noDate') }
    ];
    const buckets = defs.map((d) => Object.assign({ tasks: [] }, d));
    for (const t of listIncomplete.value) {
      if (!t.dueAt) { buckets[5].tasks.push(t); continue; }
      const d0 = new Date(t.dueAt);
      d0.setHours(0, 0, 0, 0);
      const diff = Math.round((d0.getTime() - today0Ms) / day);
      let idx;
      if (diff < 0) idx = 0;
      else if (diff === 0) idx = 1;
      else if (diff === 1) idx = 2;
      else if (diff >= 2 && diff <= 6) idx = 3;
      else idx = 4;
      buckets[idx].tasks.push(t);
    }
    for (const b of buckets) b.tasks.sort((a, b2) => (a.dueAt || 0) - (b2.dueAt || 0));
    return buckets.filter((b) => b.tasks.length);
  });
  // 已过期待办（顺延的作用对象）
  const overdueTasks = computed(() => {
    const overdue = todoBuckets.value.find((b) => b.key === 'overdue');
    return overdue ? overdue.tasks : [];
  });

  // ---------- 方法 ----------
  // 读取当前选中清单的任务
  async function loadChecklistTasks() {
    try { checklistTasks.value = await Tasks.loadByList(activeList.value); }
    catch (e) { setError(t('app.loadChecklistFail') + (e && e.message || e)); }
  }
  // 清空除 keep 组之外的全部筛选（date / tag / status / list）
  function clearFiltersExcept(keep) {
    if (keep !== 'date') dateFilter.value = '';
    if (keep !== 'tag') tagFilter.value = '';
    if (keep !== 'status') statusView.value = '';
    if (keep !== 'list' && activeList.value) {
      activeList.value = '';
      checklistTasks.value = [];
      selectedGuid.value = '';
    }
  }
  function selectDate(key) {
    clearFiltersExcept('date');
    dateFilter.value = key;
  }
  // 状态视图开关：再次点击同一状态返回普通分组
  function selectStatus(v) {
    clearFiltersExcept('status');
    statusView.value = statusView.value === v ? '' : v;
  }
  // 状态视图内折叠 / 展开某个日期
  function toggleDay(key) {
    const map = Object.assign({}, dayCollapsed.value);
    if (map[key]) delete map[key];
    else map[key] = true;
    dayCollapsed.value = map;
  }
  // 待办分桶折叠 / 展开
  function toggleBucket(key) {
    const map = Object.assign({}, todoCollapsed.value);
    if (map[key]) delete map[key];
    else map[key] = true;
    todoCollapsed.value = map;
  }
  // 标签命中：选中父标签时其下所有子标签都算命中
  function matchTag(t) {
    const sel = tagFilter.value;
    if (!sel) return true;
    return (t.tags || []).some((x) => x === sel || x.indexOf(sel + '/') === 0);
  }
  // 标签与其余筛选互斥：再次点击同一标签为取消筛选
  function toggleTagFilter(tag) {
    if (tagFilter.value === tag) {
      tagFilter.value = '';
      return;
    }
    clearFiltersExcept('tag');
    tagFilter.value = tag;
  }
  async function selectList(key) {
    if (activeList.value === key) key = '';
    clearFiltersExcept('list');
    activeList.value = key;
    checklistTasks.value = [];
    selectedGuid.value = '';
    dateFilter.value = 'all';
    tagFilter.value = '';
    if (key) await loadChecklistTasks();
  }
  // 打开清单对应的 vault 文件（清单任务固定在一个 md 文件内）
  function openListFile(key) {
    const path = taskFilePath(key);
    if (!path) { new Notice(t('app.checklistFileMissing')); return; }
    plugin().app.workspace.openLinkText(path, '', false);
  }
  // 完成日历弹窗（Obsidian 原生 Modal 外壳）
  function openClCal(t) {
    new VueModal(plugin().app, ChecklistDoneCalendar, {
      visible: true,
      listName: activeListName.value,
      tasks: activeList.value ? checklistTasks.value : [],
      focus: (t && t.completedAt)
        ? { guid: t.guid, day: ymd(new Date(Number(t.completedAt))) }
        : null
    }, { modalClass: 'cl-cal-modal' }).open();
  }
  // 顺延确认（Obsidian 原生 Modal）
  function openPostpone() {
    if (postponing.value || !overdueTasks.value.length) return;
    const n = overdueTasks.value.length;
    new ConfirmModal(plugin().app, {
      title: t('app.postponeTitle'),
      message: t('app.postponeMsg', { n }),
      confirmText: t('app.postponeBtn'),
      onConfirm: () => doPostpone()
    }).open();
  }
  // 顺延：所有已过期待办移到今天（保留原时分；全天任务保持全天）
  async function doPostpone() {
    const list = overdueTasks.value;
    if (!list.length || postponing.value) return;
    postponing.value = true;
    try {
      const base = today0();
      for (const t of list) {
        const d = new Date(t.dueAt);
        const due = t.dueAllDay
          ? base
          : base + d.getHours() * 3600000 + d.getMinutes() * 60000;
        // 每移动一条，源文件行号都会漂移，guid 中的旧行号可能失配；
        // 传 expectSummary / expectCompleted 让数据层按内容「唯一匹配」兜底重新定位
        await Tasks.updateTask(t.guid, {
          dueAt: due,
          dueAllDay: !!t.dueAllDay,
          expectSummary: t.summary,
          expectCompleted: !!t.completed
        });
      }
      await reloadTasks();
      new Notice(t('app.postponed', { n: list.length }));
    } catch (e) {
      setError(t('app.postponeFail') + (e && e.message || e));
    } finally {
      postponing.value = false;
    }
  }
  // 列表视图写回：子组件通过 ctx 调用（prop 只读，不可直接赋值）
  function setQuick(v) { quick.value = v; }
  function setAdding(v) { adding.value = v; }
  function setListView(v) { listView.value = v; persistTaskView(); }
  function toggleCardShowDone() { cardShowDone.value = !cardShowDone.value; }
  function toggleShowCompleted() { showCompleted.value = !showCompleted.value; }
  function toggleShowCancelled() { showCancelled.value = !showCancelled.value; }

  return {
    // 状态
    dateFilter, tagFilter, statusView, dayCollapsed, todoCollapsed,
    showCompleted, showCancelled, activeList, checklistTasks,
    selectedGuid, quick, adding, listView, cardShowDone, postponing, dateFilters,
    // computed
    tagTree, activeListName, statusList, statusGroups, statusCounts,
    listTitle, cardTasks, clHasDone, filteredTasks, listSource,
    listIncomplete, listCompleted, listCancelled, todoBuckets, overdueTasks,
    // 方法
    loadChecklistTasks, clearFiltersExcept, selectDate, selectStatus,
    toggleDay, toggleBucket, matchTag, toggleTagFilter, selectList,
    openListFile, openClCal, openPostpone, doPostpone,
    setQuick, setAdding, setListView, toggleCardShowDone, toggleShowCompleted, toggleShowCancelled
  };
}
