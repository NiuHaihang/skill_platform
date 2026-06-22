'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Zap, Eye, EyeOff, Loader2, AlertCircle } from 'lucide-react';
import { useAuthStore } from '@/lib/auth-store';
import { cn } from '@/lib/utils';

export default function LoginPage() {
  const router = useRouter();
  const { login, isLoading } = useAuthStore();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await login(email, password);
      router.push('/dashboard');
    } catch (err: any) {
      const data = err?.response?.data;
      // NestJS may return message as string or string[]
      const raw = data?.message;
      const msg = Array.isArray(raw)
        ? raw[0]
        : raw || '邮箱或密码不正确，请重试';
      setError(msg);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 relative overflow-hidden">
      {/* Background orbs */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/3 left-1/4 w-96 h-96 bg-brand-500/8 rounded-full blur-3xl" />
        <div className="absolute bottom-1/3 right-1/4 w-80 h-80 bg-purple-500/6 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md animate-slide-up">
        {/* Logo */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-500 to-purple-500 flex items-center justify-center shadow-glow">
              <Zap className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-xl gradient-text">SkillForge</span>
          </Link>
          <h1 className="text-2xl font-bold mt-6 mb-1">Welcome back</h1>
          <p className="text-muted-foreground text-sm">Sign in to your account</p>
        </div>

        {/* Form */}
        <div className="glass-lg rounded-2xl p-8">
          <form onSubmit={handleSubmit} className="space-y-5">

            {/* ── Inline error banner ── */}
            {error && (
              <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/25 text-red-400 text-sm">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <div>
              <label htmlFor="email" className="block text-sm font-medium mb-1.5">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(''); }}
                placeholder="you@example.com"
                required
                className={cn('input-field', error && 'border-red-500/40')}
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="password" className="block text-sm font-medium">
                  Password
                </label>
                <Link href="/forgot-password" className="text-xs text-brand-400 hover:text-brand-300">
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(''); }}
                  placeholder="••••••••"
                  required
                  className={cn('input-field pr-12', error && 'border-red-500/40')}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className={cn('btn-primary w-full justify-center py-3', isLoading && 'opacity-70')}
            >
              {isLoading ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Signing in…</>
              ) : (
                'Sign in'
              )}
            </button>
          </form>

          <p className="text-center text-sm text-muted-foreground mt-6">
            Don't have an account?{' '}
            <Link href="/register" className="text-brand-400 hover:text-brand-300 font-medium">
              Sign up free
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
