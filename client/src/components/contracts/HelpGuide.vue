<template>
  <div class="help-guide">
    <el-popover
      trigger="click"
      :width="400"
      placement="bottom-end"
    >
      <template #reference>
        <el-button size="small" circle>
          <el-icon><QuestionFilled /></el-icon>
        </el-button>
      </template>

      <div class="help-content">
        <h3>{{ title }}</h3>
        <el-divider />

        <div v-for="(section, idx) in sections" :key="idx" class="help-section">
          <h4>{{ section.title }}</h4>
          <p>{{ section.content }}</p>
          <ul v-if="section.items">
            <li v-for="(item, i) in section.items" :key="i">
              <strong>{{ item.label }}：</strong>{{ item.description }}
            </li>
          </ul>
        </div>

        <div v-if="tips?.length" class="help-tips">
          <h4>💡 提示</h4>
          <ul>
            <li v-for="(tip, idx) in tips" :key="idx">{{ tip }}</li>
          </ul>
        </div>
      </div>
    </el-popover>
  </div>
</template>

<script setup lang="ts">
import { QuestionFilled } from '@element-plus/icons-vue';

interface HelpSection {
  title: string;
  content: string;
  items?: Array<{
    label: string;
    description: string;
  }>;
}

defineProps<{
  title: string;
  sections: HelpSection[];
  tips?: string[];
}>();
</script>

<style scoped>
.help-guide {
  display: inline-block;
}

.help-content h3 {
  margin: 0 0 12px;
  font-size: 16px;
  color: #303133;
}

.help-section {
  margin-bottom: 16px;
}

.help-section h4 {
  margin: 0 0 8px;
  font-size: 14px;
  color: #606266;
}

.help-section p {
  margin: 0 0 8px;
  color: #909399;
  font-size: 13px;
}

.help-section ul {
  margin: 0;
  padding-left: 20px;
}

.help-section li {
  margin-bottom: 4px;
  color: #606266;
  font-size: 13px;
}

.help-tips {
  background: #f5f7fa;
  padding: 12px;
  border-radius: 4px;
}

.help-tips h4 {
  margin: 0 0 8px;
  font-size: 14px;
  color: #e6a23c;
}

.help-tips ul {
  margin: 0;
  padding-left: 20px;
}

.help-tips li {
  margin-bottom: 4px;
  color: #909399;
  font-size: 13px;
}
</style>
