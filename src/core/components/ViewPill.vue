<template>
  <!-- 底部悬浮视图切换胶囊（horizontal 菜单样式，保持原逻辑不变）。
       仍用 .tk-viewpill 包裹：该层为 position:absolute / height:0 / pointer-events:none，
       仅承载固定的底部胶囊模块，逻辑不受影响。 -->
  <div class="tk-viewpill" v-if="!vertical">
    <!-- 模块一：横向（展开态，居中胶囊） -->
    <transition name="tk-pill">
      <div class="tk-module-h tk-capsule" v-if="!collapsed" key="h">
        <div class="tk-module-h-items">
          <button v-for="v in views" :key="v.key" type="button"
                  class="tk-viewpill-item" :class="{ on: view === v.key }"
                  :title="$t(v.labelKey)"
                  @click="$emit('switch-view', v.key)">
            <i :class="v.icon" class="vp-ico"></i><span class="vp-label">{{ $t(v.labelKey) }}</span>
          </button>
        </div>
        <button class="tk-viewpill-toggle" type="button"
                :title="$t('app.collapseViews')" @click="toggleCollapsed">
          <i class="la la-chevron-right"></i>
        </button>
      </div>
    </transition>

    <!-- 模块二：竖向（折叠态，右下角圆钮 + hover 竖排列表） -->
    <transition name="tk-pill-v">
      <div class="tk-module-v" v-if="collapsed" key="v">
        <div class="tk-module-v-pill tk-capsule">
          <button class="tk-viewpill-toggle" type="button"
                  :title="$t('app.expandViews')" @click="toggleCollapsed">
            <i class="la la-chevron-left"></i>
          </button>
        </div>
        <div class="tk-pill-v">
          <div class="tk-pill-v-inner">
            <button v-for="v in views" :key="v.key" type="button"
                    class="tk-viewpill-item" :class="{ on: view === v.key }"
                    :title="$t(v.labelKey)"
                    @click="$emit('switch-view', v.key)">
              <i :class="v.icon" class="vp-ico"></i><span class="vp-label">{{ $t(v.labelKey) }}</span>
            </button>
          </div>
        </div>
      </div>
    </transition>
  </div>

  <!-- 左侧固定「可展开/收起」竖向菜单（vertical 菜单样式；基础版与 Pro 共用，体验一致）。
       关键：必须直接作为 .task-app 的子节点，脱离 .tk-viewpill（其 height:0 会让内部
       absolute 轨道塌缩为 0 高度而不可见）。.task-app 为 position:relative 全高，
       故 top:0;bottom:0 才能铺满左侧；收起=仅图标竖栏，展开=图标+文字面板。 -->
  <div v-else class="tk-pro-rail" :class="{ collapsed: railCollapsed }">
    <button class="tk-pro-rail-toggle" type="button"
            v-tooltip="railCollapsed ? { text: $t('app.expandViews'), placement: 'right' } : null"
            @click="$emit('update:rail-collapsed', !railCollapsed)">
      <i :class="railCollapsed ? 'la la-chevron-right' : 'la la-chevron-left'"></i>
    </button>
    <div class="tk-pro-rail-items">
      <button v-for="v in views" :key="v.key" type="button"
              class="tk-pro-rail-item" :class="{ on: view === v.key }"
              v-tooltip="railCollapsed ? { text: $t(v.labelKey), placement: 'right' } : null"
              @click="$emit('switch-view', v.key)">
        <i :class="v.icon" class="vp-ico"></i>
        <span class="vp-label">{{ $t(v.labelKey) }}</span>
      </button>
    </div>
  </div>
</template>

<script>
// 底部悬浮视图切换胶囊：从 TaskTopBar 的下拉抽离为独立组件，平铺全部视图。
// 宽度响应由父容器（.task-app）的 container-type 提供，见 tasks-shared.css 的 @container 规则。
export default {
  name: 'ViewPill',
  props: {
    // 当前视图 key：four / day / month / agenda / cl / all
    view: { type: String, required: true },
    // 是否竖向菜单模式：true 时渲染左侧固定菜单（取代底部胶囊）；由设置项 menuStyle 控制
    vertical: { type: Boolean, default: false },
    // 左侧菜单折叠态（由父组件持有并持久化）：true=收起(仅图标)，false=展开(图标+文字)
    railCollapsed: { type: Boolean, default: true }
  },
  emits: ['switch-view', 'update:rail-collapsed'],
  data() {
    return {
      // 仅免费版使用内部折叠态；Pro 版由父组件通过 railCollapsed 控制
      collapsed: this.loadCollapsed(),
      views: [
        { key: 'day', labelKey: 'app.viewDay', icon: 'la la-sun-o' },
        { key: 'four', labelKey: 'app.viewWeek', icon: 'la la-stream' },
        { key: 'month', labelKey: 'app.viewMonth', icon: 'la la-calendar-alt' },
        { key: 'agenda', labelKey: 'app.viewAgenda', icon: 'la la-list-alt' },
        { key: 'cl', labelKey: 'app.viewCl', icon: 'la la-tasks' },
        { key: 'all', labelKey: 'app.viewAll', icon: 'la la-list' }
      ]
    };
  },
  created() {
    this.collapsed = this.loadCollapsed();
  },
  methods: {
    loadCollapsed() {
      try { return window.localStorage.getItem('tk-viewpill-collapsed') === '1'; }
      catch (e) { return false; }
    },
    saveCollapsed(v) {
      try { window.localStorage.setItem('tk-viewpill-collapsed', v ? '1' : '0'); }
      catch (e) { /* 忽略存储不可用时异常 */ }
    },
    // 点击收起/展开：翻转后立即落盘，不依赖 watch
    toggleCollapsed() {
      this.collapsed = !this.collapsed;
      this.saveCollapsed(this.collapsed);
    }
  }
};
</script>

<style scoped>
/* ===== 容器：仅作定位上下文，自身不渲染样式 ===== */
.tk-viewpill {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 0;
  z-index: 20;
  pointer-events: none;
  /* 胶囊统一阴影：三处胶囊（横向 / 竖向钮 / 竖排列表）共用，便于集中调参 */
  --tk-pill-shadow: 0 6px 24px rgba(0, 0, 0, .18);
  /* 半透明胶囊底：基于 --panel 混透明，主题自适应；模糊由 backdrop-filter 提供 */
  --tk-pill-bg: color-mix(in srgb, var(--panel) 40%, transparent);
}

/* ===== 胶囊外壳：横向模块与竖向钮外壳共用的半透明毛玻璃胶囊（圆角 + 阴影 + 内边距） ===== */
.tk-capsule {
  display: inline-flex;
  align-items: center;
  padding: 6px 8px;
  background: var(--panel);            /* 兜底：不支持 color-mix 时回退为实色 */
  background: var(--tk-pill-bg);
  border-radius: 999px;
  box-shadow: var(--tk-pill-shadow);
  backdrop-filter: blur(10px) saturate(2);
  -webkit-backdrop-filter: blur(10px) saturate(2);
  pointer-events: auto;
}

/* ===== 模块一：横向（展开态，居中胶囊） ===== */
.tk-module-h {
  position: absolute;
  bottom: 32px;
  left: 50%;
  transform: translateX(-50%);
  transform-origin: right center;
  gap: 2px;
}
/* 横向模块离开 / 进入：以右侧圆钮为锚点缩成圆 + 右移 + 渐隐（仅横向）。
   关键 transform-origin:right，使收缩朝右、而非对称朝中间收。 */
.tk-pill-enter-active,
.tk-pill-leave-active,
.tk-pill-v-enter-active,
.tk-pill-v-leave-active {
  transition: opacity .3s ease, transform .32s cubic-bezier(.4, 0, .2, 1);
}
.tk-pill-leave-to,
.tk-pill-enter-from {
  opacity: 0;
  transform: translateX(calc(-50% + 30px)) scale(.1);
}
/* 竖向模块进入 / 离开：进入时从左往右滑入（起点在左侧 30px 处）+ 渐显；
   离开时反向滑出 + 渐隐。竖向模块无 translateX 基线，故直接以 0 为终点。 */
.tk-pill-v-enter-from,
.tk-pill-v-leave-to {
  opacity: 0;
  transform: translateX(-30px);
}
/* 视图按钮包裹层（仅结构区分，无特殊动画；收缩交由上方模块整体 scale） */
.tk-module-h-items {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  white-space: nowrap;
}

/* ===== 模块二：竖向（折叠态，右下角圆钮 + hover 竖排列表） =====
   收起钮与列表为两个独立面板（各自背景/阴影），不再融合成一个面板。 */
.tk-module-v {
  position: absolute;
  bottom: 32px;
  right: 16px;
  display: flex;
  flex-direction: column-reverse;
  align-items: flex-end;
  pointer-events: auto;
}
/* 收起钮外壳：复用 .tk-capsule 白胶囊；仅额外居中（钮本身透明、由外壳提供白色填充），
   保证横竖两个切换钮的外观/尺寸一致。 */
.tk-module-v-pill { justify-content: center; }

/* 竖排菜单：独立面板，仅 hover 时高度(0fr→1fr) + 宽度展开（暂沿用，不动） */
.tk-pill-v {
  display: grid;
  grid-template-rows: 0fr;
  max-width: 0;
  opacity: 0;
  overflow: hidden;
  pointer-events: none;
  margin-bottom: 6px;            /* 与下方圆钮面板留间隙，显出「分开」 */
  background: var(--panel);            /* 兜底 */
  background: var(--tk-pill-bg);
  border: 1px solid var(--line);
  border-radius: 16px;
  box-shadow: var(--tk-pill-shadow);
  backdrop-filter: blur(14px) saturate(1.4);
  -webkit-backdrop-filter: blur(14px) saturate(1.4);
  transition: grid-template-rows .32s cubic-bezier(.4, 0, .2, 1),
              max-width .32s cubic-bezier(.4, 0, .2, 1),
              opacity .22s ease;
}
.tk-pill-v-inner {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 2px;
  min-height: 0;
  overflow: hidden;
  padding: 6px;
}
.tk-pill-v .tk-viewpill-item { justify-content: flex-start; width: 100%; padding: 8px 12px; }
.tk-module-v:hover .tk-pill-v {
  grid-template-rows: 1fr;
  max-width: 1000px;
  opacity: 1;
  pointer-events: auto;
}

/* ===== 切换项 / 按钮 通用 ===== */
.tk-viewpill-item {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  border: none;
  background: transparent;
  color: var(--text-normal);
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  padding: 8px 14px;
  border-radius: 999px;
  cursor: pointer;
  box-shadow: none;
  white-space: nowrap;
  transition: background .15s ease, color .15s ease;
}
.tk-viewpill-item .vp-ico { font-size: 16px; width: 18px; text-align: center; flex: none; }
.tk-viewpill-item:not(.on):hover { background: var(--gold-bg); color: var(--ink); }
/* 当前视图：淡金底 + 金字（弱化实心金块的突兀感，仅以颜色/字重区分，不抢眼） */
.tk-viewpill-item.on { background: var(--gold-bg); color: var(--gold); font-weight: 700; }

/* 收起 / 展开按钮（两模块各一枚，图标方向不同） */
.tk-viewpill-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  flex: none;
  border: none;
  background: transparent;
  color: var(--text-normal);
  border-radius: 999px;
  cursor: pointer;
  transition: background .15s ease, color .15s ease;
}
.tk-viewpill-toggle:hover { background: var(--gold-bg); color: var(--ink); }

/* 面板宽 ≤ 768px：仅图标，文字隐藏（tooltip 由 title 提供） */
@container (max-width: 768px) {
  .tk-viewpill-item { padding: 8px 11px; }
  .tk-viewpill-item .vp-label { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .tk-module-h, .tk-pill-v, .tk-viewpill-item, .tk-viewpill-toggle,
  .tk-pill-enter-active, .tk-pill-leave-active,
  .tk-pill-v-enter-active, .tk-pill-v-leave-active { transition: none !important; }
}

/* ===== Pro 版：左侧固定竖向菜单（可展开/收起） ===== */
/* 固定在视图左缘，整高竖栏；收起态仅图标、展开态图标+文字。
   宽度与 TasksApp 的 .task-app 左内边距同速动画，保证内容不被遮挡 */
.tk-pro-rail {
  position: absolute;
  left: 0; top: 0; bottom: 0;
  width: 44px;                 /* 收起态：仅图标竖栏 */
  display: flex;
  flex-direction: column;
  align-items: stretch;
  padding: 12px 0;
  background: var(--panel-2);
  border-right: 1px solid var(--line);
  z-index: 15;
  overflow: hidden;
  transition: width .28s cubic-bezier(.4, 0, .2, 1);
}
.tk-pro-rail:not(.collapsed) { width: 158px; }   /* 展开态：图标 + 文字面板 */
.tk-pro-rail-toggle {
  flex: none;
  display: inline-flex; align-items: center; justify-content: center;
  width: 32px; height: 32px; margin: 0 auto 10px;
  border: none; background: transparent; color: var(--text-normal);
  border-radius: 999px; cursor: pointer;
  transition: background .15s ease, color .15s ease;
}
.tk-pro-rail-toggle:hover { background: var(--gold-bg); color: var(--ink); }
.tk-pro-rail-toggle i { font-size: 18px; }
.tk-pro-rail-items {
  flex: 1 1 auto; min-height: 0;
  display: flex; flex-direction: column; gap: 4px;
  padding: 0 6px; justify-content: flex-start;
}
.tk-pro-rail-item {
  display: inline-flex; align-items: center; gap: 10px;
  width: 100%; box-sizing: border-box;
  border: none; background: transparent; color: var(--text-normal);
  font-family: inherit; font-size: 13px; font-weight: 600;
  padding: 9px 10px; border-radius: 9px; cursor: pointer;
  box-shadow: none; white-space: nowrap;
  transition: background .15s ease, color .15s ease;
}
.tk-pro-rail-item .vp-ico { font-size: 18px; width: 22px; text-align: center; flex: none; }
/* 收起态：居中仅图标，隐藏文字 */
.tk-pro-rail.collapsed .tk-pro-rail-item { justify-content: center; padding: 9px 0; }
.tk-pro-rail.collapsed .vp-label { display: none; }
.tk-pro-rail-item:not(.on):hover { background: var(--gold-bg); color: var(--ink); }
.tk-pro-rail-item.on { background: var(--gold-bg); color: var(--gold); font-weight: 700; }
</style>
