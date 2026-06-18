'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard, Store, Bot, MessageSquare, Zap,
  LogOut, Settings, ChevronRight, User,
} from 'lucide-react';
import { useAuthStore } from '@/lib/auth-store';
import { cn, getInitials } from '@/lib/utils';
import toast from 'react-hot-toast';

const NAV_ITEMS = [
  { href: '/dashboard',             icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/dashboard/agents',      icon: Bot,             label: 'My Agents' },
  { href: '/dashboard/skills',      icon: Zap,             label: 'My Skills' },
  { href: '/dashboard/chat',        icon: MessageSquare,   label: 'Chat' },
  { href: '/marketplace',           icon: Store,           label: 'Marketplace' },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuthStore();

  const handleLogout = async () => {
    await logout();
    toast.success('Logged out');
    router.push('/');
  };

  return (
    <div className="flex h-screen overflow-hidden">
      {/* ── Sidebar ── */}
      <aside className="w-64 flex-shrink-0 glass border-r border-border flex flex-col">
        {/* Logo */}
        <div className="h-16 px-5 flex items-center gap-2 border-b border-border">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-500 to-purple-500 flex items-center justify-center shadow-glow">
            <Zap className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold gradient-text">SkillForge</span>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn('sidebar-item', active && 'active')}
              >
                <item.icon className="w-4 h-4 flex-shrink-0" />
                {item.label}
                {active && <ChevronRight className="w-3.5 h-3.5 ml-auto opacity-60" />}
              </Link>
            );
          })}
        </nav>

        {/* User section */}
        <div className="px-3 pb-4 space-y-1 border-t border-border pt-4">
          <Link
            href="/dashboard/settings"
            className={cn('sidebar-item', pathname === '/dashboard/settings' && 'active')}
          >
            <Settings className="w-4 h-4" />
            Settings
          </Link>
          <button onClick={handleLogout} className="sidebar-item w-full text-left text-red-400 hover:text-red-300">
            <LogOut className="w-4 h-4" />
            Sign out
          </button>

          {/* User card */}
          {user && (
            <div className="mt-3 p-3 rounded-xl bg-secondary/60 border border-border flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-500 to-purple-500 flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
                {getInitials(user.username)}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{user.username}</p>
                <p className="text-xs text-muted-foreground truncate">{user.email}</p>
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* ── Main content ── */}
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
