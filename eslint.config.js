// =====================================================================
// ArachnoForge — configurazione ESLint (V37.0)
// =====================================================================
// PERCHÉ ESISTE
// Fino alla V36 il progetto non aveva ESLint, ma il codice era pieno di
// direttive `// eslint-disable-next-line react-hooks/exhaustive-deps`:
// commenti che non silenziavano nulla, perché nessuno controllava.
//
// Due dei bug corretti nella V37 sarebbero stati intercettati qui, prima
// ancora di arrivare in produzione:
//   - `no-undef` avrebbe trovato `setAwaitingPostFocus` (funzione
//     inesistente chiamata a ogni Tactical Debriefing);
//   - `react-hooks/exhaustive-deps` avrebbe segnalato la dipendenza
//     stantia in `useTimerEngine` che teneva l'Overdrive sempre a false.
//
// Uso:  npm run lint          (solo segnalazione)
//       npm run lint:fix      (corregge il correggibile)
//
// Nota: `eslint-plugin-react-hooks` va installato per attivare le regole
// sugli hook — la configurazione le carica solo se il plugin è presente,
// così `npm run lint` funziona comunque su una macchina che non l'ha
// ancora installato.
// =====================================================================
import js from '@eslint/js';
import globals from 'globals';

let reactHooks = null;
try {
  reactHooks = (await import('eslint-plugin-react-hooks')).default;
} catch {
  // Plugin non installato: si procede con le sole regole di base.
}

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'supabase/functions/**', '_to_delete/**']
  },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true }
      },
      globals: {
        ...globals.browser,
        ...globals.es2021
      }
    },
    settings: { react: { version: '18.2' } },
    plugins: reactHooks ? { 'react-hooks': reactHooks } : {},
    rules: {
      // --- Le regole che contano davvero per questo progetto ---------
      // `no-undef` è quella che avrebbe trovato setAwaitingPostFocus.
      'no-undef': 'error',
      'no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^(React|_)', ignoreRestSiblings: true }
      ],
      // Il reducer e i motori puri non devono MAI avere side-effect
      // nascosti in una condizione.
      'no-cond-assign': 'error',
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-fallthrough': 'error',
      'no-self-compare': 'error',
      'no-unmodified-loop-condition': 'error',
      'no-unreachable-loop': 'error',
      // Confronti espliciti: `== null` resta ammesso perché l'app lo usa
      // deliberatamente per "null o undefined" in decine di guardie.
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'warn',
      'no-var': 'error',
      // `console.warn`/`console.error` sono usati come canale di
      // diagnostica vero (vedi utils/errorReporter.js): restano.
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      ...(reactHooks
        ? {
            'react-hooks/rules-of-hooks': 'error',
            // `warn` e non `error`: l'app ha diverse omissioni
            // DELIBERATE e documentate (es. effetti che devono girare
            // una sola volta al mount). Vanno riviste una per una, non
            // silenziate in blocco né trasformate in un blocco del build.
            'react-hooks/exhaustive-deps': 'warn'
          }
        : {})
    }
  },
  {
    // I test girano su Node, non nel browser.
    files: ['**/*.test.js'],
    languageOptions: { globals: { ...globals.node } }
  },
  {
    // Il Service Worker ha il proprio ambiente globale.
    files: ['public/sw.js'],
    languageOptions: { globals: { ...globals.serviceworker, ...globals.browser } }
  }
];
