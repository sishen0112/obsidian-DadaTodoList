<template>
  <div v-if="open" class="tk-mask" @click.self="close">
    <div class="tk-modal">
      <button class="tk-close" @click="close"><i class="la la-times"></i></button>
      <div class="tk-modal-head">
        <h3 class="tk-modal-title">{{ editing ? $t('editor.editTitle') : $t('editor.newTitle') }}</h3>
        <button v-if="editing" class="btn btn-icon" type="button" :title="$t('editor.openFileTip')" @click="openFile">
          <i class="la la-external-link"></i>
        </button>
      </div>
      <label class="tk-field">
        <span>{{ $t('editor.fieldTitle') }}</span>
        <input ref="sumInput" v-model="form.title" type="text" :placeholder="$t('editor.titlePh')" @keyup.enter="save" />
      </label>
      <!-- 链接：胶囊右侧按钮可编辑，末尾 + 可新增 -->
      <div class="tk-links">
        <span class="tk-links-label">{{ $t('editor.links') }}</span>
        <span v-for="(l, i) in form.links" :key="i" class="tk-link-chip">
          <a class="tk-link-chip-text" :href="l.url" target="_blank" rel="noopener noreferrer">{{ l.text || l.url }}</a>
          <button class="tk-link-edit" type="button" :title="$t('modals.linkEdit')" @click="openLinkEditor(i)">
            <i class="la la-pencil"></i>
          </button>
        </span>
        <button class="tk-add-mini" type="button" :title="$t('modals.linkAdd')" @click="openLinkEditor(-1)">
          <i class="la la-plus"></i>
        </button>
      </div>
      <!-- 标签：胶囊右侧 × 可删除，末尾 + 可新增 -->
      <div class="tk-links">
        <span class="tk-links-label">{{ $t('editor.tags') }}</span>
        <span v-for="(tag, i) in form.tags" :key="tag" class="tk-tag-chip">
          <span class="tk-tag-text">#{{ tag }}</span>
          <button class="tk-tag-del" type="button" :title="$t('editor.delTag')" @click="removeTag(i)">
            <i class="la la-times"></i>
          </button>
        </span>
        <span v-if="addingTag" class="tk-tag-chip is-editing">
          <input ref="tagInput" v-model="tagDraft" class="tk-tag-input" type="text" :placeholder="$t('editor.tagName')"
                 @keyup.enter="commitTag" @keyup.esc="cancelAddTag" @blur="commitTag" />
        </span>
        <button v-else class="tk-add-mini" type="button" :title="$t('editor.addTag')" @click="startAddTag">
          <i class="la la-plus"></i>
        </button>
      </div>
      <label class="tk-field">
        <span>{{ $t('editor.desc') }}</span>
        <textarea v-model="form.description" rows="3" :placeholder="$t('editor.descPh')"></textarea>
      </label>
      <div class="tk-row2">
        <label class="tk-field" style="flex:1">
          <span>{{ $t('editor.date') }}</span>
          <input v-model="form.dueDate" type="date" :disabled="saving" @change="onDateChange" />
        </label>
      </div>
      <div v-if="form.dueDate" class="tk-time-block">
        <span class="tk-check" @click="toggleAllDay">
          <i class="tk-ic" :class="form.dueAllDay ? 'la la-check-circle-o' : 'la la-circle-o'"></i> {{ $t('editor.allDayHint') }}
        </span>
        <template v-if="!form.dueAllDay">
          <div class="tk-tm-tabs">
            <button type="button" class="tk-tm-tab" :class="{ active: form.timeMode === 'single' }" @click="setTimeMode('single')">{{ $t('editor.timeSingle') }}</button>
            <button type="button" class="tk-tm-tab" :class="{ active: form.timeMode === 'range' }" @click="setTimeMode('range')">{{ $t('editor.timeRange') }}</button>
          </div>
          <div v-if="form.timeMode === 'single'" class="tk-time-row">
            <input v-model="form.dueTime" type="time" :disabled="saving" />
          </div>
          <div v-else class="tk-time-row">
            <input v-model="form.dueStart" type="time" :disabled="saving" @change="normalizeEnd" />
            <span class="tk-tm-sep">—</span>
            <input v-model="form.dueEnd" type="time" :disabled="saving" @change="normalizeEnd" />
          </div>
        </template>
      </div>
      <div v-if="editing" class="tk-sub">
        <div class="tk-sub-title">{{ $t('editor.subtasks') }}</div>
        <subtask-list :task-guid="task.guid" @change="$emit('subtasks-changed', $event)" />
      </div>
      <div v-if="error" class="tk-err">{{ error }}</div>
      <!-- 底栏：左（状态操作 + 删除）· 右（唯一主按钮） -->
      <div class="tk-modal-ops">
        <template v-if="editing">
          <button v-if="!form.completed" class="btn" type="button" :disabled="saving" @click="completeTask">
            <i class="la la-check"></i>{{ $t('editor.doneBtn') }}
          </button>
          <button v-else class="btn" type="button" :disabled="saving" @click="completeTask">
            <i class="la la-undo"></i>{{ $t('editor.markUndoneBtn') }}
          </button>
          <button v-if="!form.cancelled" class="btn" type="button" :disabled="saving" @click="cancelTask">
            <i class="la la-ban"></i>{{ $t('editor.cancelTaskBtn') }}
          </button>
          <button v-else class="btn" type="button" :disabled="saving" @click="cancelTask">
            <i class="la la-undo"></i>{{ $t('editor.restoreTaskBtn') }}
          </button>
          <button class="btn btn-danger" type="button" :disabled="saving" @click="remove">
            <i class="la la-trash"></i>{{ $t('editor.delTask') }}
          </button>
        </template>
        <span class="spacer"></span>
        <button class="btn btn-gold" :disabled="saving || !form.title.trim()" @click="save()">
          <i class="la la-save"></i>{{ saving ? $t('editor.saving') : $t('common.save') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script>
import { Tasks } from '../composables/useTasks.js';
import { splitSummary, composeSummary, sanitizeTag } from '../composables/tasks-logic.js';
import { LinkFormModal, ConfirmModal } from '../ui/modals.js';
import { openTaskInFile } from '../utils/openTaskInFile.js';
import SubtaskList from './SubtaskList.vue';

const pad = (n) => (n < 10 ? '0' + n : '' + n);
function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

export default {
  name: 'TaskEditorModal',
  components: { SubtaskList },
  props: {
    open: { type: Boolean, default: false },
    task: { type: Object, default: null },
    defaultDate: { type: String, default: '' },
    // 双击时间轴空白格新建：预填开始时刻（HH:MM），落到对应时间
    defaultTime: { type: String, default: '' },
    // VueModal 桥挂载的独立 app 拿不到全局 plugin，显式传入（打开原生链接弹窗用）
    plugin: { type: Object, default: null },
    // 清单分组内新建：传入 { list, group } 时，新任务追加到该分组最后一行（而非文件末尾）
    createIn: { type: Object, default: null }
  },
  data() {
    return {
      form: this.blank(),
      saving: false,
      error: '',
      // 当前编辑的链接下标（< 0 表示新增）
      linkEditIndex: -1,
      // 新增标签
      addingTag: false,
      tagDraft: ''
    };
  },
  computed: {
    editing() { return !!(this.task && this.task.guid); }
  },
  watch: {
    // immediate：VueModal 桥挂载时 open 已为 true，必须立即初始化预填表单
    open: { handler(v) { if (v) this.init(); }, immediate: true }
  },
  methods: {
    blank() {
      return {
        guid: '', title: '', description: '', links: [], tags: [],
        dueDate: this.defaultDate || '', dueTime: this.defaultTime || '', dueAllDay: false,
        timeMode: 'single', dueStart: this.defaultTime || '', dueEnd: '',
        remind: true, completed: false, cancelled: false, cancelledAt: ''
      };
    },
    init() {
      this.error = '';
      this.saving = false;
      this.linkEditIndex = -1;
      this.addingTag = false;
      this.tagDraft = '';
      this.form = this.editing ? this.taskToForm(this.task) : this.blank();
      // 新建且未指定时间时，带出下一个准点/半点（结束=开始+30 分）
      this.ensureDefaultTimes();
      this.$nextTick(() => { if (this.$refs.sumInput) this.$refs.sumInput.focus(); });
    },
    // 标题只取纯文字，链接与标签拆成独立字段各自维护
    taskToForm(t) {
      let dueDate = '', dueTime = '', dueAllDay = false, timeMode = 'single', dueStart = '', dueEnd = '';
      const sd = t.dueAt ? new Date(t.dueAt) : null;
      const ed = (t.dueEndAt && !t.dueAllDay) ? new Date(t.dueEndAt) : null;
      if (sd) {
        dueDate = ymd(sd);
        dueAllDay = !!t.dueAllDay;
        dueTime = dueAllDay ? '' : pad(sd.getHours()) + ':' + pad(sd.getMinutes());
      }
      if (ed) {
        timeMode = 'range';
        dueStart = pad(sd.getHours()) + ':' + pad(sd.getMinutes());
        dueEnd = pad(ed.getHours()) + ':' + pad(ed.getMinutes());
      }
      const parts = splitSummary(t.summary);
      return {
        guid: t.guid,
        title: parts.title,
        description: t.description || '',
        links: parts.links.slice(),
        tags: parts.tags.slice(),
        dueDate, dueTime, dueAllDay, timeMode, dueStart, dueEnd,
        remind: t.remind !== false,
        completed: !!t.completed,
        cancelled: !!t.cancelled,
        cancelledAt: t.cancelledAt || ''
      };
    },
    // 下一个准点或半点：向上取整到 30 分钟边界（如 09:12 → 09:30，09:40 → 10:00）
    nextHalfHour() {
      const now = new Date();
      const total = now.getHours() * 60 + now.getMinutes();
      let next = Math.ceil(total / 30) * 30;
      if (next >= 1440) next = 1410; // 封顶 23:30
      const hh = Math.floor(next / 60), mm = next % 60;
      return {
        start: pad(hh) + ':' + pad(mm),
        end: pad(Math.floor((next + 30) / 60) % 24) + ':' + pad((next + 30) % 60)
      };
    },
    // HH:mm 加 add 分钟，按天取模
    addMinutes(hhmm, add) {
      const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
      let total = m ? Number(m[1]) * 60 + Number(m[2]) : 9 * 60;
      total = (total + add) % (24 * 60);
      return pad(Math.floor(total / 60)) + ':' + pad(total % 60);
    },
    // HH:mm → 当日分钟数；非法返回默认 9:00
    toMin(hhmm) {
      const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
      return m ? Number(m[1]) * 60 + Number(m[2]) : 9 * 60;
    },
    // 把 HH:mm 向上取整到「下一个整点 / 半点」边界（如 09:12→09:30，09:40→10:00）
    ceilHalfHour(hhmm) {
      const total = this.toMin(hhmm);
      let next = Math.ceil(total / 30) * 30;
      if (next >= 1440) next = 1410; // 封顶 23:30
      return pad(Math.floor(next / 60)) + ':' + pad(next % 60);
    },
    // 时间段模式：结束时间不得早于开始时间，否则修正为开始之后的下一个整点/半点
    normalizeEnd() {
      if (this.form.timeMode !== 'range' || this.form.dueAllDay) return;
      if (!this.form.dueStart || !this.form.dueEnd) return;
      if (this.toMin(this.form.dueEnd) <= this.toMin(this.form.dueStart)) {
        this.form.dueEnd = this.ceilHalfHour(this.form.dueStart);
      }
    },
    // 未指定时间时，按模式带出默认值（单时间→下一个半点；时间段→开始为下一个半点、结束+30 分）
    ensureDefaultTimes() {
      if (this.form.dueAllDay) return;
      if (this.form.timeMode === 'range') {
        if (!this.form.dueStart) {
          const d = this.nextHalfHour();
          this.form.dueStart = this.form.dueTime || d.start;
          this.form.dueEnd = this.form.dueEnd || d.end;
        }
      } else if (!this.form.dueTime) {
        this.form.dueTime = this.form.dueStart || this.nextHalfHour().start;
      }
    },
    toggleAllDay() {
      this.form.dueAllDay = !this.form.dueAllDay;
      if (!this.form.dueAllDay) this.ensureDefaultTimes();
    },
    onDateChange() { this.ensureDefaultTimes(); },
    // 单时间 / 时间段 切换：简单按钮 tab，切换时按模式补默认值
    setTimeMode(mode) {
      if (this.form.timeMode === mode) return;
      this.form.timeMode = mode;
      this.ensureDefaultTimes();
    },
    // 构造时间戳：单时间只给开始；时间段额外给结束；全天只给当日 00:00
    buildDueAt() {
      if (!this.form.dueDate) return { dueAt: null, dueEndAt: null };
      const date = this.form.dueDate;
      if (this.form.dueAllDay) return { dueAt: new Date(date + 'T00:00:00').getTime(), dueEndAt: null };
      let start, end = null;
      if (this.form.timeMode === 'range') {
        start = this.form.dueStart || this.nextHalfHour().start;
        end = this.form.dueEnd || this.addMinutes(start, 30);
        // 兜底：结束不得早于开始，否则取开始之后的下一个整点/半点
        if (this.toMin(end) <= this.toMin(start)) end = this.ceilHalfHour(start);
      } else {
        start = this.form.dueTime || this.nextHalfHour().start;
      }
      const dueAt = new Date(date + 'T' + start).getTime();
      const dueEndAt = end ? new Date(date + 'T' + end).getTime() : null;
      return { dueAt, dueEndAt };
    },
    // opts.cancelled 存在时同时写入取消态（「取消任务/恢复任务」按钮直达）
    async save(opts) {
      const title = (this.form.title || '').trim();
      if (!title) return;
      this.saving = true; this.error = '';
      const { dueAt, dueEndAt } = this.buildDueAt();
      const payload = {
        // 存盘时还原为完整 Markdown：标题 | [链接](地址) | #标签（提醒关闭时追加 🔕 标记）
        summary: composeSummary(title, this.form.links, this.form.tags, { mute: !this.form.remind }),
        description: this.form.description || '',
        dueAt,
        dueEndAt,
        dueAllDay: this.form.dueAllDay
      };
      if (this.editing) {
        payload.completed = this.form.completed;
        payload.cancelled = (opts && opts.cancelled !== undefined) ? opts.cancelled : this.form.cancelled;
      }
      try {
        const saved = this.editing
          ? await Tasks.updateTask(this.form.guid, payload)
          : (this.createIn
              ? await Tasks.createChecklistTask(this.createIn.list, this.createIn.group, payload)
              : await Tasks.createTask(payload));
        this.$emit('saved', saved);
        this.close();
      } catch (e) {
        this.error = (this.editing ? this.$t('app.saveFail') : this.$t('app.createFail')) + (e && e.message || e);
      } finally {
        this.saving = false;
      }
    },
    // 取消任务 / 恢复任务：一键写回当前表单内容并切换取消态，成功后关闭弹窗
    cancelTask() {
      if (this.saving) return;
      this.form.cancelled = !this.form.cancelled;
      this.save({ cancelled: this.form.cancelled });
    },
    // 完成 / 标记未完成：一键写回并切换完成态（✅ 自动记录当天日期），成功后关闭弹窗
    completeTask() {
      if (this.saving) return;
      this.form.completed = !this.form.completed;
      if (this.form.completed) this.form.cancelled = false; // 完成视为恢复，清除取消态
      this.save({ completed: this.form.completed });
    },
    remove() {
      if (!this.form.guid || this.saving) return;
      new ConfirmModal(this.plugin ? this.plugin.app : null, {
        title: this.$t('editor.delTitle'),
        message: this.$t('editor.delMsg', { name: this.form.title || this.$t('editor.thatTask') }),
        confirmText: this.$t('common.delete'),
        danger: true,
        onConfirm: () => this.doRemove()
      }).open();
    },
    async doRemove() {
      this.saving = true;
      try {
        await Tasks.deleteTask(this.form.guid);
        this.$emit('deleted', this.form.guid);
        this.close();
      } catch (e) {
        this.error = this.$t('app.delFail') + (e && e.message || e);
      } finally {
        this.saving = false;
      }
    },
    /* ---------- 打开任务所在的笔记，并高亮定位到任务所在行 ---------- */
    async openFile() {
      await openTaskInFile(this.plugin, this.task);
      this.close();
    },
    /* ---------- 链接（原生弹窗；index < 0 表示新增） ---------- */
    openLinkEditor(index) {
      const links = this.form.links;
      new LinkFormModal(this.plugin ? this.plugin.app : null, {
        link: index >= 0 ? (links[index] || null) : null,
        onSave: (item) => {
          // Vue3：直接赋值（Proxy 响应式）
          if (index >= 0) links[index] = item;
          else links.push(item);
        },
        onDelete: () => {
          if (index >= 0) links.splice(index, 1);
        }
      }).open();
    },

    /* ---------- 标签 ---------- */
    startAddTag() {
      this.addingTag = true;
      this.tagDraft = '';
      this.$nextTick(() => { const el = this.$refs.tagInput; if (el) el.focus(); });
    },
    cancelAddTag() {
      this.addingTag = false;
      this.tagDraft = '';
    },
    commitTag() {
      if (!this.addingTag) return;
      const name = sanitizeTag(this.tagDraft);
      if (name && this.form.tags.indexOf(name) < 0) this.form.tags.push(name);
      this.addingTag = false;
      this.tagDraft = '';
    },
    removeTag(i) {
      this.form.tags.splice(i, 1);
    },
    close() { this.$emit('update:open', false); }
  }
};
</script>

<style scoped>
/* 表单原语（.tk-field/.btn 等）在全局弹窗样式 task-modal.css 中 */
.tk-row2 { display: flex; gap: 12px; }
.tk-row2 .tk-field { flex: 1; }
/* 提权到 .tk-modal：避免被 tasks-shared.css 的 .task-app .tk-check（20px 字号 + 18px 宽高）覆盖 */
.tk-modal .tk-check { display: flex; align-items: center; gap: 7px; width: 100%; height: auto; font-size: 13px; line-height: 1.6; color: var(--ink-soft); margin: 2px 0 16px; cursor: pointer; }
/* 时间区：全天开关 + 单/时间段切换 + 选择器，纵向排布 */
.tk-time-block { display: flex; flex-direction: column; gap: 10px; margin: 2px 0 16px; }
.tk-time-block .tk-check { margin: 0; }
/* 单时间 / 时间段 简单 tab 切换 */
.tk-tm-tabs { display: inline-flex; align-self: flex-start; background: var(--background-modifier-hover); border-radius: 8px; padding: 2px; gap: 2px; }
.tk-tm-tab {
  border: none; background: transparent; color: var(--ink-soft);
  font-family: inherit; font-size: 13px; line-height: 1.4;
  padding: 5px 14px; border-radius: 6px; cursor: pointer;
  transition: background .15s ease, color .15s ease;
}
.tk-tm-tab:hover { color: var(--ink); }
.tk-tm-tab.active { background: var(--panel); color: var(--gold); font-weight: 700; box-shadow: 0 1px 2px rgba(0,0,0,.15); }
/* 时间输入行：原生 date/time 选择器，对齐 .tk-field 表单原语 */
.tk-time-row { display: flex; align-items: center; gap: 8px; }
.tk-time-row input {
  border: 1px solid var(--line); border-radius: 8px; padding: 7px 10px;
  font-family: inherit; font-size: 14px; color: var(--ink); background: var(--panel);
  color-scheme: dark light;
}
.tk-time-row input:focus { outline: none; border-color: var(--gold); }
.tk-tm-sep { flex: none; color: var(--ink-soft); font-weight: 700; }
.tk-ic { font-size: 14px; color: var(--ink-soft); }
.tk-ic.la-check-circle-o { color: var(--gold); }
.tk-sub { margin: 4px 0 16px; padding-top: 14px; border-top: 1px dashed var(--line); }
.tk-sub-title { font-size: 13px; font-weight: 700; color: var(--ink); margin-bottom: 6px; }

/* 标题下方的链接 / 标签行 */
.tk-links { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 0 0 10px; }
.tk-links-label { flex: none; width: 28px; font-size: 12px; color: var(--ink-soft); }

/* 行末「+ 新增」小圆钮（提权同上，避免被 tasks-shared.css 覆盖尺寸） */
.tk-modal .tk-add-mini {
  flex: none; width: 22px; height: 22px; border: 1px dashed var(--line); border-radius: 50%;
  background: transparent; color: var(--ink-soft); font-size: 11px; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  transition: background .15s ease, color .15s ease, border-color .15s ease;
}
.tk-add-mini:hover { background: var(--gold-bg); color: var(--gold); border-color: var(--gold); }

/* 标签胶囊：× 删除 */
.tk-tag-chip {
  display: inline-flex; align-items: center; gap: 2px;
  padding: 1px 2px 1px 10px; border-radius: 999px;
  background: var(--tag-bg);
  color: var(--tag-ink);
  font-size: 12px; line-height: 20px;
}
.tk-tag-text { white-space: nowrap; }
.tk-tag-del {
  flex: none; width: 18px; height: 18px; border: none; border-radius: 50%;
  background: transparent; color: inherit; font-size: 10px; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  opacity: .6; transition: opacity .15s ease, background .15s ease;
}
.tk-tag-del:hover { opacity: 1; background: var(--background-modifier-hover); }
.tk-tag-chip.is-editing { padding: 1px 8px; }
.tk-tag-input {
  width: 88px; border: none; background: transparent; padding: 0;
  font: inherit; font-size: 12px; color: inherit; box-shadow: none;
}
.tk-tag-input:focus { outline: none; box-shadow: none; }
.tk-tag-input::placeholder { color: var(--ink-soft); }
.tk-link-chip {
  display: inline-flex; align-items: center; gap: 2px; max-width: 100%;
  padding: 1px 2px 1px 10px;
  border: 1px solid var(--line); border-radius: 999px; background: var(--panel);
}
.tk-link-chip-text {
  max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--gold); font-size: 13px;
  text-decoration: underline; text-underline-offset: 2px;
}
.tk-link-edit {
  flex: none; width: 22px; height: 22px; border: none; border-radius: 50%;
  background: transparent; color: var(--ink-soft); font-size: 11px; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  transition: background .15s ease, color .15s ease;
}
.tk-link-edit:hover { background: var(--gold-bg); color: var(--gold); }
</style>
