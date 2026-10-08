import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Star, X } from 'lucide-react'
import { api } from '@/api/client'
import { Button, Input, Modal } from '@/components/ui'
import { cn } from '@/lib/utils'

/** 资产信息编辑弹层（admin 可用，支持标题、备注、标签与评分修改） */
export function EditAssetDialog({
  assetId,
  initialTitle,
  initialNote = '',
  initialTags = [],
  initialRating = 0,
  open,
  onClose,
  onSuccess,
}: {
  assetId: string
  initialTitle: string
  initialNote?: string
  initialTags?: string[]
  initialRating?: number
  open: boolean
  onClose: () => void
  onSuccess?: () => void
}) {
  const qc = useQueryClient()
  const [title, setTitle] = useState(initialTitle)
  const [note, setNote] = useState(initialNote)
  const [tags, setTags] = useState<string[]>(initialTags)
  const [rating, setRating] = useState(initialRating)
  const [hoverRating, setHoverRating] = useState(0)
  const [tagInput, setTagInput] = useState('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // 当弹窗打开时，根据传入的初始值重置表单状态
  useEffect(() => {
    if (open) {
      setTitle(initialTitle || '')
      setNote(initialNote || '')
      setTags([...(initialTags || [])])
      setRating(initialRating || 0)
      setHoverRating(0)
      setTagInput('')
      setErrorMsg(null)
    }
  }, [open, initialTitle, initialNote, initialTags, initialRating])

  // 获取已有标签供快速点选补充
  const { data: allTags } = useQuery({
    queryKey: ['tags'],
    queryFn: api.tags,
    enabled: open,
  })

  // 添加标签
  const handleAddTag = (rawName?: string) => {
    const name = (rawName ?? tagInput).trim()
    if (!name) return
    if (!tags.includes(name)) {
      setTags([...tags, name])
    }
    setTagInput('')
  }

  // 移除标签
  const handleRemoveTag = (tagName: string) => {
    setTags(tags.filter((t) => t !== tagName))
  }

  // 提交保存变更
  const saveMutation = useMutation({
    mutationFn: () => {
      const cleanTitle = title.trim()
      if (!cleanTitle) {
        throw new Error('标题不能为空')
      }
      return api.patchAsset(assetId, {
        title: cleanTitle,
        note: note.trim(),
        tags,
        rating,
      })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['video', assetId] })
      void qc.invalidateQueries({ queryKey: ['videos'] })
      void qc.invalidateQueries({ queryKey: ['tags'] })
      onSuccess?.()
      onClose()
    },
    onError: (err: Error) => {
      setErrorMsg(err.message || '保存失败，请重试')
    },
  })

  // 过滤出未选中的常用候选标签（最多展示 8 个）
  const candidateTags = (allTags || [])
    .filter((t) => !tags.includes(t.name))
    .slice(0, 8)

  return (
    <Modal open={open} onClose={onClose} className="w-[520px] max-w-[95vw] p-6 max-h-[90vh] overflow-y-auto">
      {/* 弹窗标题 */}
      <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-3">
        <div className="flex items-center gap-2 font-semibold text-slate-800">
          <Pencil className="h-4 w-4 text-brand-600" />
          <span>编辑资产信息</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-4 text-sm">
        {/* 标题 */}
        <div>
          <div className="mb-1.5 flex items-center justify-between text-xs font-medium text-slate-600">
            <label htmlFor="asset-title">标题 <span className="text-rose-500">*</span></label>
            <span className="text-slate-400">{title.length}/256</span>
          </div>
          <Input
            id="asset-title"
            value={title}
            maxLength={256}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="请输入资产标题"
            className="w-full"
          />
        </div>

        {/* 评分 */}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-600">评分</label>
          <div
            className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2"
            onMouseLeave={() => setHoverRating(0)}
          >
            <div className="flex items-center">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onMouseEnter={() => setHoverRating(star)}
                  onClick={() => setRating(rating === star ? 0 : star)}
                  className="p-1 transition-transform hover:scale-125 focus:outline-none"
                  title={`${star} 星（再次点击可取消）`}
                >
                  <Star
                    className={cn(
                      'h-5 w-5 transition-colors',
                      star <= (hoverRating || rating)
                        ? 'fill-amber-400 text-amber-400'
                        : 'fill-transparent text-slate-300 hover:text-amber-300',
                    )}
                  />
                </button>
              ))}
            </div>
            <span className="text-xs font-medium text-slate-500">
              {rating > 0 ? `${rating} 星` : '未评分'}
            </span>
            {rating > 0 && (
              <button
                type="button"
                onClick={() => setRating(0)}
                className="ml-auto text-xs text-slate-400 hover:text-rose-500 transition"
              >
                清除评分
              </button>
            )}
          </div>
        </div>

        {/* 标签管理 */}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-600">标签</label>
          <div className="rounded-lg border border-slate-200 p-2.5 space-y-2 bg-white">
            {/* 已选标签列表 */}
            <div className="flex flex-wrap items-center gap-1.5 min-h-[28px]">
              {tags.length === 0 ? (
                <span className="text-xs text-slate-400 italic">暂无标签</span>
              ) : (
                tags.map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1 rounded-md bg-brand-50 border border-brand-100 px-2 py-0.5 text-xs text-brand-700"
                  >
                    <span>{t}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveTag(t)}
                      className="rounded hover:bg-brand-200/50 p-0.5 text-brand-500 hover:text-brand-800 transition"
                      title="删除标签"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))
              )}
            </div>

            {/* 输入新标签 */}
            <div className="flex items-center gap-2 pt-1 border-t border-slate-100">
              <Input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleAddTag()
                  }
                }}
                placeholder="输入标签名，按回车添加"
                className="h-8 text-xs flex-1"
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => handleAddTag()}
                disabled={!tagInput.trim()}
                className="h-8 text-xs shrink-0"
              >
                <Plus className="h-3 w-3" />添加
              </Button>
            </div>

            {/* 常用已有标签快速点选 */}
            {candidateTags.length > 0 && (
              <div className="pt-1 flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-[11px] text-slate-400">快速添加：</span>
                {candidateTags.map((t) => (
                  <button
                    key={t.name}
                    type="button"
                    onClick={() => handleAddTag(t.name)}
                    className="inline-flex items-center rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] text-slate-600 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 transition"
                  >
                    + {t.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 备注 / 描述 */}
        <div>
          <label htmlFor="asset-note" className="mb-1.5 block text-xs font-medium text-slate-600">备注 / 简介</label>
          <textarea
            id="asset-note"
            rows={4}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="补充说明、内容梗概或备注信息…"
            className="w-full rounded-lg border border-slate-200 bg-white p-2.5 text-sm outline-none transition placeholder:text-slate-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          />
        </div>

        {/* 错误提示 */}
        {errorMsg && (
          <div className="rounded-lg bg-rose-50 border border-rose-200 p-2.5 text-xs text-rose-600">
            {errorMsg}
          </div>
        )}
      </div>

      {/* 底部按钮栏 */}
      <div className="mt-6 flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
        <Button
          type="button"
          variant="outline"
          onClick={onClose}
          disabled={saveMutation.isPending}
        >
          取消
        </Button>
        <Button
          type="button"
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending || !title.trim()}
        >
          {saveMutation.isPending ? '保存中…' : '保存更改'}
        </Button>
      </div>
    </Modal>
  )
}
