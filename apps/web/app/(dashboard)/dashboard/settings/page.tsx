'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Settings, User, Palette, Bell, Shield, Loader2, Check, LogOut,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { useThemeStore, AccentColor, ACCENT_VARS } from '@/lib/theme-store';
import toast from 'react-hot-toast';

const ACCENT_OPTIONS: { value: AccentColor; label: string; hsl: string }[] = [
  { value: 'violet',  label: 'Violet',  hsl: '247 80% 68%' },
  { value: 'cyan',    label: 'Cyan',    hsl: '189 94% 55%' },
  { value: 'emerald', label: 'Emerald', hsl: '152 76% 50%' },
  { value: 'rose',    label: 'Rose',    hsl: '350 89% 65%' },
  { value: 'amber',   label: 'Amber',   hsl: '38 92% 58%'  },
  { value: 'blue',    label: 'Blue',    hsl: '217 91% 65%' },
];

export default function SettingsPage() {
  const router = useRouter();
  const { user, logout } = useAuthStore();
  const { accent, setAccent } = useThemeStore();

  const [username, setUsername] = useState(user?.username ?? '');
  const [bio, setBio] = useState('');

  const handleLogout = async () => {
    await logout();
    toast.success('Logged out');
    router.push('/');
  };

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Settings className="w-6 h-6 text-muted-foreground" /> Settings
        </h1>
        <p className="text-muted-foreground text-sm mt-1">Manage your account and preferences.</p>
      </div>

      <div className="space-y-6">
        {/* ── Profile ────────────────────────────────────── */}
        <section className="glass rounded-2xl p-6 space-y-5">
          <h2 className="font-semibold flex items-center gap-2">
            <User className="w-4 h-4 text-brand-400" /> Profile
          </h2>

          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/30 to-purple-500/30 border border-primary/20 flex items-center justify-center text-2xl font-bold">
              {user?.username?.[0]?.toUpperCase()}
            </div>
            <div>
              <p className="font-semibold">{user?.username}</p>
              <p className="text-sm text-muted-foreground">{user?.email}</p>
              <span className="badge-muted mt-1 inline-block">{user?.role}</span>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium mb-1.5 block">Username</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="input-field"
              placeholder="Your username"
            />
          </div>

          <div>
            <label className="text-sm font-medium mb-1.5 block">Bio</label>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={3}
              className="input-field resize-none"
              placeholder="Tell the world about yourself…"
            />
          </div>

          <button className="btn-primary">
            Save Profile
          </button>
        </section>

        {/* ── Appearance ─────────────────────────────────── */}
        <section className="glass rounded-2xl p-6 space-y-5">
          <h2 className="font-semibold flex items-center gap-2">
            <Palette className="w-4 h-4 text-purple-400" /> Appearance
          </h2>

          <div>
            <p className="text-sm font-medium mb-3">Accent Color</p>
            <div className="flex items-center gap-3 flex-wrap">
              {ACCENT_OPTIONS.map((opt) => {
                const active = accent === opt.value;
                return (
                  <button
                    key={opt.value}
                    onClick={() => setAccent(opt.value)}
                    title={opt.label}
                    className={`relative w-9 h-9 rounded-full transition-all duration-200 ${
                      active ? 'ring-2 ring-offset-2 ring-offset-background scale-110' : 'hover:scale-105 opacity-80 hover:opacity-100'
                    }`}
                    style={{
                      backgroundColor: `hsl(${opt.hsl})`,
                      ringColor: `hsl(${opt.hsl})`,
                    }}
                  >
                    {active && (
                      <Check className="w-4 h-4 text-white absolute inset-0 m-auto drop-shadow" />
                    )}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              Currently: <span className="text-foreground font-medium capitalize">{accent}</span> — changes apply globally and are saved automatically.
            </p>
          </div>
        </section>

        {/* ── Danger zone ────────────────────────────────── */}
        <section className="glass rounded-2xl p-6 space-y-4 border border-red-500/15">
          <h2 className="font-semibold flex items-center gap-2 text-red-400">
            <Shield className="w-4 h-4" /> Danger Zone
          </h2>
          <button
            onClick={handleLogout}
            className="btn-ghost text-red-400 hover:text-red-300 hover:bg-red-500/10 w-full justify-start"
          >
            <LogOut className="w-4 h-4" /> Sign out of all devices
          </button>
        </section>
      </div>
    </div>
  );
}
