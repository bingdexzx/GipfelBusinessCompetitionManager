<template>
  <div class="topbar">
    <div class="topbar-left">
      <el-breadcrumb separator="/">
        <el-breadcrumb-item :to="{ path: '/dashboard' }">首页</el-breadcrumb-item>
        <el-breadcrumb-item v-if="currentTitle">{{ currentTitle }}</el-breadcrumb-item>
      </el-breadcrumb>
    </div>
    <div class="topbar-right">
      <span class="user-info">
        <span>{{ authStore.user?.displayName || authStore.user?.username || "用户" }}</span>
        <el-tag size="small" :type="roleTagType" class="role-tag">{{ roleLabel }}</el-tag>
      </span>
      <el-button size="small" type="danger" plain style="margin-left: 16px" @click="handleLogout"
        >退出</el-button
      >
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAuthStore } from "@/stores/auth";

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();

const currentTitle = computed(() => {
  const title = route.meta?.title as string | undefined;
  if (!title) return "";
  const managePerm = route.meta?.managePermission as string | undefined;
  if (managePerm && !authStore.can(managePerm) && title.endsWith("管理")) {
    return title.slice(0, -2);
  }
  return title;
});

const roleLabel = computed(() => {
  const map: Record<string, string> = {
    SUPER_ADMIN: "超管",
    COMPETITION_ADMIN: "管理员",
    PLAYER: "选手",
  };
  return map[authStore.user?.role || ""] || "";
});

const roleTagType = computed(() => {
  const map: Record<string, string> = {
    SUPER_ADMIN: "danger",
    COMPETITION_ADMIN: "warning",
    PLAYER: "info",
  };
  return map[authStore.user?.role || ""] || "info";
});

function handleLogout() {
  authStore.logout();
  router.push("/login");
}
</script>

<style scoped>
.topbar {
  height: var(--topbar-height);
  background: var(--glass-bg);
  backdrop-filter: blur(var(--glass-blur)) saturate(180%);
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(180%);
  border-bottom: 1px solid var(--color-border);
  box-shadow:
    0 1px 0 rgba(16, 24, 40, 0.02),
    0 2px 8px rgba(16, 24, 40, 0.03);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--content-padding);
  flex-shrink: 0;
  position: relative;
  z-index: 5;
}
.topbar-left {
  display: flex;
  align-items: center;
}
.topbar-right {
  display: flex;
  align-items: center;
}
.user-info {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: var(--color-text-primary);
}
.role-tag {
  font-size: 11px;
  height: 20px;
  line-height: 18px;
}
</style>
