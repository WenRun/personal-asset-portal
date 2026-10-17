import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, CheckCircle2, Folder, ListChecks, Package, Sparkles, X } from 'lucide-react'
import { api } from '@/api/client'
import { Button, Input, Modal } from '@/components/ui'
import { cn } from '@/lib/utils'

/** 批量多选浮动条：把选中资产加入打包队列或批量设置/采纳分类。
 *  固定悬于播放条上方；操作反馈使用固定 toast。 */
export function SelectionBar({
  ids,
  categoryRoute,
  onDone,
  onCancel,
}: {
  ids: string[]
  categoryRoute?: string
  onDone: () => void
  onCancel: () => void
}) {
  const qc = useQueryClient()
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [catModalOpen, setCatModalOpen] = useState(false)
  const [categoryInput, setCategoryInput] = useState('')

  // 获取该路由下的现有分类供快速点选
  const { data: catData } = useQuery({
    queryKey: ['categories', categoryRoute],
    queryFn: () => (categoryRoute ? api.categories(categoryRoute) : Promise.resolve(null)),
    enabled: catModalOpen && !!categoryRoute,
  })

  // 加入打包队列
  const pack = useMutation({
    mutationFn: () => api.createPack({ asset_ids: ids }),
    onSuccess: () => {
      setToast({ kind: 'ok', text: `已把 ${ids.length} 个资产加入打包队列，完成后在「工具箱 → 打包下载」获取` })
      onDone()
      setTimeout(() => setToast(null), 8000)
    },
    onError: (e) => setToast({ kind: 'err', text: (e as Error).message === 'Failed to fetch' ? '无法连接服务器' : (e as Error).message }),
  })

  // 批量分类修改（指定分类或一键采纳推荐分类）
  const batchCatMutation = useMutation({
    mutationFn: (params: { category?: string | null; adoptSuggested?: boolean }) =>
      api.batchCategory(ids, params.category, params.adoptSuggested),
    onSuccess: (res, vars) => {
      void qc.invalidateQueries({ queryKey: ['categories'] })
      void qc.invalidateQueries({ queryKey: ['books'] })
      void qc.invalidateQueries({ queryKey: ['fonts'] })
      void qc.invalidateQueries({ queryKey: ['music'] })
      void qc.invalidateQueries({ queryKey: ['videos'] })
      void qc.invalidateQueries({ queryKey: ['photos'] })
      void qc.invalidateQueries()

      const desc = vars.adoptSuggested
        ? `已自动按智能推荐分类归纳 ${res.updated} 个资产`
        : vars.category
          ? `已成功将 ${res.updated} 个资产归入分类「${vars.category}」`
          : `已清空 ${res.updated} 个资产的分类`
      setToast({ kind: 'ok', text: desc })
      setCatModalOpen(false)
      onDone()
      setTimeout(() => setToast(null), 8000)
    },
    onError: (e) => setToast({ kind: 'err', text: (e as Error).message || '批量分类失败' }),
  })

  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-30 flex justify-center px-4 md:pl-60">
        <div className="pointer-events-auto flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 shadow-xl">
          <ListChecks className="h-4 w-4 shrink-0 text-brand-600" />
          {ids.length > 0 ? (
            <span className="whitespace-nowrap text-sm">已选 <b className="text-brand-600">{ids.length}</b> 个资产</span>
          ) : (
            <span className="whitespace-nowrap text-sm text-slate-400">点击卡片选择要操作的资产</span>
          )}

          {/* 批量设置分类按钮 */}
          <Button
            size="sm"
            variant="outline"
            disabled={ids.length === 0}
            onClick={() => {
              setCategoryInput('')
              setCatModalOpen(true)
            }}
            className="flex items-center gap-1.5"
          >
            <Folder className="h-3.5 w-3.5 text-brand-600" />
            <span>设置分类</span>
          </Button>

          {/* 打包下载 */}
          <Button size="sm" disabled={ids.length === 0 || pack.isPending} onClick={() => pack.mutate()}>
            <Package className="h-3.5 w-3.5" />{pack.isPending ? '创建中…' : '加入打包'}
          </Button>
          <Button size="sm" variant="outline" onClick={onCancel}>取消</Button>
        </div>
      </div>

      {/* 批量分类弹窗 */}
      <Modal open={catModalOpen} onClose={() => setCatModalOpen(false)} className="w-[480px] max-w-[95vw] p-6">
        <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2 font-semibold text-slate-800">
            <Folder className="h-4 w-4 text-brand-600" />
            <span>批量设置分类（已选 {ids.length} 项）</span>
          </div>
          <button
            type="button"
            onClick={() => setCatModalOpen(false)}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 text-sm">
          {/* 推荐分类一键采纳卡片 */}
          <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3.5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-1.5 font-medium text-amber-900">
                  <Sparkles className="h-4 w-4 text-amber-500" />
                  <span>智能推荐一键采纳</span>
                </div>
                <p className="mt-1 text-xs text-amber-700">
                  为已选资产自动采纳各自解析出的推荐分类（书籍学科、音乐流派、字体风格等），无需逐一选择。
                </p>
              </div>
              <Button
                size="sm"
                className="shrink-0 bg-amber-600 hover:bg-amber-700 text-white"
                disabled={batchCatMutation.isPending}
                onClick={() => batchCatMutation.mutate({ adoptSuggested: true })}
              >
                采纳推荐
              </Button>
            </div>
          </div>

          {/* 手动指定分类 */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-600">统一归入指定分类：</label>
            <div className="flex items-center gap-2">
              <Input
                value={categoryInput}
                onChange={(e) => setCategoryInput(e.target.value)}
                placeholder="输入分类路径，支持斜杠多级（如：计算机/Python、流行/华语…）"
                className="flex-1 text-xs"
              />
              <Button
                size="sm"
                disabled={!categoryInput.trim() || batchCatMutation.isPending}
                onClick={() => batchCatMutation.mutate({ category: categoryInput.trim() })}
              >
                应用分类
              </Button>
            </div>
          </div>

          {/* 现有分类快速点击 */}
          {catData && catData.categories.length > 0 && (
            <div className="space-y-1.5 pt-1">
              <span className="text-xs text-slate-400">点击快捷填入现有分类：</span>
              <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                {catData.categories.map((c) => (
                  <button
                    key={c.name}
                    type="button"
                    onClick={() => setCategoryInput(c.name)}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-700 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 transition"
                  >
                    <span>{c.name}</span>
                    <span className="text-[10px] text-slate-400">({c.count})</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 清除分类操作 */}
          <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
            <span className="text-xs text-slate-400">或将所选资产重置为未分类：</span>
            <Button
              size="sm"
              variant="outline"
              className="text-xs text-slate-600 hover:text-rose-600 hover:border-rose-200"
              disabled={batchCatMutation.isPending}
              onClick={() => batchCatMutation.mutate({ category: null })}
            >
              清空分类
            </Button>
          </div>
        </div>
      </Modal>

      {toast && (
        <div className="fixed right-4 top-20 z-[60] max-w-md">
          <div
            className={cn(
              'flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm shadow-xl',
              toast.kind === 'err' ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700',
            )}
          >
            {toast.kind === 'err' ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}
            <span className="min-w-0 break-all">{toast.text}</span>
            <button className="ml-2 shrink-0 opacity-50 hover:opacity-100" onClick={() => setToast(null)}>✕</button>
          </div>
        </div>
      )}
    </>
  )
}
