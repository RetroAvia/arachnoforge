/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        'af-bg': '#050508',
        'af-surface': '#0d0d14',
        'af-border': '#1a1a26',
        'af-text': '#f8fafc',
        'af-text-secondary': '#64748b',
        /* Terna reattiva ai Spider-Suit: i valori reali vivono in :root e
           in [data-theme] come RGB "r g b" (senza rgb()), cosi' Tailwind puo'
           comporli con l'alpha-value delle utility (es. bg-af-attack/15). */
        'af-attack': 'rgb(var(--af-attack-rgb) / <alpha-value>)',
        'af-refuel': 'rgb(var(--af-refuel-rgb) / <alpha-value>)',
        'af-decay': 'rgb(var(--af-decay-rgb) / <alpha-value>)',
        /* Superficie "vetro tecnologico" — stessa base di af-surface ma
           esposta come RGB variabile cosi' da poter comporre opacita'
           (bg-af-glass/80) insieme a backdrop-blur per i pannelli Elite UI. */
        'af-glass': 'rgb(var(--af-surface-rgb) / <alpha-value>)',
        /* V16.0 True Theme Engine — alias semantici richiesti (Pillar 3):
           stessi identici canali RGB di af-attack/af-refuel/af-decay/af-glass,
           esposti con nomi "da design system" (bg-primary, border-secondary,
           text-accent...) cosi' che OGNI file nuovo o vecchio ritinteggi
           insieme al costume attivo, senza mai un hex statico. Include le
           varianti "-dark" per i gradienti a due toni dei pulsanti. */
        primary: 'rgb(var(--af-attack-rgb) / <alpha-value>)',
        'primary-dark': 'rgb(var(--af-attack-dark-rgb) / <alpha-value>)',
        secondary: 'rgb(var(--af-refuel-rgb) / <alpha-value>)',
        'secondary-dark': 'rgb(var(--af-refuel-dark-rgb) / <alpha-value>)',
        accent: 'rgb(var(--af-decay-rgb) / <alpha-value>)',
        surface: 'rgb(var(--af-surface-rgb) / <alpha-value>)'
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', '"Courier New"', 'monospace'],
        sans: ['"Inter"', 'system-ui', 'sans-serif']
      },
      boxShadow: {
        'attack-glow': '0 0 12px rgb(var(--af-attack-rgb) / 0.45)',
        'refuel-glow': '0 0 12px rgb(var(--af-refuel-rgb) / 0.45)',
        'decay-glow': '0 0 12px rgb(var(--af-decay-rgb) / 0.45)',
        'af-panel': '0 8px 30px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.03)',
        'primary-glow': '0 0 15px rgb(var(--af-attack-rgb) / 0.4)',
        'primary-glow-lg': '0 0 25px rgb(var(--af-attack-rgb) / 0.7)',
        'secondary-glow': '0 0 15px rgb(var(--af-refuel-rgb) / 0.4)',
        'secondary-glow-lg': '0 0 25px rgb(var(--af-refuel-rgb) / 0.7)',
        'accent-glow': '0 0 15px rgb(var(--af-decay-rgb) / 0.4)',
        'accent-glow-lg': '0 0 25px rgb(var(--af-decay-rgb) / 0.7)'
      },
      keyframes: {
        pulseSlow: {
          '0%, 100%': { opacity: 1 },
          '50%': { opacity: 0.5 }
        },
        scanline: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100%)' }
        },
        // V25.0 — Dynamic Titles Engine: scorrimento del gradiente per il
        // titolo epico "Difensore del Multiverso" (Lv.50+). bg-size 300%
        // + background-position in loop = sensazione di energia viva,
        // mai un testo statico per il rango più alto del gioco.
        gradientShift: {
          '0%': { backgroundPosition: '0% 50%' },
          '100%': { backgroundPosition: '300% 50%' }
        },
        // V25.0 — Skill Tree: pulsazione dei nodi sbloccabili (affordable
        // ma non ancora sbloccati), per invitare il click senza gridare.
        tokenPulse: {
          '0%, 100%': { boxShadow: '0 0 0 0 rgb(var(--af-decay-rgb) / 0.45)' },
          '50%': { boxShadow: '0 0 0 6px rgb(var(--af-decay-rgb) / 0)' }
        }
      },
      animation: {
        'pulse-slow': 'pulseSlow 2.5s ease-in-out infinite',
        scanline: 'scanline 3s linear infinite',
        'gradient-shift': 'gradientShift 3.5s linear infinite',
        'token-pulse': 'tokenPulse 2s ease-in-out infinite'
      }
    }
  },
  plugins: []
};
