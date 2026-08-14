<template>
  <el-dialog v-model="model" title="更新记录" width="560px" append-to-body>
    <div
      v-for="(a, i) in announcements"
      :key="a.version"
      class="ah-item"
      :class="{ 'ah-latest': i === 0 }"
    >
      <div class="ah-head">
        <span class="ah-title">{{ a.title }}</span>
        <span class="ah-meta">v{{ a.version }} · {{ a.date }}</span>
        <el-tag v-if="i === 0" size="small" type="success" effect="light">最新</el-tag>
      </div>
      <div class="ah-content" v-html="a.content"></div>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { announcements } from "@/data/announcement";

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits(["update:modelValue"]);

const model = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit("update:modelValue", v),
});
</script>

<style scoped>
.ah-item {
  padding: 16px 0;
  border-bottom: 1px solid #f0f0f0;
}
.ah-item:last-child {
  border-bottom: none;
}
.ah-latest {
  padding-top: 0;
}
.ah-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.ah-title {
  font-size: 15px;
  font-weight: 600;
  color: #1f1f1f;
}
.ah-meta {
  font-size: 12px;
  color: #8c8c8c;
}
.ah-content {
  font-size: 14px;
  line-height: 1.75;
  color: #1f1f1f;
  max-height: 46vh;
  overflow-y: auto;
  word-break: break-word;
}
.ah-content :deep(p) {
  margin: 8px 0;
}
.ah-content :deep(ul) {
  padding-left: 22px;
  margin: 8px 0;
}
.ah-content :deep(li) {
  margin: 4px 0;
}
.ah-content :deep(b) {
  font-weight: 600;
}
</style>
