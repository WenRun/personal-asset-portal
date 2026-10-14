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

/**
 * 清洗曲目标题中的冗余音轨号前缀（例如 "01.歌曲名"、"02 - 歌曲名"、"03、歌曲名" 等）。
 *
 * 安全规则：
 * - 仅匹配 1~3 位数字开头且紧随分隔符（. - _ 、 ． 或带空格）的前缀
 * - 若清洗后为空，则回退保留原样，避免误伤特殊曲目名
 */
export function cleanTrackTitle(title?: string | null): string {
  if (!title) return ''
  const trimmed = title.trim()
  const cleaned = trimmed.replace(/^\s*\d{1,3}(?:\s*[-._、．]\s*|\s+)/, '').trim()
  return cleaned || trimmed
}
