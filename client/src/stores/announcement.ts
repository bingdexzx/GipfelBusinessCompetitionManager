import { defineStore } from "pinia";
import { ref } from "vue";
import { announcements, currentAnnouncement } from "@/data/announcement";

/** 已读公告版本在 localStorage 中的键名 */
const SEEN_KEY = "announcementSeenVersion";

/**
 * 更新公告 store。
 *
 * 职责：
 *  - 在应用启动（App.vue onMounted）时判断是否应弹出公告；
 *  - 用户「确认」后记录已读版本，下次启动不再弹出；
 *  - 系统设置页可重新打开查看当前公告。
 */
export const useAnnouncementStore = defineStore("announcement", () => {
  const current = currentAnnouncement;
  const history = announcements;
  const visible = ref(false);
  const seenVersion = ref<string>(localStorage.getItem(SEEN_KEY) || "");

  /** 应用启动时调用：当前公告版本未被读过则弹出。 */
  function maybeOpen() {
    visible.value = seenVersion.value !== current.version;
  }

  /** 用户点击「确认」：标记当前版本已读并关闭弹窗。 */
  function confirm() {
    seenVersion.value = current.version;
    localStorage.setItem(SEEN_KEY, current.version);
    visible.value = false;
  }

  /** 系统设置中点击「查看更新公告」：直接打开（不自动标记已读，关闭行为由 confirm 决定）。 */
  function openFromSettings() {
    visible.value = true;
  }

  /** 系统设置中显式「标记为已读」：记录已读并不再自动弹出（保留打开查看能力）。 */
  function markSeen() {
    seenVersion.value = current.version;
    localStorage.setItem(SEEN_KEY, current.version);
    visible.value = false;
  }

  return { current, history, visible, maybeOpen, confirm, openFromSettings, markSeen };
});
