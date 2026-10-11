<template>
  <div class="tk-time-picker" :class="{ 'is-disabled': disabled, 'is-open': open }">
    <input
      ref="input"
      class="tk-time-picker__input"
      type="text"
      inputmode="numeric"
      autocomplete="off"
      :value="text"
      :placeholder="placeholder"
      :disabled="disabled"
      @focus="onFocus"
      @blur="onBlur"
      @keydown="onKeydown"
      @input="onInput"
    />
    <transition name="tk-fade">
      <ul v-if="open && !disabled" class="tk-time-picker__panel" @mousedown.prevent>
        <li
          v-for="(opt, i) in visibleOptions"
          :key="opt"
          class="tk-time-picker__opt"
          :class="{
            'is-hover': i === hoverIndex && !isDisabled(opt),
            'is-selected': opt === modelValue,
            'is-disabled': isDisabled(opt)
          }"
          @mouseenter="hoverIndex = i"
          @click="select(opt)"
        >{{ opt }}</li>
        <li v-if="!visibleOptions.length" class="tk-time-picker__opt is-empty">无匹配</li>
      </ul>
    </transition>
  </div>
</template>

<script>
// 自实现时间选择器（参考 element-plus 的 TimeSelect 交互，但不依赖任何第三方库）：
// - 可输入：直接敲数字（"9"→09:00、"930"→09:30、"9:30"→09:30），输入过程不回写、不覆盖；
// - 智能提示：输入即按文本过滤下拉（支持前导零省略，如 "930" 命中 "09:30"），越界项（min/max）保留为灰色禁用；
// - 键盘导航：↑/↓ 在选择项间循环移动高亮（跳过禁用项），回车选中高亮项，Esc 还原，失焦提交；
// - 过滤用的 query 与输入框显示值 text 解耦：方向键只改 text 预览、不收窄 query，避免高亮后被过滤"困住"无法继续翻动。
export default {
  name: 'TimePicker',
  props: {
    modelValue: { type: String, default: '' },
    step: { type: Number, default: 5 },
    min: { type: String, default: '' },
    max: { type: String, default: '' },
    placeholder: { type: String, default: 'HH:MM' },
    disabled: { type: Boolean, default: false },
  },
  emits: ['update:modelValue', 'change'],
  data() {
    return {
      open: false,
      text: this.modelValue || '',
      query: '',
      hoverIndex: -1,
    };
  },
  computed: {
    // 解析后的 min/max 边界（分钟），仅随 props 变化重算一次，避免下拉逐项重复解析
    bounds() {
      const lo = this.toMin(this.min);
      const hi = this.toMin(this.max);
      return {
        min: this.min && lo != null ? lo : null,
        max: this.max && hi != null ? hi : null,
      };
    },
    // 过滤用纯数字串（保留用户敲的前导 0）："9:30" → "930"
    queryDigits() {
      return String(this.query || '').replace(/\D/g, '');
    },
    options() {
      const out = [];
      const step = this.step > 0 ? this.step : 5;
      for (let m = 0; m < 1440; m += step) {
        const hh = String(Math.floor(m / 60)).padStart(2, '0');
        const mm = String(m % 60).padStart(2, '0');
        out.push(hh + ':' + mm);
      }
      return out;
    },
    // 下拉所见项：按输入过滤；越界项（min/max）保留为灰色禁用，便于用户感知范围
    visibleOptions() {
      const q = this.queryDigits;
      if (!q) return this.options;
      return this.options.filter((o) => this.matchQuery(o, q));
    },
  },
  watch: {
  modelValue(v) {
    if ((v || '') !== this.text) {
      this.text = v || '';
    }
  },
  },
  methods: {
    toMin(hhmm) {
      const m = /^(\d{1,2}):?(\d{2})?$/.exec((hhmm || '').trim());
      if (!m) return null;
      const h = Math.min(23, parseInt(m[1], 10) || 0);
      const min = m[2] != null ? Math.min(59, parseInt(m[2], 10)) : 0;
      return h * 60 + min;
    },
    isDisabled(opt) {
      const v = this.toMin(opt);
      if (v == null) return false;
      const { min, max } = this.bounds;
      if (min != null && v < min) return true;
      if (max != null && v > max) return true;
      return false;
    },
    // 解析用户输入：接受 "9" / "13" / "930" / "1430" / "9:30" / "09:30"，非法返回 null
    parse(s) {
      s = (s || '').trim();
      if (!s) return null;
      let h, min;
      const colon = /^(\d{1,2}):(\d{1,2})$/.exec(s);
      if (colon) { h = parseInt(colon[1], 10); min = parseInt(colon[2], 10); }
      else if (/^\d{1,2}$/.test(s)) { h = parseInt(s, 10); min = 0; }
      else if (/^\d{3,4}$/.test(s)) {
        const p = s.padStart(4, '0');
        h = parseInt(p.slice(0, 2), 10); min = parseInt(p.slice(2, 4), 10);
      } else return null;
      if (isNaN(h) || isNaN(min) || h > 23 || min > 59) return null;
      return String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0');
    },
    // 匹配：选项数字串以查询开头；或去掉前导 0 后以查询开头（"930" → "09:30"）
    matchQuery(opt, q) {
      if (!q) return true;
      const od = opt.replace(':', '');
      return od.startsWith(q) || od.replace(/^0+/, '').startsWith(q);
    },
    firstSelectableIndex() {
      const v = this.visibleOptions;
      for (let i = 0; i < v.length; i++) if (!this.isDisabled(v[i])) return i;
      return -1;
    },
    onFocus() {
      this.open = true;
      this.query = ''; // 点击聚焦：清空过滤，展示全部时间（仅输入时才过滤）
      this.resetHover();
      this.$nextTick(() => this.scrollToHover()); // 打开即把高亮项滚入可见区
    },
    onInput(e) {
      this.text = e.target.value; // 输入过程不回写、不覆盖
      this.query = e.target.value; // 仅输入时更新过滤 query，方向键不更新
      this.resetHover();
    },
    // 重置高亮：优先命中当前 text；否则落到首个可选中项
    resetHover() {
      const v = this.visibleOptions;
      let idx = (this.text && v.includes(this.text)) ? v.indexOf(this.text) : -1;
      if (idx < 0) idx = this.firstSelectableIndex();
      this.hoverIndex = idx;
    },
    onBlur() { this.open = false; this.commit(); },
    onKeydown(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (this.hoverIndex >= 0) {
          const opt = this.visibleOptions[this.hoverIndex];
          if (opt && !this.isDisabled(opt)) { this.commitValue(opt); this.close(); return; }
        }
        this.commit(); this.close();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.text = this.modelValue || '';
        this.close();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!this.open) { this.open = true; this.resetHover(); }
        this.move(e.key === 'ArrowDown' ? 1 : -1);
      }
    },
    // 在选择项（非禁用）之间循环移动高亮
    move(dir) {
      const v = this.visibleOptions;
      const sel = [];
      for (let i = 0; i < v.length; i++) if (!this.isDisabled(v[i])) sel.push(i);
      if (!sel.length) return;
      let pos = sel.indexOf(this.hoverIndex);
      if (pos < 0) pos = 0;
      else pos = (pos + dir + sel.length) % sel.length;
      this.setHover(sel[pos]);
    },
    setHover(i) {
      this.hoverIndex = i;
      const v = this.visibleOptions[i];
      if (v != null) {
        this.text = v;
        if (this.$refs.input) this.$refs.input.value = v; // 方向键预览：只改显示值，不收窄 query
      }
      this.$nextTick(() => this.scrollToHover());
    },
    scrollToHover() {
      const el = this.$el.querySelector('.tk-time-picker__opt.is-hover');
      if (el) el.scrollIntoView({ block: 'nearest' });
    },
    select(opt) {
      if (this.isDisabled(opt)) return;
      this.commitValue(opt);
      this.close();
    },
    close() {
      this.open = false;
      if (this.$refs.input) this.$refs.input.blur();
    },
    commit() {
      const v = this.parse(this.text);
      if (v == null) { this.text = this.modelValue || ''; return; }
      this.commitValue(v);
    },
    commitValue(v) {
      this.text = v;
      if (v !== this.modelValue) {
        this.$emit('update:modelValue', v);
        this.$emit('change', v);
      }
    },
  },
};
</script>

<style>
.tk-time-picker {
  position: relative;
  display: inline-block;
  min-width: 92px;
}
.tk-time-picker__input {
  width: 100%;
  box-sizing: border-box;
  padding: 6px 8px;
  border: 1px solid var(--background-modifier-border, #ccc);
  border-radius: 6px;
  background: var(--background-primary, #fff);
  color: var(--text-normal, #222);
  font-size: 14px;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
}
.tk-time-picker__input:focus {
  outline: none;
  border-color: var(--interactive-accent, #b8860b);
}
.tk-time-picker.is-disabled .tk-time-picker__input {
  opacity: 0.5;
  cursor: not-allowed;
}
.tk-time-picker__panel {
  position: absolute;
  z-index: 50;
  bottom: calc(100% + 4px);
  left: 0;
  right: 0;
  max-height: 220px;
  overflow-y: auto;
  margin: 0;
  padding: 4px;
  list-style: none;
  background: var(--background-primary, #fff);
  border: 1px solid var(--background-modifier-border, #ccc);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
}
.tk-time-picker__opt {
  padding: 6px 10px;
  border-radius: 5px;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
}
.tk-time-picker__opt:hover { background: var(--background-modifier-hover, #f0f0f0); }
.tk-time-picker__opt.is-hover { background: var(--background-modifier-hover, #f0f0f0); }
.tk-time-picker__opt.is-selected { background: var(--interactive-accent, #b8860b); color: #fff; }
.tk-time-picker__opt.is-disabled { opacity: 0.4; cursor: not-allowed; }
.tk-time-picker__opt.is-disabled:hover { background: transparent; }
.tk-time-picker__opt.is-disabled.is-hover { background: transparent; }
.tk-time-picker__opt.is-empty { opacity: 0.6; cursor: default; }
.tk-time-picker__opt.is-empty:hover { background: transparent; }
.tk-fade-enter-active, .tk-fade-leave-active { transition: opacity 0.12s ease; }
.tk-fade-enter-from, .tk-fade-leave-to { opacity: 0; }
</style>
