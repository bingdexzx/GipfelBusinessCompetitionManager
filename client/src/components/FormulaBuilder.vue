<template>
  <div class="fb-node" :class="{ 'fb-root': (level || 0) === 0 }">
    <div class="fb-head">
      <el-select :model-value="node.type" size="small" style="width: 110px" @change="onTypeChange">
        <el-option label="常量" value="const" />
        <el-option label="字段" value="field" />
        <el-option label="运算" value="op" />
      </el-select>
      <el-select
        v-if="node.type === 'op'"
        :model-value="node.op"
        size="small"
        style="width: 80px"
        @change="onOpChange"
      >
        <el-option label="加 +" value="+" />
        <el-option label="减 -" value="-" />
        <el-option label="乘 ×" value="*" />
        <el-option label="除 ÷" value="/" />
      </el-select>
      <span v-if="node.type === 'const'" class="fb-hint">固定数值</span>
      <span v-else-if="node.type === 'field'" class="fb-hint">引用同产业其它字段</span>
      <span v-else class="fb-hint">二元运算（可继续嵌套）</span>
    </div>

    <div class="fb-body">
      <el-input-number
        v-if="node.type === 'const'"
        v-model="node.value"
        :controls="false"
        size="small"
        style="width: 160px"
      />
      <el-select
        v-else-if="node.type === 'field'"
        v-model="node.fieldKey"
        size="small"
        style="width: 240px"
        placeholder="选择字段"
        filterable
      >
        <el-option
          v-for="f in availableFields"
          :key="f.fieldKey"
          :label="`${f.name}（${f.fieldKey}）`"
          :value="f.fieldKey"
        />
      </el-select>
      <div v-else-if="node.type === 'op'" class="fb-children">
        <div class="fb-child">
          <span class="fb-tag">左</span>
          <FormulaBuilder
            :model-value="node.left"
            :available-fields="availableFields"
            :level="(level || 0) + 1"
            @update:model-value="(v) => setChild('left', v)"
          />
        </div>
        <div class="fb-child">
          <span class="fb-tag">右</span>
          <FormulaBuilder
            :model-value="node.right"
            :available-fields="availableFields"
            :level="(level || 0) + 1"
            @update:model-value="(v) => setChild('right', v)"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, watch } from "vue";
import FormulaBuilder from "./FormulaBuilder.vue";

const props = defineProps<{
  modelValue: any;
  availableFields?: { fieldKey: string; name: string }[];
  level?: number;
}>();
const emit = defineEmits<{ (e: "update:modelValue", v: any): void }>();

function clone(v: any): any {
  if (v && typeof v === "object") return JSON.parse(JSON.stringify(v));
  return { type: "const", value: 0 };
}

const node = reactive(clone(props.modelValue));

// 外部 modelValue 变化（如重新编辑某个字段）时同步；与当前内容相同则跳过，避免双向回环
watch(
  () => props.modelValue,
  (v) => {
    const next = clone(v);
    if (JSON.stringify(next) === JSON.stringify(node)) return;
    Object.keys(node).forEach((k) => delete (node as any)[k]);
    Object.assign(node, next);
  },
);

// 任意内部结构变化都向上抛出（深监听，树很小，性能无虞）
watch(node, () => emit("update:modelValue", JSON.parse(JSON.stringify(node))), {
  deep: true,
  flush: "post",
});

function rebuild(t: string) {
  Object.keys(node).forEach((k) => delete (node as any)[k]);
  if (t === "const") Object.assign(node, { type: "const", value: 0 });
  else if (t === "field")
    Object.assign(node, {
      type: "field",
      fieldKey: props.availableFields?.[0]?.fieldKey || "",
    });
  else
    Object.assign(node, {
      type: "op",
      op: "+",
      left: { type: "const", value: 0 },
      right: { type: "const", value: 0 },
    });
}

function onTypeChange(t: string) {
  rebuild(t);
}
function onOpChange(op: string) {
  node.op = op;
}
function setChild(which: "left" | "right", v: any) {
  (node as any)[which] = v;
}
</script>

<style scoped>
.fb-node {
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  padding: 8px;
  background: #fff;
}
.fb-root {
  background: #fafafa;
}
.fb-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.fb-hint {
  font-size: 12px;
  color: #909399;
}
.fb-body {
  display: flex;
  align-items: center;
}
.fb-children {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}
.fb-child {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
.fb-tag {
  display: inline-block;
  min-width: 22px;
  text-align: center;
  font-size: 12px;
  color: #606266;
  background: #ecf5ff;
  border-radius: 4px;
  padding: 2px 4px;
  margin-top: 4px;
}
</style>
