/** @type {import('tailwindcss').Config} */
export default {
  // The overlay lives inside a shadow root, so we disable Tailwind's global
  // preflight (it would style the host page) and scope everything
  // to elements rendered by our React app.
  corePlugins: {
    preflight: false,
  },
  content: ['./src/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      // Softer than Tailwind's 2px default; the "site" theme overrides `rounded`
      // with the host page's radius (see index.css).
      borderRadius: {
        DEFAULT: '5px',
        lg: '10px',
        md: '7px',
        sm: '3px',
      },
      boxShadow: {
        panel: '0 24px 60px -24px rgb(0 0 0 / 0.65)',
        pop: '0 10px 30px -12px rgb(0 0 0 / 0.6)',
      },
      /**
       * Semantic colors, every one a CSS variable so the dark palette and the
       * "match the site" palette are the same classes with different values
       * (tokens are defined in ui/index.css). Prefer these over raw `slate-*`:
       * `bg-canvas`, `bg-panel`, `border-line`, `text-ink-muted`, `bg-accent`.
       */
      colors: {
        accent: {
          DEFAULT: 'var(--lugin-accent)',
          ink: 'var(--lugin-accent-ink)', // text/icons on an accent fill
          soft: 'var(--lugin-accent-soft)', // tinted background for selected states
          strong: 'var(--lugin-accent-strong)', // hover of an accent fill
        },
        canvas: 'var(--lugin-canvas)', // the panel's own background
        ink: {
          DEFAULT: 'var(--lugin-ink)',
          faint: 'var(--lugin-ink-3)', // labels, disabled, least important
          muted: 'var(--lugin-ink-2)', // secondary text
        },
        line: {
          DEFAULT: 'var(--lugin-line)', // hairline dividers
          strong: 'var(--lugin-line-2)', // control borders
        },
        neg: { DEFAULT: 'var(--lugin-neg)', soft: 'var(--lugin-neg-soft)' },
        panel: 'var(--lugin-panel)', // headers, toolbars, sections
        pos: { DEFAULT: 'var(--lugin-pos)', soft: 'var(--lugin-pos-soft)' },
        raised: 'var(--lugin-raised)', // inputs and other controls
        select: {
          DEFAULT: 'var(--lugin-select)', // a picked row in a multi-select list
          strong: 'var(--lugin-select-2)', // …with the pointer over it
        },
        /**
         * The panels were written against raw `slate-*`/`sky-*` utilities. Rather
         * than rewrite thousands of class names at once, the two ramps are
         * redefined here to the same palette the tokens use — so `bg-slate-900`
         * is the panel surface, `text-slate-500` is faint ink, `bg-sky-600` is
         * the accent, and every variant (`hover:`, `/40`) follows. New code
         * should use the semantic names above; these keep the old code honest
         * while it migrates.
         */
        sky: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2f76e8',
          700: '#2563c9',
          800: '#1e4fa3',
          900: '#1c3f80',
          950: '#16305e',
        },
        slate: {
          50: '#f6f9fc',
          100: '#e8eef7',
          200: '#cdd8e6',
          300: '#a3b1c6',
          400: '#8494aa',
          500: '#6d7d94',
          600: '#4b5a70',
          700: '#28323f',
          800: '#18222f',
          900: '#111a26',
          950: '#0b1017',
        },
        tint: {
          DEFAULT: 'var(--lugin-tint)', // hover wash over any surface
          strong: 'var(--lugin-tint-2)', // pressed/active wash
        },
        warn: { DEFAULT: 'var(--lugin-warn)', soft: 'var(--lugin-warn-soft)' },
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      // A dense four-step scale for a side panel full of data. Everything in the
      // UI should use one of these rather than an arbitrary `text-[Npx]`.
      fontSize: {
        '2xs': ['10px', '13px'], // badges, meta, column labels
        base: ['13px', '18px'], // titles
        lg: ['15px', '20px'],
        sm: ['12px', '16px'], // emphasis inside rows
        xs: ['11px', '15px'], // body text of every list
      },
      spacing: {
        row: '1.625rem', // 26px — the standard list row height
      },
    },
  },
  plugins: [],
};
