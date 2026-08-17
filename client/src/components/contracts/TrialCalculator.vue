<template>
  <div class="trial-calculator">
    <el-card shadow="never">
      <template #header>
        <div class="calculator-header">
          <span>试算器</span>
          <el-button size="small" type="primary" :loading="calculating" @click="runTrial">
            运行试算
          </el-button>
        </div>
      </template>

      <el-form :model="trialForm" label-width="120px" size="small">
        <el-form-item label="参与方">
          <el-select v-model="trialForm.party" placeholder="选择参与方">
            <el-option
              v-for="party in parties"
              :key="party.role"
              :label="party.label"
              :value="party.role"
            />
          </el-select>
        </el-form-item>

        <el-form-item label="公司 ID">
          <el-input-number v-model="trialForm.companyId" :min="1" />
        </el-form-item>

        <el-divider>输入参数</el-divider>

        <el-form-item
          v-for="input in inputs"
          :key="input.key"
          :label="input.label"
        >
          <el-input-number
            v-if="input.type === 'NUMBER'"
            v-model="trialForm.inputs[input.key]"
            style="width: 100%"
          />
          <el-input
            v-else-if="input.type === 'STRING'"
            v-model="trialForm.inputs[input.key]"
          />
          <el-switch
            v-else-if="input.type === 'BOOLEAN'"
            v-model="trialForm.inputs[input.key]"
          />
          <el-input
            v-else
            v-model="trialForm.inputs[input.key]"
            placeholder="JSON 值"
          />
        </el-form-item>
      </el-form>

      <el-divider>试算结果</el-divider>

      <div v-if="trialResult" class="trial-result">
        <el-descriptions :column="1" border size="small">
          <el-descriptions-item label="执行状态">
            <el-tag :type="trialResult.success ? 'success' : 'danger'">
              {{ trialResult.success ? '成功' : '失败' }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item v-if="trialResult.error" label="错误信息">
            <span class="error-text">{{ trialResult.error }}</span>
          </el-descriptions-item>
        </el-descriptions>

        <div v-if="trialResult.effects && trialResult.effects.length > 0" class="effects-list">
          <h4>效果预览</h4>
          <el-table :data="trialResult.effects" border size="small">
            <el-table-column prop="fieldKey" label="字段" />
            <el-table-column prop="op" label="操作" width="80" />
            <el-table-column label="当前值">
              <template #default="{ row }">{{ formatValue(row.before) }}</template>
            </el-table-column>
            <el-table-column label="新值">
              <template #default="{ row }">{{ formatValue(row.after) }}</template>
            </el-table-column>
            <el-table-column label="变化">
              <template #default="{ row }">
                <span :class="getChangeClass(row)">
                  {{ formatChange(row) }}
                </span>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </div>

      <div v-else class="trial-empty">
        <el-empty description="点击「运行试算」查看效果预览" :image-size="60" />
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, watch } from 'vue';
import { ElMessage } from 'element-plus';
import api from '@/api';

interface PartyRole {
  role: string;
  label: string;
}

interface InputField {
  key: string;
  label: string;
  type: string;
}

interface TrialEffect {
  fieldKey: string;
  op: string;
  before: any;
  after: any;
  value: any;
}

interface TrialResult {
  success: boolean;
  error?: string;
  effects?: TrialEffect[];
}

const props = defineProps<{
  contractTypeId: number;
  parties: PartyRole[];
  inputs: InputField[];
}>();

const calculating = ref(false);
const trialResult = ref<TrialResult | null>(null);

const trialForm = reactive({
  party: '',
  companyId: 1,
  inputs: {} as Record<string, any>,
});

// 初始化输入参数默认值
watch(() => props.inputs, (inputs) => {
  for (const input of inputs) {
    if (!(input.key in trialForm.inputs)) {
      if (input.type === 'NUMBER') {
        trialForm.inputs[input.key] = 0;
      } else if (input.type === 'BOOLEAN') {
        trialForm.inputs[input.key] = false;
      } else {
        trialForm.inputs[input.key] = '';
      }
    }
  }
}, { immediate: true });

async function runTrial() {
  if (!trialForm.party) {
    ElMessage.error('请选择参与方');
    return;
  }

  calculating.value = true;
  trialResult.value = null;

  try {
    const res = await api.post(`/contracts/trial`, {
      contractTypeId: props.contractTypeId,
      parties: [{ role: trialForm.party, companyId: trialForm.companyId }],
      inputs: trialForm.inputs,
    });
    trialResult.value = res as TrialResult;
  } catch (e: any) {
    trialResult.value = {
      success: false,
      error: e.message || '试算失败',
    };
  } finally {
    calculating.value = false;
  }
}

function formatValue(value: any): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function formatChange(effect: TrialEffect): string {
  if (effect.op === 'SET') return `→ ${formatValue(effect.after)}`;
  const before = Number(effect.before) || 0;
  const after = Number(effect.after) || 0;
  const diff = after - before;
  if (diff > 0) return `+${diff}`;
  return String(diff);
}

function getChangeClass(effect: TrialEffect): string {
  if (effect.op === 'SET') return '';
  const before = Number(effect.before) || 0;
  const after = Number(effect.after) || 0;
  const diff = after - before;
  if (diff > 0) return 'change-positive';
  if (diff < 0) return 'change-negative';
  return '';
}
</script>

<style scoped>
.trial-calculator {
  margin-top: 16px;
}

.calculator-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.trial-result {
  margin-top: 16px;
}

.effects-list {
  margin-top: 16px;
}

.effects-list h4 {
  margin: 0 0 12px;
  font-size: 14px;
  color: #606266;
}

.error-text {
  color: #f56c6c;
}

.change-positive {
  color: #67c23a;
  font-weight: bold;
}

.change-negative {
  color: #f56c6c;
  font-weight: bold;
}

.trial-empty {
  padding: 20px 0;
}
</style>
