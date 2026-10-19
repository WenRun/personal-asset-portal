import { useEffect, useState } from 'react'
import { Heart } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import { cn } from '@/lib/utils'

/**
 * 收藏切换心形按钮：点击即乐观翻转，PATCH /api/assets/{id} 持久化，
 * 失败自动回滚；成功后失效「我的收藏」缓存保持跨页一致。
 */
export function FavoriteButton({
  assetId,
  favorite,
  withLabel = false,
  className,
  iconClassName,
}: {
  assetId: string
  /** 受控初值：随详情/列表数据刷新自动同步回真实状态 */
  favorite: boolean
  /** 显示「收藏 / 已收藏」文字（详情页头部按钮组用） */
  withLabel?: boolean
  className?: string
  iconClassName?: string
}) {
  const qc = useQueryClient()
  const [fav, setFav] = useState(favorite)
  const [saving, setSaving] = useState(false)
  useEffect(() => setFav(favorite), [assetId, favorite])

  const toggle = async () => {
    if (saving) return
    const next = !fav
    setFav(next)
    setSaving(true)
    try {
      await api.patchAsset(assetId, { is_favorite: next })
      void qc.invalidateQueries({ queryKey: ['favorites'] })
    } catch (e) {
      console.error('保存收藏失败', e)
      setFav(!next)
    } finally {
      setSaving(false)
    }
  }

  return (
    <button
      type="button"
      disabled={saving}
      onClick={() => void toggle()}
      title={fav ? '取消收藏' : '加入收藏'}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 transition disabled:cursor-not-allowed disabled:opacity-60',
        fav ? 'text-rose-500' : 'text-slate-400 hover:text-rose-400',
        className,
      )}
    >
      <Heart className={cn('h-4 w-4', iconClassName)} fill={fav ? 'currentColor' : 'none'} />
      {withLabel && <span>{fav ? '已收藏' : '收藏'}</span>}
    </button>
  )
}
