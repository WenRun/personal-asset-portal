import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Check, Copy, Link2 } from 'lucide-react'
import { api } from '@/api/client'
import { Button, Modal } from '@/components/ui'
import { cn, copyToClipboard } from '@/lib/utils'

/** 分享弹层（从工具箱下沉到各详情页）：生成带过期时间的公开 token 链接，仅 admin 可用。 */
export function ShareDialog({ assetId, assetTitle, open, onClose }: {
  assetId: string
  assetTitle: string
  open: boolean
  onClose: () => void
}) {
  const [days, setDays] = useState(3)
  const [allowDownload, setAllowDownload] = useState(false)
  const [copied, setCopied] = useState(false)
  const [link, setLink] = useState('')

  const create = useMutation({
    mutationFn: () => api.createShare(assetId, days * 24, allowDownload),
    onSuccess: (d) => setLink(`${location.origin}${d.url}`),
  })

  const close = () => { setLink(''); setCopied(false); onClose() }
  const copy = async () => {
    const ok = await copyToClipboard(link)
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <Modal open={open} onClose={close} className="w-[420px] p-6">
      <div className="mb-1 flex items-center gap-2 font-semibold">
        <Link2 className="h-4 w-4 text-brand-600" />分享「{assetTitle}」
      </div>
      <p className="mb-4 text-xs text-slate-400">生成公开链接，访客无需登录即可预览；到期自动失效，可在工具箱 → 分享链接中随时撤销。</p>
      {!link ? (
        <>
          <div className="mb-4 flex items-center gap-2 text-sm">
            <span className="text-slate-400">有效期</span>
            {[1, 3, 7, 30].map((d) => (
              <button
                key={d}
                className={cn(
                  'rounded-full px-3 py-1 text-xs transition',
                  days === d ? 'bg-brand-600 text-white' : 'border border-slate-200 bg-white text-slate-600 hover:border-brand-400',
                )}
                onClick={() => setDays(d)}
              >
                {d} 天
              </button>
            ))}
          </div>
          <label className="mb-5 flex items-center gap-1.5 text-sm text-slate-500">
            <input type="checkbox" className="accent-brand-600" checked={allowDownload} onChange={(e) => setAllowDownload(e.target.checked)} />
            允许下载原文件
          </label>
          <div className="flex gap-2">
            <Button className="flex-1" disabled={create.isPending} onClick={() => create.mutate()}>生成链接</Button>
            <Button variant="outline" onClick={close}>取消</Button>
          </div>
          {create.isError && <div className="mt-2 text-xs text-rose-500">{(create.error as Error).message}</div>}
        </>
      ) : (
        <>
          <div className="mb-4">
            <input
              readOnly
              value={link}
              onClick={(e) => (e.target as HTMLInputElement).select()}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700 outline-none transition focus:border-brand-500 focus:bg-white"
            />
            <div className="mt-1 text-[11px] text-slate-400">点击链接可快速全选复制</div>
          </div>
          <div className="flex gap-2">
            <Button className="flex-1" onClick={copy}>
              {copied ? <><Check className="h-3.5 w-3.5" />已复制</> : <><Copy className="h-3.5 w-3.5" />复制链接</>}
            </Button>
            <Button variant="outline" onClick={close}>完成</Button>
          </div>
        </>
      )}
    </Modal>
  )
}
