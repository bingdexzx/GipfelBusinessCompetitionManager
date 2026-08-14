/**
 * ============================================================
 *  自定义控件注册入口
 * ============================================================
 * 在这里把你写好的控件组件 import 进来，并调用 registerCustomWidget(...)
 * 完成注册。注册成功后，该控件会自动出现在仪表盘「添加控件」菜单中，
 * 并复用现有的拖拽 / 缩放 / 编辑外壳。
 *
 * 本文件已在 main.ts 中被 import，会在应用启动前完成所有注册，
 * 因此用户无需刷新即可在仪表盘看到新控件。
 *
 * 原先自带的示例「计数卡」(example-counter / ExampleCounterWidget)
 * 已于 2026-08-13 移除，下方仅保留注册骨架，供你追加自己的控件。
 * ============================================================
 */
import { registerCustomWidget } from "./types";

// —— 在此追加你自己的控件 ——
// import MyWidget from "./widgets/MyWidget.vue";
// registerCustomWidget({
//   type: "my-widget",
//   label: "我的控件",
//   component: MyWidget,
//   defaultSize: { w: 220, h: 160 },
//   bindable: false,            // 是否允许在编辑对话框绑定「可查看字段」
//   description: "一句话说明（可选，显示在编辑对话框）",
//   defaultConfig: { /* 创建时写入 config.custom 的默认值 */ },
// });
