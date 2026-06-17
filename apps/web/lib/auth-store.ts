import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import Cookies from 'js-cookie';
import api from './api';

interface AuthUser {
  id: string;
  email: string;
  username: string;
  role: string;
  avatarUrl?: string;
}

interface AuthState {
  user: AuthUser | null;
  isLoading: boolean;

  // Actions
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  fetchMe: () => Promise<void>;
}

const COOKIE_OPTS = {
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      isLoading: false,

      login: async (email, password) => {
        set({ isLoading: true });
        try {
          const { data } = await api.post('/v1/auth/login', { email, password });
          Cookies.set('access_token', data.accessToken, {
            ...COOKIE_OPTS,
            expires: 1 / 96, // 15 minutes
          });
          Cookies.set('refresh_token', data.refreshToken, {
            ...COOKIE_OPTS,
            expires: 7,
          });
          set({ user: data.user });
        } finally {
          set({ isLoading: false });
        }
      },

      register: async (email, username, password) => {
        set({ isLoading: true });
        try {
          const { data } = await api.post('/v1/auth/register', {
            email,
            username,
            password,
          });
          Cookies.set('access_token', data.accessToken, {
            ...COOKIE_OPTS,
            expires: 1 / 96,
          });
          Cookies.set('refresh_token', data.refreshToken, {
            ...COOKIE_OPTS,
            expires: 7,
          });
          set({ user: data.user });
        } finally {
          set({ isLoading: false });
        }
      },

      logout: async () => {
        const refreshToken = Cookies.get('refresh_token');
        try {
          if (refreshToken) {
            await api.post('/v1/auth/logout', { refreshToken });
          }
        } catch {
          // Ignore errors during logout.
        } finally {
          Cookies.remove('access_token');
          Cookies.remove('refresh_token');
          set({ user: null });
        }
      },

      fetchMe: async () => {
        try {
          const { data } = await api.get('/v1/auth/me');
          set({ user: data });
        } catch {
          set({ user: null });
        }
      },
    }),
    {
      name: 'skillforge-auth',
      // Only persist user info — tokens live in cookies.
      partialize: (state) => ({ user: state.user }),
    },
  ),
);
