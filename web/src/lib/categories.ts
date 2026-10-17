import type { CategoryStat, CategoryTreeNode } from '@/types'

/**
 * 将平铺的分类列表（支持斜杠 / 分层，如 "计算机/Python/Web"）构造为多层级树状结构，
 * 并自动计算每个节点的直接数量及子树累计总数。
 */
export function buildCategoryTree(stats: CategoryStat[]): CategoryTreeNode[] {
  const rootNodes: CategoryTreeNode[] = []
  const nodeMap = new Map<string, CategoryTreeNode>()

  function getOrCreateNode(pathParts: string[], depth: number): CategoryTreeNode {
    const fullPath = pathParts.join('/')
    let node = nodeMap.get(fullPath)
    if (node) return node

    const name = pathParts[pathParts.length - 1]
    node = {
      fullPath,
      name,
      count: 0,
      totalCount: 0,
      depth,
      children: [],
    }
    nodeMap.set(fullPath, node)

    if (pathParts.length === 1) {
      rootNodes.push(node)
    } else {
      const parentParts = pathParts.slice(0, -1)
      const parentNode = getOrCreateNode(parentParts, depth - 1)
      parentNode.children.push(node)
    }
    return node
  }

  // 1. 创建节点并填充直接命中数量
  for (const item of stats) {
    if (!item.name || !item.name.trim()) continue
    const parts = item.name.split('/').map((s) => s.trim()).filter(Boolean)
    if (parts.length === 0) continue

    const node = getOrCreateNode(parts, parts.length - 1)
    node.count += item.count
  }

  // 2. 递归汇总 totalCount 并对子节点进行排序
  function finalizeNode(node: CategoryTreeNode): number {
    let subSum = 0
    for (const child of node.children) {
      subSum += finalizeNode(child)
    }
    node.totalCount = node.count + subSum
    // 子节点按照 totalCount 降序，相同按名称字典序排序
    node.children.sort((a, b) => b.totalCount - a.totalCount || a.name.localeCompare(b.name))
    return node.totalCount
  }

  for (const root of rootNodes) {
    finalizeNode(root)
  }

  // 顶层节点排序
  rootNodes.sort((a, b) => b.totalCount - a.totalCount || a.name.localeCompare(b.name))
  return rootNodes
}
