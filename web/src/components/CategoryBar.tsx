import { useQuery } from '@tanstack/react-query'
import { Folder, FolderOpen, Sparkles } from 'lucide-react'
import { api } from '@/api/client'
import { cn } from '@/lib/utils'

export function CategoryBar({
  route,
  selected,
  onSelect,
  className,
}: {
  route: string
  selected?: string
  onSelect: (category: string | undefined) => void
  className?: string
}) {
  const { data } = useQuery({
    queryKey: ['categories', route],
    queryFn: () => api.categories(route),
  })

  const categories = data?.categories ?? []
  const uncategorizedCount = data?.uncategorized ?? 0
  const totalCategorized = categories.reduce((sum, c) => sum + c.count, 0)
  const totalCount = data?.total ?? (totalCategorized + uncategorizedCount)

  // 若该路由下没有任何分类且没有未分类（没有资产），则不展示
  if (categories.length === 0 && uncategorizedCount === 0) {
    return null
  }

  return (
    <div className={cn('flex items-center gap-2 overflow-x-auto py-1 scrollbar-none', className)}>
      <div className="flex items-center gap-1 text-xs font-medium text-slate-400 shrink-0 mr-1">
        <Folder className="h-3.5 w-3.5 text-slate-400" />
        <span>分类：</span>
      </div>

      {/* 全部 */}
      <button
        type="button"
        onClick={() => onSelect(undefined)}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition shrink-0',
          !selected
            ? 'bg-slate-900 text-white shadow-sm'
            : 'bg-slate-100 text-slate-600 hover:bg-slate-200/80',
        )}
      >
        <span>全部</span>
        <span className={cn('text-[11px]', !selected ? 'text-slate-300' : 'text-slate-400')}>
          {totalCount}
        </span>
      </button>

      {/* 未分类专区（醒目提示用户待归类） */}
      {uncategorizedCount > 0 && (
        <button
          type="button"
          onClick={() => onSelect(selected === '__uncategorized__' ? undefined : '__uncategorized__')}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition shrink-0',
            selected === '__uncategorized__'
              ? 'bg-amber-600 text-white shadow-sm ring-2 ring-amber-300'
              : 'bg-amber-50 border border-amber-200/80 text-amber-700 hover:bg-amber-100/80',
          )}
          title="点击查看所有尚未归类的资源，可快捷采纳推荐或批量归类"
        >
          <Sparkles className={cn('h-3 w-3', selected === '__uncategorized__' ? 'text-white' : 'text-amber-500')} />
          <span>待分类</span>
          <span className={cn('rounded-full px-1.5 py-0.2 text-[10px] font-bold', selected === '__uncategorized__' ? 'bg-amber-700 text-amber-100' : 'bg-amber-200/70 text-amber-800')}>
            {uncategorizedCount}
          </span>
        </button>
      )}

      {/* 各实体分类 */}
      {categories.map((c) => {
        const active = selected === c.name
        return (
          <button
            key={c.name}
            type="button"
            onClick={() => onSelect(active ? undefined : c.name)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition shrink-0',
              active
                ? 'bg-brand-600 text-white shadow-sm'
                : 'bg-white border border-slate-200 text-slate-700 hover:border-brand-300 hover:bg-brand-50/50 hover:text-brand-700',
            )}
          >
            {active ? <FolderOpen className="h-3 w-3 text-white" /> : null}
            <span>{c.name}</span>
            <span className={cn('text-[11px]', active ? 'text-brand-100' : 'text-slate-400')}>
              {c.count}
            </span>
          </button>
        )
      })}
    </div>
  )
}
