<template>
  <div class="formula-panel">
    <div class="fp-main">
      <div class="fp-sidebar">
        <div class="fp-section-title">可用字段</div>
        <div class="fp-field-list">
          <div
            v-for="field in nonCalculatedFields"
            :key="field.fieldKey"
            class="fp-field-item"
            :class="{
              'fp-field-string': field.fieldType === 'STRING',
              'fp-field-bool': field.fieldType === 'BOOLEAN',
            }"
            :title="`${field.name} (${field.fieldType})：点击插入`"
            @click="insertAtCursor(field.fieldKey)"
          >
            <span class="fp-field-key">{{ field.fieldKey }}</span>
            <span class="fp-field-name">{{ field.name }}</span>
            <span class="fp-field-type">{{
              field.fieldType === "NUMBER" ? "#" : field.fieldType === "STRING" ? "A" : "T/F"
            }}</span>
          </div>
        </div>
        <div v-if="nonCalculatedFields.length === 0" class="fp-empty">暂无可用字段</div>
      </div>

      <div class="fp-center">
        <div class="fp-section-title">运算符</div>
        <div class="fp-ops">
          <button
            v-for="op in operators"
            :key="op"
            class="fp-op-btn"
            :title="op"
            @click="insertAtCursor(op)"
          >
            {{ op }}
          </button>
        </div>
        <div class="fp-section-title" style="margin-top: 12px">函数</div>
        <div class="fp-funcs">
          <button
            v-for="fn in functions"
            :key="fn.key"
            class="fp-func-btn"
            :title="fn.desc"
            @click="insertAtCursor(fn.key + '()')"
          >
            {{ fn.label }}
          </button>
        </div>
        <div class="fp-section-title" style="margin-top: 12px">跨方引用 (合同用)</div>
        <div v-if="showCrossRefs" class="fp-refs">
          <button
            v-for="ref in crossRefs"
            :key="ref"
            class="fp-ref-btn"
            @click="insertAtCursor(ref)"
          >
            {{ ref }}
          </button>
        </div>
      </div>
    </div>

    <div class="fp-input-area">
      <div class="fp-input-header">
        <span class="fp-input-label">公式表达式</span>
        <span v-if="validationResult?.valid" class="fp-valid">有效</span>
        <span v-else-if="validationResult" class="fp-invalid">{{ validationResult.error }}</span>
      </div>
      <textarea
        ref="textareaRef"
        class="fp-textarea"
        :class="{ 'fp-textarea-error': validationResult && !validationResult.valid }"
        :value="modelValue"
        placeholder="输入公式，例如: (revenue - cost) * (1 - taxRate)"
        rows="3"
        @input="onInput"
        @keydown.tab.prevent="onTab"
      ></textarea>
      <div v-if="modelValue && previewResult !== null" class="fp-preview">
        <span class="fp-preview-label">预览 (默认值): </span>
        <span class="fp-preview-value">{{ previewResult }}</span>
        <span v-if="fieldKeysUsed.length > 0" class="fp-preview-deps">
          &nbsp;依赖: {{ fieldKeysUsed.join(", ") }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, nextTick } from "vue";
import { evaluateFormula } from "../../utils/safe-math";

interface Field {
  fieldKey: string;
  name: string;
  fieldType: string;
  isCalculated?: boolean;
  defaultValue?: string;
}

interface ValidationResult {
  valid: boolean;
  error?: string;
  dependencies?: string[];
}

const props = defineProps<{
  modelValue: string;
  fields: Field[];
  validationResult?: ValidationResult | null;
  /** 是否显示「跨方引用(合同用)」区块；产业字段编辑器等非合同场景传 false 隐藏 */
  showCrossRefs?: boolean;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", value: string): void;
  (e: "validate", formula: string): void;
}>();

const textareaRef = ref<HTMLTextAreaElement>();

const nonCalculatedFields = computed(() => props.fields.filter((f) => !f.isCalculated));

const operators = ["+", "-", "*", "/", "(", ")", ",", ".", " "];
const functions = [
  { key: "round", label: "ROUND", desc: "四舍五入" },
  { key: "max", label: "MAX", desc: "最大值" },
  { key: "min", label: "MIN", desc: "最小值" },
  { key: "abs", label: "ABS", desc: "绝对值" },
  { key: "ceil", label: "CEIL", desc: "向上取整" },
  { key: "floor", label: "FLOOR", desc: "向下取整" },
  { key: "sqrt", label: "SQRT", desc: "平方根" },
  { key: "pow", label: "POW", desc: "幂运算" },
  { key: "log", label: "LOG", desc: "对数" },
  { key: "sum", label: "SUM", desc: "求和" },
  { key: "avg", label: "AVG", desc: "平均值" },
];
const crossRefs = ["{A.", "{B.", "{C."];

const fieldKeysUsed = computed(() => props.validationResult?.dependencies || []);

const previewResult = computed(() => {
  if (!props.modelValue) return null;
  try {
    const values: Record<string, number> = {};
    for (const field of props.fields) {
      if (field.fieldType === "NUMBER") {
        values[field.fieldKey] = parseFloat(field.defaultValue || "0") || 0;
      }
    }
    const expr = props.modelValue;
    const result = evaluateFormula(expr, values);
    return typeof result === "number" && Number.isFinite(result)
      ? Math.round(result * 100) / 100
      : null;
  } catch {
    return null;
  }
});

function onInput(e: Event) {
  const value = (e.target as HTMLTextAreaElement).value;
  emit("update:modelValue", value);
  nextTick(() => emit("validate", value));
}

function insertAtCursor(text: string) {
  const ta = textareaRef.value;
  if (!ta) {
    emit("update:modelValue", props.modelValue + text);
    nextTick(() => emit("validate", props.modelValue + text));
    return;
  }
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const newValue = props.modelValue.slice(0, start) + text + props.modelValue.slice(end);
  emit("update:modelValue", newValue);
  nextTick(() => {
    ta.focus();
    ta.selectionStart = ta.selectionEnd = start + text.length;
    emit("validate", newValue);
  });
}

function onTab(e: KeyboardEvent) {
  insertAtCursor("  ");
}
</script>

<style scoped>
.formula-panel {
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  overflow: hidden;
  background: #fff;
}
.fp-main {
  display: flex;
  border-bottom: 1px solid #e0e0e0;
}
.fp-sidebar {
  width: 220px;
  padding: 12px;
  border-right: 1px solid #e0e0e0;
  max-height: 300px;
  overflow-y: auto;
}
.fp-center {
  flex: 1;
  padding: 12px;
  max-height: 300px;
  overflow-y: auto;
}
.fp-section-title {
  font-size: 12px;
  font-weight: 500;
  color: #8c8c8c;
  text-transform: uppercase;
  margin-bottom: 8px;
}
.fp-field-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.fp-field-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  background: #f5f7fa;
  border: 1px solid transparent;
  transition: all 0.15s;
}
.fp-field-item:hover {
  background: #e6f1fb;
  border-color: #6366f1;
}
.fp-field-key {
  font-weight: 500;
  font-family: monospace;
  color: #4f46e5;
  min-width: 60px;
}
.fp-field-name {
  color: #8c8c8c;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fp-field-type {
  font-size: 10px;
  font-weight: 500;
  color: #fff;
  background: #6366f1;
  border-radius: 3px;
  padding: 1px 5px;
  min-width: 20px;
  text-align: center;
}
.fp-field-string .fp-field-type {
  background: #52a053;
}
.fp-field-bool .fp-field-type {
  background: #e89b3a;
}
.fp-empty {
  font-size: 12px;
  color: #c0c4cc;
  text-align: center;
  padding: 16px;
}
.fp-ops,
.fp-funcs,
.fp-refs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.fp-op-btn {
  width: 34px;
  height: 30px;
  font-size: 14px;
  font-weight: 500;
  font-family: monospace;
  border: 1px solid #dcdfe6;
  background: #fff;
  border-radius: 4px;
  cursor: pointer;
  color: #1f1f1f;
  transition: all 0.15s;
}
.fp-op-btn:hover {
  background: #e6f1fb;
  border-color: #6366f1;
}
.fp-func-btn {
  padding: 4px 8px;
  font-size: 11px;
  font-weight: 500;
  font-family: monospace;
  border: 1px solid #dcdfe6;
  background: #f5f7fa;
  border-radius: 4px;
  cursor: pointer;
  color: #4f46e5;
  transition: all 0.15s;
}
.fp-func-btn:hover {
  background: #e6f1fb;
  border-color: #6366f1;
}
.fp-ref-btn {
  padding: 4px 8px;
  font-size: 12px;
  font-family: monospace;
  border: 1px solid #faeeda;
  background: #faeeda;
  border-radius: 4px;
  cursor: pointer;
  color: #633806;
  transition: all 0.15s;
}
.fp-ref-btn:hover {
  background: rgba(var(--color-warning-soft-rgb), 0.3);
  border-color: #ef9f27;
}

.fp-input-area {
  padding: 12px;
}
.fp-input-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}
.fp-input-label {
  font-size: 12px;
  font-weight: 500;
  color: #8c8c8c;
}
.fp-valid {
  font-size: 11px;
  color: #52a053;
  display: flex;
  align-items: center;
  gap: 4px;
}
.fp-valid::before {
  content: "✓";
}
.fp-invalid {
  font-size: 11px;
  color: #c8423b;
}
.fp-textarea {
  width: 100%;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  padding: 8px 10px;
  font-size: 14px;
  font-family: "Courier New", Courier, monospace;
  line-height: 1.6;
  resize: vertical;
  outline: none;
  transition: border-color 0.15s;
  background: #fafbfc;
}
.fp-textarea:focus {
  border-color: #6366f1;
}
.fp-textarea-error {
  border-color: #c8423b;
  background: #fef0ef;
}
.fp-preview {
  margin-top: 8px;
  font-size: 12px;
  color: #8c8c8c;
  padding: 6px 10px;
  background: #f5f7fa;
  border-radius: 4px;
}
.fp-preview-value {
  font-weight: 500;
  color: #4f46e5;
  font-family: monospace;
}
.fp-preview-deps {
  color: #c0c4cc;
}
</style>
