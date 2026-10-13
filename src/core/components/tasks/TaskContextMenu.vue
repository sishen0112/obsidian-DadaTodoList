<template>
  <!-- 任务块右键菜单：teleport 到 body，确保 position:fixed 相对视口（规避祖先 transform 导致的偏移） -->
  <teleport to="body">
    <transition name="tk-ctx-fade">
      <div v-if="ctxMenu.open" ref="el" class="tk-ctx" :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }" @contextmenu.stop.prevent>
        <span class="tk-ctx-item" role="menuitem" tabindex="0" @click="openCtxEdit">
          <i class="la la-pen"></i><span>{{ $t('app.ctxEdit') }}</span>
        </span>
        <div class="tk-ctx-sep"></div>
        <span v-for="opt in ctxMenuOpts" :key="opt.status" class="tk-ctx-item" role="menuitem" tabindex="0" @click="applyCtxStatus(opt)">
          <i :class="opt.icon"></i><span>{{ opt.label }}</span>
        </span>
        <div class="tk-ctx-sep"></div>
        <span class="tk-ctx-item tk-ctx-danger" role="menuitem" tabindex="0" @click="deleteCtxTask">
          <i class="la la-trash"></i><span>{{ $t('app.ctxDeleteTask') }}</span>
        </span>
        <div class="tk-ctx-sep"></div>
        <span class="tk-ctx-item" role="menuitem" tabindex="0" @click="openCtxFile">
          <i class="la la-external-link"></i><span>{{ $t('app.ctxOpenFile') }}</span>
        </span>
      </div>
    </transition>
  </teleport>
</template>

<script>
import { useTaskCtxMenu, setCtxMenuEl } from '../../composables/useTaskCtxMenu.js';

export default {
  name: 'TaskContextMenu',
  setup() {
    const { ctxMenu, ctxMenuOpts, applyCtxStatus, openCtxEdit, openCtxFile, deleteCtxTask } = useTaskCtxMenu();
    return { ctxMenu, ctxMenuOpts, applyCtxStatus, openCtxEdit, openCtxFile, deleteCtxTask };
  },
  watch: {
    // 菜单打开后：注册 DOM（供全局「点击外部关闭」判定）并夹回视口内，避免溢出被裁切
    'ctxMenu.open'(v) {
      if (v) this.$nextTick(() => { setCtxMenuEl(this.$refs.el); this.clamp(); });
      else setCtxMenuEl(null);
    }
  },
  methods: {
    clamp() {
      const el = this.$refs.el;
      if (!el) return;
      const r = el.getBoundingClientRect();
      let x = this.ctxMenu.x, y = this.ctxMenu.y;
      const W = window.innerWidth, H = window.innerHeight;
      if (x + r.width > W) x = Math.max(4, W - r.width - 4);
      if (y + r.height > H) y = Math.max(4, H - r.height - 4);
      this.ctxMenu.x = x; this.ctxMenu.y = y;
    }
  }
};
</script>
