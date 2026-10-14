import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function fmtTime(sec: number) {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function fmtDate(iso: string) {
  return iso.slice(0, 10)
}

/**
 * 复制文本到剪贴板：
 * 兼容 HTTPS、localhost（现代 navigator.clipboard）
 * 以及局域网 HTTP 等非安全上下文（如 http://192.168.31.31:8080，使用 textarea + document.execCommand 兜底）
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  // 1. 优先尝试现代 Clipboard API（仅在 HTTPS 或 localhost 等安全上下文生效）
  if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // 某些浏览器无焦点或非安全上下文虽然有对象但拒绝，继续降级到 execCommand
    }
  }

  // 2. 降级方案：创建临时不可见 textarea 配合 document.execCommand('copy')
  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.top = '0'
    textarea.style.left = '0'
    textarea.style.width = '2em'
    textarea.style.height = '2em'
    textarea.style.padding = '0'
    textarea.style.border = 'none'
    textarea.style.outline = 'none'
    textarea.style.boxShadow = 'none'
    textarea.style.background = 'transparent'
    textarea.style.opacity = '0'
    textarea.style.zIndex = '-9999'
    textarea.setAttribute('readonly', '')
    document.body.appendChild(textarea)

    textarea.focus()
    textarea.select()
    textarea.setSelectionRange(0, textarea.value.length)

    const successful = document.execCommand('copy')
    document.body.removeChild(textarea)
    if (successful) return true
  } catch (err) {
    console.warn('execCommand copy failed:', err)
  }

  // 3. 终极兜底：浏览器弹窗引导用户手动复制
  try {
    window.prompt('请按 Ctrl+C / ⌘+C 复制链接：', text)
    return true
  } catch {
    return false
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 清洗曲目标题与歌手信息：
 * 1. 清洗音轨序号前缀（例如 "01. ", "02 - ", "03、" 等）
 * 2. 若已知歌手，精准剥离标题中前置或后置的歌手名字（如 "稻香 - 周杰伦"、"独角戏 - 许茹芸-"、"周杰伦 - 稻香"）
 * 3. 若歌手未知，启发式拆分 "A - B" 结构，识别纯歌名与歌手
 */
export function cleanTrackTitleAndArtist(
  title?: string | null,
  artist?: string | null,
): { title: string; artist?: string } {
  if (!title) return { title: '', artist: artist || undefined }
  const text = title.trim()

  // 1. 清洗音轨序号前缀
  const withoutNo = text.replace(/^\s*\d{1,3}(?:\s*[-._、．]\s*|\s+)/, '').trim()
  const candidate = withoutNo || text

  // 2. 如果已知 artist，尝试匹配并剥离
  const knownArtist =
    artist &&
    !['未知艺术家', 'unknown artist', 'unknown', '群星', 'various artists'].includes(
      artist.trim().toLowerCase(),
    )
  if (knownArtist) {
    const artClean = artist.trim()
    const artCandidates: string[] = [artClean]
    const parts = artClean.split(/[/&,、]|(?:\s+(?:feat\.?|ft\.?|with|vs\.?)\s+)/i)
    for (const part of parts) {
      const s = part.trim()
      if (s.length >= 2 && !artCandidates.includes(s)) artCandidates.push(s)
    }
    artCandidates.sort((a, b) => b.length - a.length)

    for (const art of artCandidates) {
      const escaped = escapeRegex(art)
      // 2.1 后置歌手: 歌名 - 歌手
      const postReg = new RegExp(`(?:[\\s\\-_—－~·/]+|\\s+)${escaped}[\\s\\-_—－~·]*$`, 'i')
      const postMatch = candidate.match(postReg)
      if (postMatch && postMatch.index !== undefined && postMatch.index > 0) {
        const stripped = candidate.slice(0, postMatch.index).replace(/[\s\-_—－~·]+$/, '').trim()
        if (stripped) return { title: stripped, artist: artClean }
      }

      // 2.2 前置歌手: 歌手 - 歌名
      const preReg = new RegExp(`^[\\s\\-_—－~·]*${escaped}(?:[\\s\\-_—－~·]+|\\s+)`, 'i')
      const preMatch = candidate.match(preReg)
      if (preMatch && preMatch[0]) {
        const stripped = candidate.slice(preMatch[0].length).replace(/^[\s\-_—－~·]+/, '').trim()
        if (stripped) return { title: stripped, artist: artClean }
      }
    }
  }

  // 3. 未知 artist 或未匹配上已知 artist 时，启发式检测 A - B 结构
  const sepMatch = candidate.match(/\s+[-_—－~·]\s+|\s*[-—－]\s*/)
  if (sepMatch && sepMatch.index !== undefined) {
    const partA = candidate.slice(0, sepMatch.index).trim()
    const partB = candidate.slice(sepMatch.index + sepMatch[0].length).replace(/[\s\-_—－~·]+$/, '').trim()
    if (partA && partB) {
      const titleFeatures =
        /[（(].*?(?:主题曲|片尾曲|插曲|电影|电视剧|Remix|Live|伴奏|原声|Cover|翻唱|版)[)）]|《.*?》|\[.*?\]/i
      const hasFeatA = titleFeatures.test(partA)
      const hasFeatB = titleFeatures.test(partB)
      const artistFeatures = /&|feat\.?|ft\.?|与|和/i
      const hasArtA = artistFeatures.test(partA)
      const hasArtB = artistFeatures.test(partB)

      if ((hasFeatA && !hasFeatB) || (hasArtB && !hasArtA)) {
        return { title: partA, artist: knownArtist ? artist : partB }
      }
      if ((hasFeatB && !hasFeatA) || (hasArtA && !hasArtB)) {
        return { title: partB, artist: knownArtist ? artist : partA }
      }
    }
  }

  return { title: candidate, artist: artist || undefined }
}

/**
 * 纯歌名清洗：去除冗余音轨号前缀与前置/后置歌手名。
 */
export function cleanTrackTitle(title?: string | null, artist?: string | null): string {
  return cleanTrackTitleAndArtist(title, artist).title
}
