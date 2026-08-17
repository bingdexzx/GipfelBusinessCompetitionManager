<template>
  <div class="graph-toolbar">
    <div class="toolbar-group">
      <el-tooltip content="自动布局">
        <el-button size="small" @click="$emit('auto-layout')">
          <el-icon><Grid /></el-icon>
        </el-button>
      </el-tooltip>
      <el-tooltip content="适应画布">
        <el-button size="small" @click="$emit('fit-canvas')">
          <el-icon><FullScreen /></el-icon>
        </el-button>
      </el-tooltip>
      <el-tooltip content="放大">
        <el-button size="small" @click="$emit('zoom-in')">
          <el-icon><ZoomIn /></el-icon>
        </el-button>
      </el-tooltip>
      <el-tooltip content="缩小">
        <el-button size="small" @click="$emit('zoom-out')">
          <el-icon><ZoomOut /></el-icon>
        </el-button>
      </el-tooltip>
    </div>

    <div class="toolbar-group">
      <el-input
        v-model="searchQuery"
        size="small"
        placeholder="搜索节点..."
        clearable
        style="width: 200px"
        @input="onSearch"
      >
        <template #prefix>
          <el-icon><Search /></el-icon>
        </template>
      </el-input>
      <el-select
        v-if="searchResults.length > 0"
        v-model="selectedNode"
        size="small"
        placeholder="定位到节点"
        style="width: 150px"
        @change="onFocus"
      >
        <el-option
          v-for="node in searchResults"
          :key="node.id"
          :label="getNodeLabel(node)"
          :value="node.id"
        />
      </el-select>
    </div>

    <div class="toolbar-group">
      <el-tag v-if="nodeCount > 0" size="small" type="info">
        节点: {{ nodeCount }}
      </el-tag>
      <el-tag v-if="edgeCount > 0" size="small" type="info">
        连线: {{ edgeCount }}
      </el-tag>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { Grid, FullScreen, ZoomIn, ZoomOut, Search } from '@element-plus/icons-vue';

interface GraphNode {
  id: string;
  type: string;
  x: number;
  y: number;
  data?: any;
}

const props = defineProps<{
  nodes: GraphNode[];
  nodeMeta: Record<string, any>;
}>();

const emit = defineEmits<{
  (e: 'auto-layout'): void;
  (e: 'fit-canvas'): void;
  (e: 'zoom-in'): void;
  (e: 'zoom-out'): void;
  (e: 'focus-node', nodeId: string): void;
}>();

const searchQuery = ref('');
const selectedNode = ref('');
const searchResults = ref<GraphNode[]>([]);

const nodeCount = computed(() => props.nodes.length);
const edgeCount = computed(() => 0); // 需要从父组件传入

function getNodeLabel(node: GraphNode): string {
  const meta = props.nodeMeta[node.type];
  return meta?.title || node.type;
}

function onSearch() {
  if (!searchQuery.value.trim()) {
    searchResults.value = [];
    return;
  }

  const q = searchQuery.value.toLowerCase();
  searchResults.value = props.nodes.filter((node) => {
    const meta = props.nodeMeta[node.type];
    if (!meta) return false;

    // 搜索节点类型标题
    if (meta.title?.toLowerCase().includes(q)) return true;

    // 搜索节点数据
    if (node.data) {
      const dataStr = JSON.stringify(node.data).toLowerCase();
      if (dataStr.includes(q)) return true;
    }

    return false;
  });
}

function onFocus(nodeId: string) {
  emit('focus-node', nodeId);
  selectedNode.value = '';
}
</script>

<style scoped>
.graph-toolbar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 12px;
  background: #f5f7fa;
  border-bottom: 1px solid #e4e7ed;
}

.toolbar-group {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
