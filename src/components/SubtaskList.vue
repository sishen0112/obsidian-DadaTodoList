<template>
  <div class="subtasks">
    <ul v-if="items.length" class="sub-list">
      <li v-for="s in items" :key="s.guid" class="sub-item" :class="{ done: s.completed, editing: editingGuid === s.guid }">
        <i class="sub-check" :class="[{ done: s.completed }, subIcon(s)]" @click.stop="toggle(s, !s.completed)"></i>
        <input v-if="editingGuid === s.guid" v-focus class="sub-edit" v-model="draft" @keyup.enter="saveEdit(s)" @keyup.esc="cancelEdit" @blur="saveEdit(s)" />
        <span v-else class="sub-sum" @dblclick="startEdit(s)">{{ s.summary }}</span>
        <button v-if="editingGuid !== s.guid" class="sub-del" type="button" :title="$t('app.delSubtask')" @click.stop="remove(s)">×</button>
      </li>
    </ul>

    <div v-else-if="loading" class="sub-skel">
      <div v-for="n in 3" :key="n" class="sub-skel-row">
        <span class="sub-skel-box sk"></span>
        <span class="sub-skel-line sk"></span>
      </div>
    </div>

    <div v-else class="sub-empty">{{ $t('app.noSubtasks') }}</div>

    <div v-if="error" class="sub-err">{{ error }}</div>

    <div class="sub-add">
      <i class="la la-plus"></i>
      <input
        v-model="newSummary"
        type="text"
        class="sub-input"
        :placeholder="$t('app.addSubtask')"
        :disabled="adding"
        @keyup.enter="add"
      />
    </div>
  </div>
</template>

<script>
import { Tasks } from '../composables/useTasks.js';

export default {
  name: 'SubtaskList',
  emits: ['change'],
  props: {
    taskGuid: { type: String, required: true }
  },
  data() {
    return {
      items: [],
      loading: false,
      adding: false,
      error: '',
      newSummary: '',
      editingGuid: '',
      draft: ''
    };
  },
  // Vue3：自定义指令钩子 inserted → mounted
  directives: {
    focus: {
      mounted(el) { el.focus(); if (el.select) el.select(); }
    }
  },
  computed: {
    doneCount() { return this.items.filter((s) => s.completed).length; },
    pct() { return this.items.length ? Math.round((this.doneCount / this.items.length) * 100) : 0; }
  },
  watch: {
    taskGuid() { this.load(); }
  },
  created() { this.load(); },
  methods: {
    subIcon(s) {
      return s.completed ? 'la la-check-circle-o' : 'la la-circle-o';
    },
    startEdit(s) {
      this.editingGuid = s.guid;
      this.draft = s.summary;
    },
    cancelEdit() {
      this.editingGuid = '';
      this.draft = '';
    },
    async saveEdit(s) {
      const summary = this.draft.trim();
      if (!summary || summary === s.summary) { this.cancelEdit(); return; }
      try {
        await Tasks.updateTask(s.guid, { summary });
        s.summary = summary;
        this.editingGuid = '';
        this.draft = '';
        this.$emit('change', this.items);
      } catch (e) {
        this.error = this.$t('app.saveFail') + (e && e.message || e);
      }
    },
    async load() {
      this.loading = true; this.error = '';
      try {
        this.items = await Tasks.listSubtasks(this.taskGuid);
      } catch (e) {
        this.error = this.$t('app.loadSubsFail') + (e && e.message || e);
        this.items = [];
      } finally {
        this.loading = false;
      }
    },
    async toggle(s, done) {
      try {
        await Tasks.toggleComplete(s.guid, done);
        s.completed = done;
        this.$emit('change', this.items);
      } catch (e) {
        this.error = this.$t('app.opFail') + (e && e.message || e);
      }
    },
    async add() {
      const summary = this.newSummary.trim();
      if (!summary || this.adding) return;
      this.adding = true; this.error = '';
      try {
        const created = await Tasks.createSubtask(this.taskGuid, { summary });
        this.items.push(created);
        this.newSummary = '';
        this.$emit('change', this.items);
      } catch (e) {
        this.error = this.$t('app.addFail') + (e && e.message || e);
      } finally {
        this.adding = false;
      }
    },
    async remove(s) {
      try {
        await Tasks.deleteTask(s.guid);
        this.items = this.items.filter((x) => x.guid !== s.guid);
        this.$emit('change', this.items);
      } catch (e) {
        this.error = this.$t('app.delFail') + (e && e.message || e);
      }
    }
  }
};
</script>

<style scoped>
.subtasks { margin-top: 0; }
.sub-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.sub-item { display: flex; align-items: flex-start; gap: 10px; padding: 6px 0; }
.sub-check { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; font-size: 18px; line-height: 26px; color: var(--ink-soft); cursor: pointer; margin-top: 3px; }
.sub-check.done { color: var(--gold); }
.sub-sum { flex: 1 1 auto; min-width: 0; font-size: 15px; line-height: 26px; color: var(--ink); word-break: break-word; cursor: text; }
.sub-item.done .sub-sum { color: var(--ink-soft); text-decoration: line-through; }
.sub-edit { flex: 1 1 auto; min-width: 0; box-sizing: border-box; border: 1px solid var(--gold); border-radius: 6px; background: var(--gold-bg); padding: 0 6px; font: inherit; font-size: 15px; line-height: 26px; color: var(--ink); }
.sub-edit:focus { outline: none; }
.sub-del { flex: none; width: 22px; height: 22px; border: none; background: transparent; color: var(--ink-soft); font-size: 16px; line-height: 22px; cursor: pointer; border-radius: 6px; opacity: 0; margin-top: 2px; }
.sub-item:hover .sub-del { opacity: 1; }
.sub-del:hover { color: var(--el-color-danger, var(--text-error)); background: var(--background-modifier-hover); }
.sub-empty { font-size: 13px; color: var(--ink-soft); padding: 4px 0 10px; }
.sub-skel { display: flex; flex-direction: column; gap: 12px; padding: 6px 0; }
.sub-skel-row { display: flex; align-items: center; gap: 10px; }
.sub-skel-box { flex: none; width: 20px; height: 20px; border-radius: 5px; }
.sub-skel-line { flex: 1 1 auto; height: 14px; border-radius: 7px; }
.sk { background: var(--background-secondary); animation: subsk 1.2s infinite; }
@keyframes subsk { 0% { opacity: .55; } 50% { opacity: 1; } 100% { opacity: .55; } }
.sub-err { color: var(--el-color-danger, var(--text-error)); font-size: 13px; margin-bottom: 8px; }
.sub-add { display: flex; align-items: center; gap: 10px; padding: 8px 0; color: var(--ink-soft); }
.sub-add i { font-size: 13px; }
.sub-input { flex: 1; min-width: 0; box-sizing: border-box; border: none; background: transparent; padding: 0; font: inherit; font-size: 14px; line-height: 26px; color: var(--ink); box-shadow: none; }
.sub-input::placeholder { color: var(--ink-soft); }
.sub-input:focus { outline: none; box-shadow: none; }
</style>
