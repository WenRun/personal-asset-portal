import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import { Button, Input, PageHeader } from '@/components/ui'

export function TagsPage() {
  const qc = useQueryClient()
  const { data: tags } = useQuery({ queryKey: ['tags'], queryFn: api.tags })
  const [name, setName] = useState('')
  const [err, setErr] = useState('')

  const create = useMutation({
    mutationFn: () => api.createTag(name.trim()),
    onSuccess: () => { setName(''); setErr(''); void qc.invalidateQueries({ queryKey: ['tags'] }) },
    onError: (e) => setErr((e as Error).message),
  })

  return (
    <div className="p-4 md:p-6">
      <PageHeader title="标签管理" sub="五类资源共用一套层级标签（M0 平铺；层级树/合并随 M6）" />
      <div className="mt-4 flex max-w-md items-center gap-2">
        <Input
          className="flex-1" placeholder="新标签名称，回车创建" value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) create.mutate() }}
        />
        <Button onClick={() => name.trim() && create.mutate()} disabled={create.isPending || !name.trim()}>创建</Button>
      </div>
      {err && <div className="mt-2 text-xs text-rose-600">{err}</div>}

      <div className="mt-5 grid max-w-3xl grid-cols-2 gap-3 md:grid-cols-4">
        {(tags ?? []).map((t) => (
          <div key={t.id} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
            <span className="font-medium">{t.name}</span>
            <span className="font-mono text-xs text-slate-400">{t.count}</span>
          </div>
        ))}
        {(tags ?? []).length === 0 && (
          <div className="col-span-full rounded-xl border border-dashed border-slate-300 p-10 text-center text-slate-400">还没有标签</div>
        )}
      </div>
    </div>
  )
}
