<template>
  <div class="sidebar">
    <div class="sidebar-brand">
      <div class="brand-text">
        <div class="brand-name">Gipfel商赛系统</div>
        <div class="brand-meta">
          <div v-if="compStore.competitionName" class="meta-row">
            <el-tag type="success" size="small" effect="plain">{{
              compStore.competitionName
            }}</el-tag>
          </div>
          <div v-if="compStore.competitionName" class="meta-row">
            <el-tag
              v-if="compStore.fiscalYearLoading"
              type="info"
              size="small"
              effect="plain"
              class="fy-loading"
            >
              <el-icon class="is-loading"><Loading /></el-icon> 财年加载中…
            </el-tag>
            <template v-else>
              <el-tag
                v-if="compStore.currentFiscalYear !== null"
                type="primary"
                size="small"
                effect="plain"
                >第 {{ compStore.currentFiscalYear }} 财年</el-tag
              >
              <el-tag v-else type="warning" size="small" effect="plain">未开启财年</el-tag>
            </template>
          </div>
          <div v-else class="meta-row meta-hint">
            未选择比赛 —
            <router-link to="/competitions">比赛管理</router-link>
          </div>
        </div>
      </div>
    </div>
    <el-menu :default-active="activeMenu" router class="sidebar-menu ai-sidebar">
      <el-menu-item index="/dashboard">
        <el-icon><Monitor /></el-icon>
        <span>仪表盘</span>
      </el-menu-item>

      <el-menu-item v-if="authStore.can('competition:manage')" index="/competitions">
        <el-icon><TrophyBase /></el-icon>
        <span>比赛管理</span>
      </el-menu-item>

      <el-sub-menu index="data">
        <template #title>
          <el-icon><Folder /></el-icon>
          <span>{{
            authStore.canAny([
              "data:material:edit",
              "data:part:edit",
              "data:product:edit",
              "data:map:edit",
              "data:infrastructure:edit",
              "data:tech:edit",
              "data:fuel:edit",
              "data:vehicle:edit",
              "data:warehouse:edit",
              "data:productionLine:edit",
            ])
              ? "数据管理"
              : "数据"
          }}</span>
        </template>
        <el-menu-item
          v-if="authStore.canAny(['data:material:view', 'data:material:edit'])"
          index="/materials"
        >
          <el-icon><Box /></el-icon>
          <span>{{ authStore.can("data:material:edit") ? "原料管理" : "原料" }}</span>
        </el-menu-item>
        <el-menu-item v-if="authStore.canAny(['data:part:view', 'data:part:edit'])" index="/parts">
          <el-icon><Setting /></el-icon>
          <span>{{ authStore.can("data:part:edit") ? "零件管理" : "零件" }}</span>
        </el-menu-item>
        <el-menu-item
          v-if="authStore.canAny(['data:product:view', 'data:product:edit'])"
          index="/products"
        >
          <el-icon><Goods /></el-icon>
          <span>{{ authStore.can("data:product:edit") ? "产品管理" : "产品" }}</span>
        </el-menu-item>
        <el-menu-item v-if="authStore.canAny(['data:map:view', 'data:map:edit'])" index="/maps">
          <el-icon><MapLocation /></el-icon>
          <span>{{ authStore.can("data:map:edit") ? "地图管理" : "地图" }}</span>
        </el-menu-item>
        <el-menu-item
          v-if="authStore.canAny(['data:infrastructure:view', 'data:infrastructure:edit'])"
          index="/infrastructures"
        >
          <el-icon><OfficeBuilding /></el-icon>
          <span>{{ authStore.can("data:infrastructure:edit") ? "基建管理" : "基建" }}</span>
        </el-menu-item>
        <el-menu-item
          v-if="authStore.canAny(['data:tech:view', 'data:tech:edit'])"
          index="/tech-tree"
        >
          <el-icon><DataLine /></el-icon>
          <span>{{ authStore.can("data:tech:edit") ? "科技树管理" : "科技树" }}</span>
        </el-menu-item>
        <el-menu-item v-if="authStore.canAny(['data:fuel:view', 'data:fuel:edit'])" index="/fuels">
          <el-icon><Watermelon /></el-icon>
          <span>{{ authStore.can("data:fuel:edit") ? "燃料管理" : "燃料" }}</span>
        </el-menu-item>
        <el-menu-item
          v-if="authStore.canAny(['data:vehicle:view', 'data:vehicle:edit'])"
          index="/vehicles"
        >
          <el-icon><Van /></el-icon>
          <span>{{ authStore.can("data:vehicle:edit") ? "载具管理" : "载具" }}</span>
        </el-menu-item>
        <el-menu-item
          v-if="authStore.canAny(['data:warehouse:view', 'data:warehouse:edit'])"
          index="/warehouses"
        >
          <el-icon><Box /></el-icon>
          <span>{{ authStore.can("data:warehouse:edit") ? "仓库管理" : "仓库" }}</span>
        </el-menu-item>
        <el-menu-item
          v-if="authStore.canAny(['data:productionLine:view', 'data:productionLine:edit'])"
          index="/production-lines"
        >
          <el-icon><Cpu /></el-icon>
          <span>{{ authStore.can("data:productionLine:edit") ? "生产线管理" : "生产线" }}</span>
        </el-menu-item>
      </el-sub-menu>

      <el-menu-item
        v-if="authStore.canAny(['data:region:view', 'data:region:edit'])"
        index="/region-overview"
      >
        <el-icon><Histogram /></el-icon>
        <span>区域总览</span>
      </el-menu-item>

      <el-menu-item
        v-if="authStore.canAny(['contractType:view', 'contractType:manage'])"
        index="/contract-types"
      >
        <el-icon><Document /></el-icon>
        <span>{{ authStore.can("contractType:manage") ? "合同类型管理" : "合同类型" }}</span>
      </el-menu-item>

      <el-menu-item
        v-if="authStore.canAny(['contract:view', 'contract:execute', 'contract:manage'])"
        index="/contracts"
      >
        <el-icon><Files /></el-icon>
        <span>{{ authStore.can("contract:manage") ? "合同管理" : "合同" }}</span>
      </el-menu-item>

      <el-menu-item
        v-if="authStore.canAny(['industryType:view', 'industryType:manage'])"
        index="/industry-types"
      >
        <el-icon><Grid /></el-icon>
        <span>{{ authStore.can("industryType:manage") ? "产业类型管理" : "产业类型" }}</span>
      </el-menu-item>

      <el-menu-item
        v-if="authStore.canAny(['company:view', 'company:manage'])"
        index="/companies"
      >
        <el-icon><OfficeBuilding /></el-icon>
        <span>{{ authStore.can("company:manage") ? "公司管理" : "公司" }}</span>
      </el-menu-item>

      <el-menu-item v-if="authStore.can('account:manage')" index="/accounts">
        <el-icon><UserFilled /></el-icon>
        <span>账户管理</span>
      </el-menu-item>

      <el-menu-item index="/settings">
        <el-icon><Tools /></el-icon>
        <span>系统设置</span>
      </el-menu-item>
    </el-menu>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import { useCompetitionStore } from "@/stores/competition";

const route = useRoute();
const authStore = useAuthStore();
const compStore = useCompetitionStore();

const activeMenu = computed(() => {
  const path = route.path;
  const dataRoutes = [
    "/materials",
    "/parts",
    "/products",
    "/maps",
    "/infrastructures",
    "/tech-tree",
    "/fuels",
    "/vehicles",
    "/warehouses",
    "/production-lines",
  ];
  if (dataRoutes.includes(path)) {
    return path;
  }
  // 顶级菜单（合同管理、公司、账户、仪表盘等）直接按路径高亮
  return path;
});
</script>

<style scoped>
.sidebar {
  width: var(--sidebar-width);
  height: 100vh;
  background: linear-gradient(180deg, #ffffff 0%, #fbfcfe 100%);
  border-right: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  user-select: none;
  position: relative;
  overflow: hidden;
}
.sidebar::before {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: var(--gradient-brand);
  z-index: 2;
  pointer-events: none;
}
.sidebar-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 20px 20px 18px;
  border-bottom: 1px solid var(--color-border);
}
.brand-text {
  display: flex;
  flex-direction: column;
  line-height: 1.25;
  width: 100%;
}
.brand-name {
  font-size: 16px;
  font-weight: 800;
  background: var(--gradient-brand);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  color: transparent;
  letter-spacing: 0.3px;
}
.brand-meta {
  margin-top: 10px;
  padding: 10px;
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: #f7f8fa;
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.brand-meta .meta-row {
  display: flex;
  justify-content: center;
}
.brand-meta .fy-loading .el-icon {
  vertical-align: -2px;
  margin-right: 3px;
}
.brand-meta .meta-hint {
  font-size: 12px;
  color: var(--color-text-tertiary);
}
.brand-meta .meta-hint a {
  color: var(--color-primary);
  text-decoration: none;
  font-weight: 500;
}
.brand-meta .meta-hint a:hover {
  text-decoration: underline;
}
.sidebar-menu {
  flex: 1;
  border-right: none;
  overflow-y: auto;
  padding: 12px 0;
}
.sidebar-menu :deep(.el-sub-menu__title),
.sidebar-menu :deep(.el-menu-item) {
  height: 44px;
  line-height: 44px;
  margin: 2px 12px;
  border-radius: var(--radius-sm);
  font-size: 13.5px;
  color: var(--color-text-secondary);
  transition: all var(--dur-fast) var(--ease-standard);
}
.sidebar-menu :deep(.el-sub-menu__title:hover),
.sidebar-menu :deep(.el-menu-item:not(.is-active):hover) {
  background: var(--el-color-primary-light-9);
  color: var(--color-primary);
}
.sidebar-menu :deep(.el-menu-item.is-active) {
  position: relative;
  background: var(--gradient-brand-soft);
  color: var(--color-primary);
  font-weight: 600;
}
.sidebar-menu :deep(.el-menu-item.is-active)::before {
  content: "";
  position: absolute;
  left: -12px;
  top: 50%;
  transform: translateY(-50%);
  width: 4px;
  height: 22px;
  border-radius: 0 4px 4px 0;
  background: var(--gradient-brand);
}
.sidebar-menu :deep(.el-sub-menu__title) {
  font-weight: 500;
}
.sidebar-menu :deep(.el-menu-item .el-icon),
.sidebar-menu :deep(.el-sub-menu__title .el-icon) {
  font-size: 17px;
}
</style>
