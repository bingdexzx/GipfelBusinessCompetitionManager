import { createApp } from "vue";
import { createPinia } from "pinia";
import ElementPlus from "element-plus";
import VueKonva from "vue-konva";
import "element-plus/dist/index.css";
import zhCn from "element-plus/es/locale/lang/zh-cn";
import * as ElementPlusIconsVue from "@element-plus/icons-vue";
import App from "./App.vue";
import router from "./router";
import "./assets/styles/global.scss";
// 注册自定义仪表盘控件（必须在 app.mount 之前执行）
import "./components/dashboard/registerCustomWidgets";

const app = createApp(App);

app.use(createPinia());
app.use(router);
app.use(ElementPlus, { locale: zhCn });
app.use(VueKonva);

for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component);
}

// 全局时间格式化：截断到秒
app.config.globalProperties.$formatTime = (val: string | Date | undefined | null) => {
  if (!val) return "-";
  const d = new Date(val);
  if (isNaN(d.getTime())) return "-";
  return d.toISOString().replace("T", " ").substring(0, 19);
};

app.mount("#app");
