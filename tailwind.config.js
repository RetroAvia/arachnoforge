/** @type {import('tailwindcss').Config} */
/*
 * ArachnoForge — V41 "Definitiva": design system premium.
 *
 * Tutti i colori "di ruolo" passano ancora dalle CSS custom properties di
 * index.css (`--af-*-rgb`), così Spider-Suit (Classic / Symbiote / 2099) e
 * Maximum Carnage ritinteggiano l'intera app senza toccare un componente.
 *
 * Gerarchia delle superfici (dal più scuro al più chiaro):
 *   app     — lo sfondo della pagina
 *   surface — pozzetti incassati DENTRO i pannelli (righe, campi, liste)
 *   panel   — card e pannelli
 *   panel-2 — hover, elementi rialzati, menu
 *   panel-3 — stati premuti / attivi
 */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        'af-bg': 'rgb(var(--af-bg-rgb) / <alpha-value>)',
        'af-text': '#eceef3',
        'af-attack': 'rgb(var(--af-attack-rgb) / <alpha-value>)',
        'af-refuel': 'rgb(var(--af-refuel-rgb) / <alpha-value>)',
        'af-decay': 'rgb(var(--af-decay-rgb) / <alpha-value>)',
        primary: 'rgb(var(--af-attack-rgb) / <alpha-value>)',
        'primary-dark': 'rgb(var(--af-attack-dark-rgb) / <alpha-value>)',
        secondary: 'rgb(var(--af-refuel-rgb) / <alpha-value>)',
        'secondary-dark': 'rgb(var(--af-refuel-dark-rgb) / <alpha-value>)',
        accent: 'rgb(var(--af-decay-rgb) / <alpha-value>)',
        app: 'rgb(var(--af-bg-rgb) / <alpha-value>)',
        surface: 'rgb(var(--af-surface-rgb) / <alpha-value>)',
        panel: 'rgb(var(--af-panel-rgb) / <alpha-value>)',
        'panel-2': 'rgb(var(--af-panel-2-rgb) / <alpha-value>)',
        'panel-3': 'rgb(var(--af-panel-3-rgb) / <alpha-value>)',
        line: 'rgb(255 255 255 / 0.075)',
        'line-strong': 'rgb(255 255 255 / 0.13)',
        fg: '#eceef3',
        'fg-muted': '#a7aebb',
        'fg-subtle': '#7d8696'
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
        sans: ['"Inter"', 'ui-sans-serif', 'system-ui', '-apple-system', '"Segoe UI"', 'Roboto', 'sans-serif']
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }]
      },
      borderRadius: {
        '4xl': '2rem'
      },
      /* Le ombre "glow" restano con gli stessi nomi (usati in tutta l'app)
         ma diventano ombre morbide e colorate, non più aloni al neon. */
      boxShadow: {
        'attack-glow': '0 6px 18px -8px rgb(var(--af-attack-rgb) / 0.55)',
        'refuel-glow': '0 6px 18px -8px rgb(var(--af-refuel-rgb) / 0.55)',
        'decay-glow': '0 6px 18px -8px rgb(var(--af-decay-rgb) / 0.5)',
        'primary-glow': '0 6px 18px -8px rgb(var(--af-attack-rgb) / 0.55)',
        'primary-glow-lg': '0 10px 28px -10px rgb(var(--af-attack-rgb) / 0.7)',
        'secondary-glow': '0 6px 18px -8px rgb(var(--af-refuel-rgb) / 0.55)',
        'secondary-glow-lg': '0 10px 28px -10px rgb(var(--af-refuel-rgb) / 0.7)',
        'accent-glow': '0 6px 18px -8px rgb(var(--af-decay-rgb) / 0.5)',
        'accent-glow-lg': '0 10px 28px -10px rgb(var(--af-decay-rgb) / 0.65)',
        panel: '0 1px 0 0 rgb(255 255 255 / 0.03) inset, 0 12px 32px -18px rgb(0 0 0 / 0.75)',
        pop: '0 1px 0 0 rgb(255 255 255 / 0.04) inset, 0 24px 60px -20px rgb(0 0 0 / 0.85)'
      },
      keyframes: {
        pulseSlow: {
          '0%, 100%': { opacity: 1 },
          '50%': { opacity: 0.55 }
        },
        scanline: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100%)' }
        },
        gradientShift: {
          '0%': { backgroundPosition: '0% 50%' },
          '100%': { backgroundPosition: '300% 50%' }
        }
      },
      animation: {
        'pulse-slow': 'pulseSlow 2.8s ease-in-out infinite',
        scanline: 'scanline 3s linear infinite',
        'gradient-shift': 'gradientShift 3.5s linear infinite'
      }
    }
  },
  plugins: []
};
