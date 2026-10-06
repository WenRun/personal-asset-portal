import { useEffect, useState } from 'react'

export type FontFaceState = 'loading' | 'ready' | 'error'

/** FontFace 真实加载（详细设计 §5.1）：同一 id 的字体文件注册为全局字体族 portal-{id}。 */
export function useFontFace(id: string, fileUrl: string, enabled = true) {
  const [state, setState] = useState<FontFaceState>('loading')
  const family = `portal-${id}`

  useEffect(() => {
    if (!enabled) return
    let face: FontFace | undefined
    setState('loading')
    try {
      face = new FontFace(family, `url(${fileUrl})`)
      face
        .load()
        .then((loaded) => {
          document.fonts.add(loaded)
          setState('ready')
        })
        .catch(() => setState('error'))
    } catch {
      setState('error')
    }
    return () => {
      if (face) {
        try { document.fonts.delete(face) } catch { /* noop */ }
      }
    }
  }, [family, fileUrl, enabled])

  return { family, state }
}
