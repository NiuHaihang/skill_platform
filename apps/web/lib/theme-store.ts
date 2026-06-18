import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type AccentColor = 'violet' | 'cyan' | 'emerald' | 'rose' | 'amber' | 'blue';

export interface ThemeState {
  accent: AccentColor;
  setAccent: (color: AccentColor) => void;
}

/** CSS variable values per accent color. Applied to document.documentElement. */
export const ACCENT_VARS: Record<AccentColor, { primary: string; ring: string }> = {
  violet:  { primary: '247 80% 68%', ring: '247 80% 68%' },
  cyan:    { primary: '189 94% 55%', ring: '189 94% 55%' },
  emerald: { primary: '152 76% 50%', ring: '152 76% 50%' },
  rose:    { primary: '350 89% 65%', ring: '350 89% 65%' },
  amber:   { primary: '38 92% 58%',  ring: '38 92% 58%'  },
  blue:    { primary: '217 91% 65%', ring: '217 91% 65%' },
};

/** Apply the chosen accent color to the <html> element's CSS variables. */
export function applyAccent(accent: AccentColor) {
  const vars = ACCENT_VARS[accent];
  const root = document.documentElement;
  root.style.setProperty('--primary', vars.primary);
  root.style.setProperty('--ring', vars.ring);
  // Also update the accent glow/shadow to match
  root.setAttribute('data-accent', accent);
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      accent: 'violet',
      setAccent: (color) => {
        set({ accent: color });
        applyAccent(color);
      },
    }),
    { name: 'skillforge-theme' },
  ),
);
