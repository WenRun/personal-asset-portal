import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { User } from '@/types'

interface AuthState {
  user: User | null
  login: (username: string, password: string) => Promise<User>
  register: (username: string, password: string) => Promise<User>
  logout: () => void
}

/** Mock 鉴权（独立函数，避免循环引用）；M0 后端就绪后替换为 POST /api/auth/login|register */
async function authenticate(username: string, password: string): Promise<User> {
  await new Promise((r) => setTimeout(r, 350))
  if (!username.trim() || !password) throw new Error('用户名或密码不能为空')
  if (password.length < 4) throw new Error('密码至少 4 位（mock 校验）')
  return {
    id: `u_${username.trim().toLowerCase()}`,
    username: username.trim(),
    role: username.trim().toLowerCase() === 'admin' ? 'admin' : 'member',
  }
}

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      login: async (username, password) => {
        const user = await authenticate(username, password)
        set({ user })
        return user
      },
      register: async (username, password) => {
        const user = await authenticate(username, password)
        set({ user })
        return user
      },
      logout: () => set({ user: null }),
    }),
    { name: 'portal-auth' },
  ),
)
