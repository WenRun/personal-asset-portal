import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { AlertCircle, CheckCircle2, ListChecks, Package } from 'lucide-react'
import { api } from '@/api/client'
import { Button } from '@/components/ui'
import { cn } from '@/lib/utils'

/** 批量多选浮动条：把选中资产加入打包队列（异步任务），完成后在 工具箱 → 打包下载 获取。
 *  固定悬于播放条上方；打包成功/失败用固定 toast（与上传一致，错误需手动关）。 */
export function SelectionBar({ ids, onDone, onCancel }: {
  ids: string[]
  onDone: () => void
  onCancel: () => void
}) {
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const pack = useMutation({
    mutationFn: () => api.createPack({ asset_ids: ids }),
    onSuccess: () => {
      setToast({ kind: 'ok', text: `已把 ${ids.length} 个资产加入打包队列，完成后在「工具箱 → 打包下载」获取` })
      onDone()
      setTimeout(() => setToast(null), 8000)
    },
    onError: (e) => setToast({ kind: 'err', text: (e as Error).message === 'Failed to fetch' ? '无法连接服务器' : (e as Error).message }),
  })

  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-30 flex justify-center px-4 md:pl-60">
        <div className="pointer-events-auto flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2.5 shadow-xl">
          <ListChecks className="h-4 w-4 shrink-0 text-brand-600" />
          {ids.length > 0 ? (
            <span className="whitespace-nowrap text-sm">已选 <b className="text-brand-600">{ids.length}</b> 个资产</span>
          ) : (
            <span className="whitespace-nowrap text-sm text-slate-400">点击卡片选择要打包的资产（再点取消选择）</span>
          )}
          <Button size="sm" disabled={ids.length === 0 || pack.isPending} onClick={() => pack.mutate()}>
            <Package className="h-3.5 w-3.5" />{pack.isPending ? '创建中…' : '加入打包'}
          </Button>
          <Button size="sm" variant="outline" onClick={onCancel}>取消</Button>
        </div>
      </div>

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
