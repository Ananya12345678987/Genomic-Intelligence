import type { Config } from 'tailwindcss';

/**
 * Design tokens: a pistachio-kernel palette (soft green with a milky-yellow
 * undertone). Values start from the product brief; `ink.soft` is darkened from
 * #74806D to reach WCAG AA contrast (>= 4.5:1) on the cream backgrounds.
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#F5F5E9',
        surface: { DEFAULT: '#FFFFFF', alt: '#EEF1E3' },
        pistachio: { DEFAULT: '#DCE8C7', deep: '#AEBF91' },
        ink: { DEFAULT: '#344536', soft: '#5E6A57' },
        line: '#DDE2D1',
        butter: '#F3EDCC',
        danger: { DEFAULT: '#8E3B34', bg: '#F6E4E1' },
        caution: { DEFAULT: '#7A5A12', bg: '#F7ECCB' },
      },
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono Variable"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      borderRadius: { card: '14px', pill: '999px' },
      boxShadow: {
        soft: '0 1px 2px rgba(52,69,54,0.05), 0 4px 16px rgba(52,69,54,0.05)',
        lift: '0 2px 4px rgba(52,69,54,0.06), 0 10px 28px rgba(52,69,54,0.08)',
      },
    },
  },
  plugins: [],
} satisfies Config;
