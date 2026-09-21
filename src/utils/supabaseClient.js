import { createClient } from '@supabase/supabase-js';

/**
 * V26.0 — "The Nexus Gate": client Supabase condiviso (singleton di modulo,
 * stesso pattern dell'AudioContext in useAudioEngine.js — un solo client
 * per l'intera app, mai ricreato ad ogni render).
 *
 * V37.0 — Le credenziali NON sono più scritte qui dentro. Vivevano nel
 * sorgente "solo per i test locali" e ci sono rimaste: finivano nel
 * repository e impedivano di avere un progetto di prova separato da
 * quello reale. La ANON KEY è per sua natura pubblica — è protetta dalle
 * Row Level Security, non dalla segretezza — ma il punto non è quello:
 * sono CONFIGURAZIONE, e la configurazione appartiene all'ambiente.
 *
 * Come impostarle:
 *   - in locale: un file `.env.local` nella root (vedi `.env.example`),
 *     già escluso da Git;
 *   - su Vercel: Project Settings -> Environment Variables.
 *
 * Il fallback ai valori storici tiene in vita un deploy esistente che non
 * ha ancora le variabili impostate: l'app non smette di funzionare per
 * una configurazione mancante, ma lo dice chiaramente in console.
 */
const FALLBACK_URL = 'https://jmtqixgtuavpjwkurakt.supabase.co';
const FALLBACK_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImptdHFpeGd0dWF2cGp3a3VyYWt0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM4OTUzMDIsImV4cCI6MjA5OTQ3MTMwMn0.4r1vL__rkvkp5f1VlD83Sdfsy9YewyO7D4T2XeIbyhM';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || FALLBACK_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || FALLBACK_ANON_KEY;

if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY) {
  console.warn(
    '[ArachnoForge] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY non impostate: uso le credenziali di fallback ' +
      'compilate nel sorgente. Impostale in .env.local (locale) e nelle Environment Variables di Vercel (produzione).'
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});

/** Nome della tabella Cloud State (Pillar 3 — JSONB Strategy). */
export const USER_DATA_TABLE = 'user_data';

export default supabase;
