import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Heart, Pause, Play } from 'lucide-react'
import { api } from '@/api/client'
import { usePlayer } from '@/stores/player'
import { BackLink, Badge, Button, EqBars, HueCover } from '@/components/ui'
import { fmtTime } from '@/lib/utils'

export function AlbumDetailPage() {
  const { id } = useParams()
  const { data: album } = useQuery({ queryKey: ['album', id], queryFn: () => api.album(id!), enabled: !!id })
  const { queue, index, playing, albumId: curAlbumId, playAlbum, toggle } = usePlayer()
  const [coverFail, setCoverFail] = useState(false)

  if (!album) return <div className="p-6 text-slate-400">加载中…</div>

  const activeIdx = curAlbumId === album.id ? index : -1
  const totalSec = album.tracks.reduce((s, t) => s + t.durationSec, 0)

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-6">
      <BackLink to="/music">专辑墙</BackLink>

      <div className="mt-4 flex flex-col gap-6 md:flex-row">
        {coverFail ? (
          <HueCover hue={album.hue} className="aspect-square w-44 shrink-0 rounded-xl shadow-lg" />
        ) : (
          <img
            src={api.musicAlbumCoverUrl(album.id, 1024)}
            alt={album.title}
            className="aspect-square w-44 shrink-0 rounded-xl object-cover shadow-lg"
            onError={() => setCoverFail(true)}
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="mb-1 text-[10px] font-semibold text-brand-600">专辑</div>
          <h1 className="text-2xl font-bold">{album.title}</h1>
          <div className="mt-1 text-sm text-slate-500">{album.artist || "未知艺术家"} · {album.year} · {album.genre || "音频"}</div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
            <Badge>{album.format}</Badge>
            <Badge>{album.tracks.length} 首 · {fmtTime(totalSec)}</Badge>
            <Badge>{(album.tracks.reduce((s, t) => s + t.bitrateK, 0) / 1000).toFixed(1)}Mbps 均值</Badge>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {album.tracks.length > 0 && <Button onClick={() => playAlbum(album)}><Play className="h-4 w-4" fill="currentColor" />播放全部</Button>}
            <Button variant="outline">下载整专辑 (.zip)</Button>
            <Button variant="outline">♥ 收藏</Button>
            <Button variant="outline">编辑</Button>
          </div>
        </div>
      </div>

      <div className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-400">
            <tr>
              <th className="w-10 px-4 py-2 text-left font-medium">#</th>
              <th className="px-2 py-2 text-left font-medium">标题</th>
              <th className="w-16 px-2 py-2 text-left font-medium">歌词</th>
              <th className="w-16 px-2 py-2 text-left font-medium">码率</th>
              <th className="w-16 px-2 py-2 text-left font-medium">时长</th>
              <th className="w-12 px-2 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {album.tracks.map((t, i) => {
              const active = i === activeIdx
              return (
                <tr
                  key={t.id}
                  className={`cursor-pointer transition ${active ? 'bg-brand-50' : 'hover:bg-slate-50'}`}
                  onClick={() => playAlbum(album, t.no)}
                >
                  <td className="px-4 py-2.5">
                    {active && playing
                      ? <EqBars />
                      : <span className={active ? 'font-bold text-brand-600' : 'text-slate-400'}>{t.no}</span>}
                  </td>
                  <td className={`px-2 py-2.5 font-medium ${active ? 'text-brand-700' : ''}`}>
                    {t.title}
                    {active && !playing && <span className="ml-2 text-xs text-slate-400">（已暂停）</span>}
                  </td>
                  <td className="px-2 py-2.5">{t.lrc ? <Badge tone="green">LRC</Badge> : <span className="text-slate-300">—</span>}</td>
                  <td className="px-2 py-2.5 font-mono text-xs text-slate-400">{t.bitrateK}k</td>
                  <td className="px-2 py-2.5 font-mono text-slate-400">{fmtTime(t.durationSec)}</td>
                  <td className="px-2 py-2.5">
                    {active && playing
                      ? <button onClick={(e) => { e.stopPropagation(); toggle() }}><Pause className="h-4 w-4 text-brand-600" /></button>
                      : <span className="text-slate-300 group-hover:text-slate-400"><Heart className="h-4 w-4" /></span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {album.tracks.length === 0 && (
          <div className="border-t border-slate-100 p-6 text-center text-xs text-slate-400">
            M0 为文件级资产：曲目/艺术家标签解析随 M4 音乐模块接入，届时可在此在线播放
          </div>
        )}
      </div>

      {album.note && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 text-sm">
          <div className="mb-1.5 text-xs font-semibold text-slate-400">备注</div>
          <p className="leading-relaxed text-slate-600">{album.note}</p>
        </div>
      )}
      {queue.length > 0 && curAlbumId === album.id && (
        <div className="mt-3 text-center text-xs text-slate-400">
          正在通过底部播放条播放本专辑（/api/music/{id}/stream 真实音频流）· 点曲目行切换
        </div>
      )}
    </div>
  )
}
