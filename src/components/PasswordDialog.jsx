import React, { useEffect, useRef, useState } from 'react';
import Modal from './Modal.jsx';
import { Icon } from './Icons.jsx';
import PasswordField from './PasswordField.jsx';
import { useAuthContext } from '../context/AuthContext.jsx';
import { NEW_PASSWORD_MIN_LENGTH, translateAuthError, validateNewPassword } from '../utils/authFlow.js';
import { BTN_GHOST, BTN_PRIMARY } from '../utils/designSystem.js';

/**
 * V41 — Scelta di una nuova password.
 *
 *  - `mode="recovery"`: si arriva dal link "Password dimenticata?". La
 *    sessione è già valida, ma senza una password nuova il prossimo
 *    accesso da un altro dispositivo sarebbe di nuovo impossibile.
 *  - `mode="change"`: dalle Impostazioni, per cambiarla quando si vuole.
 */
export default function PasswordDialog({ open, mode = 'change', onClose, onSuccess }) {
  const { updatePassword, user } = useAuthContext();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const firstFieldRef = useRef(null);
  const recovery = mode === 'recovery';

  useEffect(() => {
    if (!open) return;
    setPassword('');
    setConfirm('');
    setError(null);
    setSaving(false);
  }, [open]);

  const submit = async (e) => {
    e.preventDefault();
    if (saving) return;
    const problem = validateNewPassword(password, confirm);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { error: authError } = await updatePassword(password);
      if (authError) {
        setError(translateAuthError(authError.message));
        setSaving(false);
        return;
      }
      setSaving(false);
      if (onSuccess) onSuccess();
    } catch (err) {
      setError(translateAuthError(err && err.message));
      setSaving(false);
    }
  };

  const close = () => {
    if (!saving) onClose();
  };

  const longEnough = password.length >= NEW_PASSWORD_MIN_LENGTH;
  const matches = confirm.length > 0 && confirm === password;

  return (
    <Modal open={open} onClose={close} title={recovery ? 'Imposta una nuova password' : 'Cambia password'} initialFocusRef={firstFieldRef}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <p className="text-sm text-slate-400 leading-relaxed">
          {recovery
            ? 'Sei entrato con il link di recupero. Scegli la password da usare d’ora in poi, su tutti i dispositivi.'
            : 'Al prossimo accesso, da qualsiasi dispositivo, userai quella nuova. Qui resti collegato.'}
        </p>
        {/* Nome utente nascosto: permette al gestore di password del browser di aggiornare la voce giusta. */}
        <input type="email" name="username" autoComplete="username" value={user?.email || ''} readOnly className="hidden" tabIndex={-1} aria-hidden="true" />
        <PasswordField
          id="pwd-new"
          label="Nuova password"
          value={password}
          onChange={(v) => {
            setPassword(v);
            if (error) setError(null);
          }}
          autoComplete="new-password"
          inputRef={firstFieldRef}
        />
        <PasswordField
          id="pwd-confirm"
          label="Ripeti la nuova password"
          value={confirm}
          onChange={(v) => {
            setConfirm(v);
            if (error) setError(null);
          }}
          autoComplete="new-password"
        />
        <ul className="space-y-1 text-xs" aria-label="Requisiti">
          <li className={`flex items-center gap-1.5 ${longEnough ? 'text-emerald-300' : 'text-slate-500'}`}>
            <Icon name={longEnough ? 'check' : 'info'} className="w-3.5 h-3.5 shrink-0" />
            Almeno {NEW_PASSWORD_MIN_LENGTH} caratteri
          </li>
          <li className={`flex items-center gap-1.5 ${matches ? 'text-emerald-300' : 'text-slate-500'}`}>
            <Icon name={matches ? 'check' : 'info'} className="w-3.5 h-3.5 shrink-0" />
            Le due password coincidono
          </li>
        </ul>
        {error && (
          <p role="alert" className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/[0.07] px-3 py-2.5 text-[13px] text-primary leading-relaxed">
            <Icon name="alertTriangle" className="w-4 h-4 shrink-0 mt-0.5" />
            {error}
          </p>
        )}
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-1">
          <button type="button" onClick={close} disabled={saving} className={BTN_GHOST}>
            {recovery ? 'Più tardi' : 'Annulla'}
          </button>
          <button type="submit" disabled={saving} className={BTN_PRIMARY}>
            {saving ? (
              <>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" aria-hidden="true" />
                Salvataggio…
              </>
            ) : (
              <>
                <Icon name="lock" className="w-4 h-4" />
                Salva password
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}
