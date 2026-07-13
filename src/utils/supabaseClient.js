import { createClient } from '@supabase/supabase-js';

/**
 * V26.0 — "The Nexus Gate": client Supabase condiviso (singleton di modulo,
 * stesso pattern dell'AudioContext in useAudioEngine.js — un solo client
 * per l'intera app, mai ricreato ad ogni render).
 *
 * Le credenziali sono inserite direttamente qui SOLO per i test locali,
 * come richiesto esplicitamente. In un deploy reale andrebbero spostate in
 * variabili d'ambiente Vite (import.meta.env.VITE_SUPABASE_URL /
 * VITE_SUPABASE_ANON_KEY, con un file .env escluso da Git) — la ANON KEY
 * è comunque progettata per essere pubblica lato client (protetta dalle
 * Row Level Security policy sul database, non da segretezza).
 */
const SUPABASE_URL = 'https://jmtqixgtuavpjwkurakt.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImptdHFpeGd0dWF2cGp3a3VyYWt0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM4OTUzMDIsImV4cCI6MjA5OTQ3MTMwMn0.4r1vL__rkvkp5f1VlD83Sdfsy9YewyO7D4T2XeIbyhM';

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
