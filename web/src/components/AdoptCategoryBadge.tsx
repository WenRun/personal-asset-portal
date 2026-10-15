import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Sparkles } from 'lucide-react'
import { api } from '@/api/client'
import { cn } from '@/lib/utils'

export function AdoptCategoryBadge({
  assetId,
  category,
  suggestedCategory,
  className,
}: {
  assetId: string
  category?: string | null
  suggestedCategory?: string | null
  className?: string
}) {
  const qc = useQueryClient()
  const [adopted, setAdopted] = useState(false)

  const adoptMutation = useMutation({
    mutationFn: () => {
      if (!suggestedCategory) throw new Error('无推荐分类')
      return api.patchAsset(assetId, { category: suggestedCategory })
    },
    onSuccess: () => {
      setAdopted(true)
      void qc.invalidateQueries({ queryKey: ['categories'] })
      void qc.invalidateQueries({ queryKey: ['books'] })
      void qc.invalidateQueries({ queryKey: ['fonts'] })
      void qc.invalidateQueries({ queryKey: ['music'] })
      void qc.invalidateQueries({ queryKey: ['videos'] })
      void qc.invalidateQueries({ queryKey: ['photos'] })
      void qc.invalidateQueries()
    },
  })

  // 如果已有分类，或者没有推荐分类，则不显示采纳提示
  if (category || !suggestedCategory) {
    if (category) {
      return (
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600',
            className,
          )}
        >
          {category}
        </span>
      )
    }
    return null
  }

  if (adopted) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700',
          className,
        )}
      >
        <Check className="h-2.5 w-2.5 text-emerald-600" />
        <span>已归入：{suggestedCategory}</span>
      </span>
    )
  }

  return (
    <span
      className={cn(
        'group/adopt inline-flex items-center gap-1 rounded-md bg-amber-50/90 border border-amber-200/80 px-1.5 py-0.5 text-[10px] text-amber-800 transition',
        className,
      )}
      onClick={(e) => e.stopPropagation()}
    >
      <Sparkles className="h-2.5 w-2.5 shrink-0 text-amber-500" />
      <span className="truncate max-w-[120px]" title={`推荐分类：${suggestedCategory}`}>
        推荐: {suggestedCategory}
      </span>
      <button
        type="button"
        disabled={adoptMutation.isPending}
        onClick={(e) => {
          e.stopPropagation()
          adoptMutation.mutate()
        }}
        className="ml-0.5 rounded bg-amber-600 px-1 py-0.2 text-[9px] font-medium text-white hover:bg-amber-700 transition"
        title="一键采纳此推荐分类"
      >
        {adoptMutation.isPending ? '…' : '采纳'}
      </button>
    </span>
  )
}
