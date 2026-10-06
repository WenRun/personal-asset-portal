import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { api } from '@/api/client'
import type { User } from '@/types'

interface AuthState {
  user: User | null
  /** 启动时用 cookie 会话校正本地缓存（cookie 失效则回落为访客） */
  hydrate: () => Promise<void>
  login: (username: string, password: string) => Promise<User>
  register: (username: string, password: string) => Promise<User>
  logout: () => Promise<void>
}

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      async hydrate() {
        try {
          set({ user: await api.me() })
        } catch {
          set({ user: null })
        }
      },
      async login(username, password) {
        const user = await api.login(username, password)
        set({ user })
        return user
      },
      async register(username, password) {
        const user = await api.register(username, password)
        set({ user })
        return user
      },
      async logout() {
        try { await api.logout() } catch { /* cookie 可能已失效 */ }
        set({ user: null })
      },
    }),
    { name: 'portal-auth' },
  ),
)
