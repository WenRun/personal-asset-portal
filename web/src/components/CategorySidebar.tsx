import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  FolderTree,
  Layers,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { api } from '@/api/client'
import { buildCategoryTree } from '@/lib/categories'
import type { CategoryTreeNode } from '@/types'

export interface CategorySidebarProps {
  route: 'books' | 'fonts' | 'music' | 'videos' | 'images'
  title?: string
  selected?: string | null
  onSelect: (category: string | undefined) => void
  collapsed?: boolean
  onToggleCollapse?: () => void
  className?: string
}

export function CategorySidebar({
  route,
  title = '资源分类',
  selected,
  onSelect,
  collapsed = false,
  onToggleCollapse,
  className,
}: CategorySidebarProps) {
  const [searchKey, setSearchKey] = useState('')
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => new Set())

  const { data, isLoading } = useQuery({
    queryKey: ['categories', route],
    queryFn: () => api.categories(route),
  })

  const categories = data?.categories ?? []
  const uncategorizedCount = data?.uncategorized ?? 0
  const totalCount = data?.total ?? 0

  // 构造多级树
  const tree = useMemo(() => buildCategoryTree(categories), [categories])

  // 树折叠/展开
  const toggleExpand = (fullPath: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setExpandedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(fullPath)) {
        next.delete(fullPath)
      } else {
        next.add(fullPath)
      }
      return next
    })
  }

  // 递归匹配搜索
  const filterNode = (node: CategoryTreeNode, key: string): boolean => {
    if (!key) return true
    if (node.name.toLowerCase().includes(key) || node.fullPath.toLowerCase().includes(key)) return true
    return node.children.some((c) => filterNode(c, key))
  }

  const renderTreeItem = (node: CategoryTreeNode) => {
    const isFiltered = searchKey.trim() !== ''
    if (isFiltered && !filterNode(node, searchKey.toLowerCase().trim())) {
      return null
    }

    const hasChildren = node.children.length > 0
    // 搜索时默认展开，否则按 expandedKeys 或深度默认展开第 1 层
    const isExpanded = isFiltered || expandedKeys.has(node.fullPath) || node.depth === 0
    const isSelected = selected === node.fullPath

    return (
      <div key={node.fullPath} className="select-none">
        <div
          onClick={() => onSelect(node.fullPath)}
          style={{ paddingLeft: `${node.depth * 14 + 10}px` }}
          className={cn(
            'group flex h-8 items-center gap-1.5 pr-2.5 rounded-lg text-xs cursor-pointer transition-colors',
            isSelected
              ? 'bg-brand-50 text-brand-700 font-semibold'
              : 'text-slate-600 hover:bg-slate-200/50 hover:text-slate-900',
          )}
        >
          {/* 折叠切换箭头 */}
          {hasChildren ? (
            <button
              type="button"
              onClick={(e) => toggleExpand(node.fullPath, e)}
              className="grid h-4 w-4 place-items-center rounded hover:bg-slate-300/50 text-slate-400 hover:text-slate-700 transition-colors"
            >
              {isExpanded ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
            </button>
          ) : (
            <span className="w-4 shrink-0" />
          )}

          {/* 文件夹图标 */}
          {hasChildren ? (
            isExpanded ? (
              <FolderOpen className={cn('h-3.5 w-3.5 shrink-0', isSelected ? 'text-brand-600' : 'text-amber-500/80')} />
            ) : (
              <Folder className={cn('h-3.5 w-3.5 shrink-0', isSelected ? 'text-brand-600' : 'text-amber-500/80')} />
            )
          ) : (
            <Folder className={cn('h-3.5 w-3.5 shrink-0', isSelected ? 'text-brand-600' : 'text-slate-400')} />
          )}

          {/* 分类名称 */}
          <span className="truncate flex-1" title={node.fullPath}>
            {node.name}
          </span>

          {/* 数量角标 */}
          <span
            className={cn(
              'ml-auto text-[10px] px-1.5 py-0.2 rounded-full tabular-nums',
              isSelected
                ? 'bg-brand-200/60 text-brand-800'
                : 'text-slate-400 group-hover:bg-slate-200 group-hover:text-slate-600',
            )}
          >
            {node.totalCount}
          </span>
        </div>

        {/* 渲染子节点 */}
        {hasChildren && isExpanded && (
          <div className="relative">
            {/* 树状连线参考线 */}
            <div
              style={{ left: `${node.depth * 14 + 17}px` }}
              className="absolute top-0 bottom-1 w-px bg-slate-200/70 pointer-events-none"
            />
            {node.children.map(renderTreeItem)}
          </div>
        )}
      </div>
    )
  }

  if (collapsed) {
    return null
  }

  return (
    <aside
      className={cn(
        'w-56 shrink-0 flex flex-col bg-slate-50/80 border-r border-slate-200/80 select-none overflow-hidden transition-all',
        className,
      )}
    >
      {/* 头部标题与折叠按钮 */}
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-slate-200/70 px-3.5">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
          <FolderTree className="h-4 w-4 text-brand-600" />
          <span>{title}</span>
        </div>
        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            title="收起分类栏"
            className="grid h-6 w-6 place-items-center rounded text-slate-400 hover:bg-slate-200/60 hover:text-slate-600 transition"
          >
            <PanelLeftClose className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* 快速搜索栏（分类数量大于 5 时显示） */}
      {categories.length > 5 && (
        <div className="p-2 border-b border-slate-200/50">
          <div className="relative">
            <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={searchKey}
              onChange={(e) => setSearchKey(e.target.value)}
              placeholder="搜索分类…"
              className="w-full rounded-md bg-white border border-slate-200 pl-7 pr-6 py-1 text-xs outline-none transition focus:border-brand-500 placeholder:text-slate-400"
            />
            {searchKey && (
              <button
                type="button"
                onClick={() => setSearchKey('')}
                className="absolute right-2 top-2 text-slate-400 hover:text-slate-600"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* 滚动菜单区 */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {/* 全部资源 */}
        <div
          onClick={() => onSelect(undefined)}
          className={cn(
            'group flex h-8 items-center gap-2 px-2.5 rounded-lg text-xs cursor-pointer transition-colors',
            !selected
              ? 'bg-brand-50 text-brand-700 font-semibold'
              : 'text-slate-700 hover:bg-slate-200/50',
          )}
        >
          <Layers className={cn('h-3.5 w-3.5 shrink-0', !selected ? 'text-brand-600' : 'text-slate-400')} />
          <span className="truncate flex-1">全部资源</span>
          <span
            className={cn(
              'ml-auto text-[10px] px-1.5 py-0.2 rounded-full tabular-nums',
              !selected ? 'bg-brand-200/60 text-brand-800' : 'text-slate-400',
            )}
          >
            {totalCount}
          </span>
        </div>

        {/* 待归类专区 */}
        <div
          onClick={() => onSelect('__uncategorized__')}
          className={cn(
            'group flex h-8 items-center gap-2 px-2.5 rounded-lg text-xs cursor-pointer transition-colors',
            selected === '__uncategorized__'
              ? 'bg-amber-100/70 text-amber-900 font-semibold'
              : 'text-slate-700 hover:bg-slate-200/50',
          )}
        >
          <AlertCircle
            className={cn(
              'h-3.5 w-3.5 shrink-0',
              uncategorizedCount > 0 ? 'text-amber-500' : 'text-slate-400',
            )}
          />
          <span className="truncate flex-1">待归类</span>
          {uncategorizedCount > 0 && (
            <span className="ml-auto text-[10px] px-1.5 py-0.2 rounded-full font-medium bg-amber-200 text-amber-800 tabular-nums">
              {uncategorizedCount}
            </span>
          )}
        </div>

        {/* 分割线 */}
        <div className="my-1.5 border-t border-slate-200/60 mx-1" />

        {/* 分类多级树 */}
        {isLoading ? (
          <div className="py-6 text-center text-xs text-slate-400 animate-pulse">加载分类中…</div>
        ) : tree.length === 0 ? (
          <div className="py-6 text-center text-xs text-slate-400">暂无层级分类</div>
        ) : (
          <div className="space-y-0.5">{tree.map(renderTreeItem)}</div>
        )}
      </div>
    </aside>
  )
}

export function CategorySidebarToggle({
  collapsed,
  onToggle,
  title = '分类栏',
}: {
  collapsed: boolean
  onToggle: () => void
  title?: string
}) {
  if (!collapsed) return null
  return (
    <button
      type="button"
      onClick={onToggle}
      title="展开分类栏"
      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:border-brand-300 hover:text-brand-600 shadow-sm transition"
    >
      <PanelLeftOpen className="h-3.5 w-3.5 text-slate-500" />
      <span>{title}</span>
    </button>
  )
}
