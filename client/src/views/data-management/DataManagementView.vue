<template>
  <component :is="managerComponent" v-bind="currentConfig as any" v-if="currentConfig" />
  <component :is="managerComponent" v-else-if="isManagerType" />
  <div v-else class="placeholder">
    <h2>{{ title }}</h2>
    <p>此模块正在开发中</p>
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent } from "vue";
import { useRoute } from "vue-router";
import { moduleConfigs } from "@/config/dataModules";

const route = useRoute();
const type = computed(() => (route.meta?.type as string) || "");
const title = computed(() => (route.meta?.title as string) || "");

const MANAGER_TYPES = [
  "maps",
  "parts",
  "products",
  "vehicles",
  "tech-tree",
  "materials",
  "warehouses",
  "production-lines",
  "infrastructures",
  "fuels",
];

const isManagerType = computed(() => MANAGER_TYPES.includes(type.value as string));

const currentConfig = computed(() =>
  isManagerType.value ? null : moduleConfigs[type.value] || null,
);

const managerComponent = computed(() => {
  if (type.value === "maps") return defineAsyncComponent(() => import("./MapsManager.vue"));
  if (type.value === "parts") return defineAsyncComponent(() => import("./PartsManager.vue"));
  if (type.value === "products") return defineAsyncComponent(() => import("./ProductsManager.vue"));
  if (type.value === "vehicles") return defineAsyncComponent(() => import("./VehiclesManager.vue"));
  if (type.value === "tech-tree")
    return defineAsyncComponent(() => import("./TechTreeManager.vue"));
  if (type.value === "materials")
    return defineAsyncComponent(() => import("./MaterialsManager.vue"));
  if (type.value === "warehouses")
    return defineAsyncComponent(() => import("./WarehousesManager.vue"));
  if (type.value === "production-lines")
    return defineAsyncComponent(() => import("./ProductionLinesManager.vue"));
  if (type.value === "infrastructures")
    return defineAsyncComponent(() => import("./InfrastructureManager.vue"));
  if (type.value === "fuels")
    return defineAsyncComponent(() => import("./FuelManager.vue"));
  return defineAsyncComponent(() => import("@/components/common/DataManager.vue"));
});
</script>

<style scoped>
.placeholder {
  padding: 24px;
}
.placeholder h2 {
  position: relative;
  font-size: var(--font-2xl);
  font-weight: 700;
  color: var(--color-text-primary);
  letter-spacing: -0.01em;
  padding-left: 14px;
  margin: 0 0 8px;
}
.placeholder h2::before {
  content: "";
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 4px;
  height: 18px;
  border-radius: 4px;
  background: var(--gradient-brand);
}
.placeholder p {
  font-size: 14px;
  color: #8c8c8c;
}
</style>
