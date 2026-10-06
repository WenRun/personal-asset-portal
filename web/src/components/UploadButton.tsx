import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, CheckCircle2, Loader2, Upload } from 'lucide-react'
import { api } from '@/api/client'
import { Button } from '@/components/ui'
import { cn } from '@/lib/utils'

interface UploadResult { name: string; type?: string; error?: string }

/** 管理员上传：POST /api/admin/uploads → 与扫描共用同一入库管道（§4.3）。
 *  结果用固定 toast 展示（错误显眼不消失，需手动关），成功后延时二次刷新等解析完成。 */
export function UploadButton() {
  const inputRef = useRef<HTMLInputElement>(null)
  const qc = useQueryClient()
  const nav = useNavigate()
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const mut = useMutation({
    mutationFn: async (files: FileList) => {
      const results: UploadResult[] = []
      for (const f of Array.from(files)) {
        try {
          const asset = await api.upload(f)
          results.push({ name: f.name, type: asset.type })
        } catch (e) {
          const msg = (e as Error).message
          results.push({ name: f.name, error: msg === 'Failed to fetch' ? '无法连接服务器' : msg })
        }
      }
      return results
    },
    onSuccess: (results) => {
      qc.invalidateQueries()
      const ok = results.find((r) => r.type)
      const failed = results.filter((r) => r.error)
      if (failed.length) {
        setToast({ kind: 'err', text: `上传失败 ${failed.length} 个：${failed.map((f) => `${f.name}（${f.error}）`).join('、')}` })
        return
      }
      setToast({ kind: 'ok', text: `已入库 ${results.length} 个，后台解析中（标签/封面几秒内完成），稍候刷新可见` })
      if (ok?.type) {
        nav({ font: '/fonts', music: '/music', video: '/videos', book: '/books', image: '/images' }[ok.type as 'font'] ?? '/')
        // 解析是异步的：3s/8s 两次补刷新，让列表尽快出现新资产
        setTimeout(() => qc.invalidateQueries(), 3000)
        setTimeout(() => qc.invalidateQueries(), 8000)
      }
      setTimeout(() => setToast(null), 8000)
    },
  })

  return (
    <>
      <input
        ref={inputRef} type="file" multiple className="hidden"
        onChange={(e) => { if (e.target.files?.length) mut.mutate(e.target.files); e.target.value = '' }}
      />
      <Button onClick={() => inputRef.current?.click()} disabled={mut.isPending}>
        {mut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        {mut.isPending ? '上传中' : '上传'}
      </Button>

      {toast && (
        <div className="fixed right-4 top-20 z-[60] max-w-md">
          <div
            className={cn(
              'flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm shadow-xl',
              toast.kind === 'err' ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700',
            )}
          >
            {toast.kind === 'err'
              ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}
            <span className="min-w-0 break-all">{toast.text}</span>
            <button className="ml-2 shrink-0 opacity-50 hover:opacity-100" onClick={() => setToast(null)}>✕</button>
          </div>
        </div>
      )}
    </>
  )
}
