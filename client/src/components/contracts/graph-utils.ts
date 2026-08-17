/**
 * 图编辑器工程化工具函数
 *
 * 提供自动布局、搜索定位等辅助功能。
 */

interface GraphNode {
  id: string;
  type: string;
  x: number;
  y: number;
  data?: any;
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
}

interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * 自动布局（简单分层布局）
 * 按拓扑排序将节点分层，每层垂直排列
 */
export function autoLayout(graph: Graph, options?: {
  nodeWidth?: number;
  nodeHeight?: number;
  horizontalGap?: number;
  verticalGap?: number;
}): Graph {
  const nodeWidth = options?.nodeWidth ?? 200;
  const nodeHeight = options?.nodeHeight ?? 100;
  const horizontalGap = options?.horizontalGap ?? 50;
  const verticalGap = options?.verticalGap ?? 30;

  // 构建邻接表
  const inDegree = new Map<string, number>();
  const children = new Map<string, string[]>();

  for (const node of graph.nodes) {
    inDegree.set(node.id, 0);
    children.set(node.id, []);
  }

  for (const edge of graph.edges) {
    const current = inDegree.get(edge.target) ?? 0;
    inDegree.set(edge.target, current + 1);
    const siblings = children.get(edge.source) ?? [];
    siblings.push(edge.target);
    children.set(edge.source, siblings);
  }

  // 拓扑排序（BFS）
  const layers: string[][] = [];
  const queue: string[] = [];

  // 找出入度为 0 的节点（根节点）
  for (const [id, degree] of inDegree) {
    if (degree === 0) {
      queue.push(id);
    }
  }

  while (queue.length > 0) {
    const layer: string[] = [];
    const nextQueue: string[] = [];

    for (const id of queue) {
      layer.push(id);
      for (const childId of children.get(id) ?? []) {
        const degree = (inDegree.get(childId) ?? 1) - 1;
        inDegree.set(childId, degree);
        if (degree === 0) {
          nextQueue.push(childId);
        }
      }
    }

    layers.push(layer);
    queue.length = 0;
    queue.push(...nextQueue);
  }

  // 计算每个节点的新位置
  const positions = new Map<string, { x: number; y: number }>();

  for (let layerIdx = 0; layerIdx < layers.length; layerIdx++) {
    const layer = layers[layerIdx];
    const layerWidth = layer.length * (nodeWidth + horizontalGap) - horizontalGap;
    const startX = -layerWidth / 2;

    for (let nodeIdx = 0; nodeIdx < layer.length; nodeIdx++) {
      const nodeId = layer[nodeIdx];
      positions.set(nodeId, {
        x: startX + nodeIdx * (nodeWidth + horizontalGap),
        y: layerIdx * (nodeHeight + verticalGap),
      });
    }
  }

  // 更新节点位置
  const newNodes = graph.nodes.map((node) => {
    const pos = positions.get(node.id);
    return pos ? { ...node, x: pos.x, y: pos.y } : node;
  });

  return { ...graph, nodes: newNodes };
}

/**
 * 搜索节点
 * 按节点类型、标签、数据内容搜索
 */
export function searchNodes(graph: Graph, query: string, nodeMeta: Record<string, any>): GraphNode[] {
  if (!query.trim()) return [];

  const q = query.toLowerCase();
  return graph.nodes.filter((node) => {
    const meta = nodeMeta[node.type];
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

/**
 * 定位到节点（返回节点的中心坐标）
 */
export function focusNode(node: GraphNode, nodeWidth = 200, nodeHeight = 100): { x: number; y: number } {
  return {
    x: node.x + nodeWidth / 2,
    y: node.y + nodeHeight / 2,
  };
}

/**
 * 缩放画布
 */
export function zoomCanvas(currentZoom: number, delta: number, min = 0.3, max = 2): number {
  return Math.min(max, Math.max(min, currentZoom + delta));
}

/**
 * 适应画布（返回包含所有节点的边界框）
 */
export function fitCanvas(graph: Graph, padding = 50): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  if (graph.nodes.length === 0) {
    return { x: 0, y: 0, width: 800, height: 600 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const node of graph.nodes) {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + 200); // 假设节点宽度 200
    maxY = Math.max(maxY, node.y + 100); // 假设节点高度 100
  }

  return {
    x: minX - padding,
    y: minY - padding,
    width: maxX - minX + padding * 2 + 200,
    height: maxY - minY + padding * 2 + 100,
  };
}

/**
 * 折叠/展开节点子树
 */
export function toggleNodeCollapse(graph: Graph, nodeId: string, collapsed: Set<string>): {
  graph: Graph;
  collapsed: Set<string>;
} {
  const newCollapsed = new Set(collapsed);

  if (newCollapsed.has(nodeId)) {
    newCollapsed.delete(nodeId);
  } else {
    newCollapsed.add(nodeId);
  }

  // 隐藏被折叠节点的子节点
  const hiddenNodes = new Set<string>();

  function collectDescendants(id: string) {
    for (const edge of graph.edges) {
      if (edge.source === id) {
        hiddenNodes.add(edge.target);
        collectDescendants(edge.target);
      }
    }
  }

  for (const id of newCollapsed) {
    collectDescendants(id);
  }

  const newNodes = graph.nodes.map((node) => ({
    ...node,
    hidden: hiddenNodes.has(node.id),
  }));

  const newEdges = graph.edges.map((edge) => ({
    ...edge,
    hidden: hiddenNodes.has(edge.source) || hiddenNodes.has(edge.target),
  }));

  return {
    graph: { ...graph, nodes: newNodes, edges: newEdges },
    collapsed: newCollapsed,
  };
}
