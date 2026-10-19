import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Folder, FolderOpen, FolderTree, Search, X } from 'lucide-react'
import { api } from '@/api/client'
import { buildCategoryTree } from '@/lib/categories'
import { cn } from '@/lib/utils'
import type { CategoryTreeNode } from '@/types'

export type CategoryRoute = 'books' | 'fonts' | 'music' | 'videos' | 'images'

/** 分类树下拉选择面板：点选节点回填完整路径，搜索框可过滤；手动输入由外层输入框负责，两者互不影响 */
export function CategoryTreePicker({
  route,
  selected,
  onPick,
  onClose,
}: {
  route: CategoryRoute
  selected?: string | null
  onPick: (fullPath: string) => void
  onClose: () => void
}) {
  const [searchKey, setSearchKey] = useState('')
  // 初始展开选中值所在的各级祖先（如 a/b/c → 展开 a、a/b），之后由用户自行控制
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => {
    const parts = (selected ?? '').split('/').map((s) => s.trim()).filter(Boolean)
    return new Set(parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/')))
  })

  const { data, isLoading } = useQuery({
    queryKey: ['categories', route],
    queryFn: () => api.categories(route),
  })

  const tree = useMemo(() => buildCategoryTree(data?.categories ?? []), [data])

  const toggleExpand = (fullPath: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setExpandedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(fullPath)) next.delete(fullPath)
      else next.add(fullPath)
      return next
    })
  }

  // 递归匹配搜索（名称或完整路径命中，或任一子节点命中）
  const filterNode = (node: CategoryTreeNode, key: string): boolean => {
    if (!key) return true
    if (node.name.toLowerCase().includes(key) || node.fullPath.toLowerCase().includes(key)) return true
    return node.children.some((c) => filterNode(c, key))
  }

  const renderNode = (node: CategoryTreeNode) => {
    const key = searchKey.trim().toLowerCase()
    const isFiltered = key !== ''
    if (isFiltered && !filterNode(node, key)) return null

    const hasChildren = node.children.length > 0
    // 搜索时默认展开，否则按 expandedKeys，顶层默认展开
    const isExpanded = isFiltered || expandedKeys.has(node.fullPath) || node.depth === 0
    const isSelected = (selected ?? '') === node.fullPath

    return (
      <div key={node.fullPath} className="select-none">
        <div
          onClick={() => onPick(node.fullPath)}
          style={{ paddingLeft: `${node.depth * 12 + 6}px` }}
          className={cn(
            'group flex h-7 items-center gap-1 pr-2 rounded-md text-xs cursor-pointer transition-colors',
            isSelected
              ? 'bg-brand-50 text-brand-700 font-semibold'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
          )}
        >
          {hasChildren ? (
            <button
              type="button"
              onClick={(e) => toggleExpand(node.fullPath, e)}
              className="grid h-4 w-4 shrink-0 place-items-center rounded hover:bg-slate-300/50 text-slate-400 hover:text-slate-700 transition-colors"
            >
              {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            </button>
          ) : (
            <span className="w-4 shrink-0" />
          )}
          {hasChildren && isExpanded ? (
            <FolderOpen className={cn('h-3.5 w-3.5 shrink-0', isSelected ? 'text-brand-600' : 'text-amber-500/80')} />
          ) : (
            <Folder className={cn('h-3.5 w-3.5 shrink-0', isSelected ? 'text-brand-600' : 'text-slate-400')} />
          )}
          <span className="truncate flex-1" title={node.fullPath}>
            {node.name}
          </span>
          <span
            className={cn(
              'ml-auto shrink-0 text-[10px] px-1.5 rounded-full tabular-nums',
              isSelected ? 'bg-brand-200/60 text-brand-800' : 'text-slate-400 group-hover:bg-slate-200 group-hover:text-slate-600',
            )}
          >
            {node.totalCount}
          </span>
        </div>
        {hasChildren && isExpanded && <div>{node.children.map(renderNode)}</div>}
      </div>
    )
  }

  const hasAnyCategory = (data?.categories ?? []).length > 0
  const filterKey = searchKey.trim().toLowerCase()
  const noMatch = filterKey !== '' && !tree.some((n) => filterNode(n, filterKey))

  return (
    <>
      {/* 透明遮罩：点击面板以外区域关闭 */}
      <div className="fixed inset-0 z-10" onClick={onClose} />
      <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-lg border border-slate-200 bg-white shadow-lg">
        <div className="relative border-b border-slate-100 p-2">
          <Search className="absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={searchKey}
            onChange={(e) => setSearchKey(e.target.value)}
            placeholder="搜索分类…"
            className="w-full rounded-md border border-slate-200 bg-white pl-7 pr-6 py-1 text-xs outline-none transition focus:border-brand-500 placeholder:text-slate-400"
          />
          {searchKey && (
            <button
              type="button"
              onClick={() => setSearchKey('')}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
        <div className="max-h-56 overflow-y-auto p-1.5">
          {isLoading ? (
            <div className="py-5 text-center text-xs text-slate-400 animate-pulse">加载分类中…</div>
          ) : !hasAnyCategory ? (
            <div className="flex items-center gap-1.5 py-5 justify-center text-xs text-slate-400">
              <FolderTree className="h-3.5 w-3.5" />
              <span>暂无分类，可直接在上方输入新建</span>
            </div>
          ) : noMatch ? (
            <div className="py-5 text-center text-xs text-slate-400">未找到匹配的分类</div>
          ) : (
            <div className="space-y-0.5">{tree.map(renderNode)}</div>
          )}
        </div>
      </div>
    </>
  )
}
