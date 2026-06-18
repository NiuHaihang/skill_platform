'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { useState, useEffect } from 'react';
import { useThemeStore, applyAccent } from '@/lib/theme-store';

function ThemeApplier() {
  const accent = useThemeStore((s) => s.accent);
  useEffect(() => {
    applyAccent(accent);
  }, [accent]);
  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeApplier />
      {children}
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 4000,
          style: {
            background: 'hsl(224 18% 9%)',
            color: 'hsl(220 15% 92%)',
            border: '1px solid hsl(224 16% 16%)',
            borderRadius: '12px',
            fontSize: '14px',
          },
          success: {
            iconTheme: { primary: '#10b981', secondary: 'transparent' },
          },
          error: {
            iconTheme: { primary: '#ef4444', secondary: 'transparent' },
          },
        }}
      />
    </QueryClientProvider>
  );
}
