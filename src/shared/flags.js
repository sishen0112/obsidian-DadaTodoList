/* global __DADA_PRO__ */
// Pro 功能开关：真实值由 vite 构建配置通过 define 在编译期注入 __DADA_PRO__（'true' / 'false'）。
// 免费构建恒为 false，使引用处（含 Pro 动态引入）在打包时被 tree-shake 整个剔除，
// 从而保证「免费版构建产物绝不包含 Pro 源码」。
export const IS_PRO = __DADA_PRO__ === true;
