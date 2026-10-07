import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Trash2 } from 'lucide-react'
import { api } from '@/api/client'
import { Button, Modal } from '@/components/ui'

/** 资产删除确认弹层（admin，五类详情页共用）：
 *  仅删记录 = 软删（门户内隐藏、搜索移除，数据库可恢复）；
 *  删记录+源文件 = 彻底删除（不可恢复）。成功后跳回对应列表页。 */
export function DeleteAssetDialog({ assetId, assetTitle, listPath, open, onClose }: {
  assetId: string
  assetTitle: string
  listPath: string
  open: boolean
  onClose: () => void
}) {
  const qc = useQueryClient()
  const nav = useNavigate()
  const del = useMutation({
    mutationFn: (opts: { purge: boolean; deleteFile: boolean }) => api.deleteAsset(assetId, opts),
    onSuccess: () => {
      qc.invalidateQueries()
      onClose()
      nav(listPath)
    },
  })

  return (
    <Modal open={open} onClose={onClose} className="w-[420px] p-6">
      <div className="mb-1 flex items-center gap-2 font-semibold">
        <Trash2 className="h-4 w-4 text-rose-500" />删除「{assetTitle}」
      </div>
      <p className="mb-4 text-xs leading-relaxed text-slate-400">
        仅删记录：门户内不再显示、搜索同步移除，记录保留在数据库可恢复；删记录并删源文件：把 data 下的原始文件一并删除，不可恢复。
      </p>
      <div className="space-y-2">
        <Button variant="outline" className="w-full" disabled={del.isPending} onClick={() => del.mutate({ purge: false, deleteFile: false })}>
          仅删除记录（可恢复）
        </Button>
        <Button className="w-full bg-rose-600 hover:bg-rose-700" disabled={del.isPending} onClick={() => del.mutate({ purge: true, deleteFile: true })}>
          删除记录并删除源文件（不可恢复）
        </Button>
        <Button variant="ghost" className="w-full" onClick={onClose}>取消</Button>
      </div>
      {del.isError && <div className="mt-2 text-xs text-rose-500">{(del.error as Error).message}</div>}
    </Modal>
  )
}
