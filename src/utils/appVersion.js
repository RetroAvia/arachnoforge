/* global __APP_VERSION__ */

/**
 * V41 — Versione dell'app, iniettata da Vite al build (vite.config.js →
 * `define`, letta da package.json). Il controllo con `typeof` la rende
 * innocua dove la costante non esiste (test su Node, strumenti esterni):
 * lì vale semplicemente stringa vuota.
 */
export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '';
