import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Loader2, Upload } from 'lucide-react'
import { api } from '@/api/client'
import { Button } from '@/components/ui'

/** 管理员上传：POST /api/admin/uploads → 与扫描共用同一入库管道（§4.3） */
export function UploadButton() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [msg, setMsg] = useState('')
  const qc = useQueryClient()
  const nav = useNavigate()

  const mut = useMutation({
    mutationFn: async (files: FileList) => {
      const results: { name: string; type?: string; error?: string }[] = []
      for (const f of Array.from(files)) {
        try {
          const asset = await api.upload(f)
          results.push({ name: f.name, type: asset.type })
        } catch (e) {
          results.push({ name: f.name, error: (e as Error).message })
        }
      }
      return results
    },
    onSuccess: (results) => {
      qc.invalidateQueries()
      const ok = results.find((r) => r.type)
      const failed = results.filter((r) => r.error)
      setMsg(failed.length ? `失败 ${failed.length} 个：${failed[0].error}` : '已入库，后台处理中')
      if (ok?.type) nav({ font: '/fonts', music: '/music', video: '/videos', book: '/books', image: '/images' }[ok.type as 'font'] ?? '/')
      setTimeout(() => setMsg(''), 4000)
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
      {msg && <span className="max-w-40 truncate text-xs text-slate-400" title={msg}>{msg}</span>}
    </>
  )
}
