import { useEffect, useRef } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import type { Paged } from '@/api/client'
import { cn } from '@/lib/utils'

/** 游标分页列表查询：五类资源首页滚动加载共用（后端 /api/{books,videos,images,fonts} 的 next_cursor）。 */
export function useInfiniteList<T>(key: unknown[], fetcher: (cursor?: string) => Promise<Paged<T>>) {
  return useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) => fetcher(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })
}

/** 底部哨兵元素 ref：滚近视口（提前 600px）触发回调；reloadKey 变化后重新武装——
 *  追加一页后哨兵若仍在可视区内会立即再触发，直到内容把它顶出视口。
 *  enabled 在拉取中应置 false，避免同页重复请求。 */
export function useSentinel(onHit: () => void, enabled: boolean, reloadKey?: unknown) {
  const ref = useRef<HTMLDivElement>(null)
  const hit = useRef(onHit)
  hit.current = onHit
  useEffect(() => {
    const el = ref.current
    if (!el || !enabled) return
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) hit.current() }, { rootMargin: '600px' })
    io.observe(el)
    return () => io.disconnect()
  }, [enabled, reloadKey])
  return ref
}

/** 列表底部状态条（兼任哨兵挂载点）：拉取中显示加载中；到底后显示总数。 */
export function InfiniteFooter({ sentinelRef, loading, hasMore, loaded, unit, className }: {
  sentinelRef: React.RefObject<HTMLDivElement>
  loading: boolean
  hasMore: boolean
  loaded: number
  unit: string
  className?: string
}) {
  if (loaded === 0 && !loading && !hasMore) return null
  return (
    <div ref={sentinelRef} className={cn('mt-6 text-center text-xs text-slate-400', className)}>
      {loading ? '加载中…' : hasMore ? '继续滚动加载更多…' : `已全部加载 · 共 ${loaded} ${unit}`}
    </div>
  )
}
