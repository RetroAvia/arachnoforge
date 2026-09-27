import React, { useState } from 'react';
import { Icon } from './Icons.jsx';

/**
 * V41 — Campo password condiviso (Nexus Gate, cambio password):
 * etichetta vera, pulsante mostra/nascondi e avviso di Bloc Maiusc attivo,
 * la causa più comune di un "password errata" su PC.
 */
export default function PasswordField({
  id,
  label,
  value,
  onChange,
  onType,
  autoComplete = 'current-password',
  placeholder,
  hint,
  inputRef,
  autoFocus = false,
  invalid = false
}) {
  const [visible, setVisible] = useState(false);
  const [capsLock, setCapsLock] = useState(false);

  const readCaps = (e) => {
    if (typeof e.getModifierState === 'function') setCapsLock(e.getModifierState('CapsLock'));
  };

  const helpText = capsLock ? 'Bloc Maiusc è attivo.' : hint;
  const helpId = helpText ? `${id}-help` : undefined;

  return (
    <div>
      {label && (
        <label htmlFor={id} className="ds-label">
          {label}
        </label>
      )}
      <div className="relative">
        <Icon name="lock" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
        <input
          id={id}
          ref={inputRef}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            if (onType) onType();
          }}
          onKeyDown={readCaps}
          onKeyUp={readCaps}
          onBlur={() => setCapsLock(false)}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoFocus={autoFocus}
          placeholder={placeholder}
          aria-invalid={invalid || undefined}
          aria-describedby={helpId}
          className="ds-input pl-9 pr-11"
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute right-1 top-1/2 -translate-y-1/2 ds-icon-btn !w-9 !h-9"
          aria-label={visible ? 'Nascondi password' : 'Mostra password'}
          aria-pressed={visible}
          title={visible ? 'Nascondi password' : 'Mostra password'}
        >
          <Icon name={visible ? 'eyeOff' : 'eye'} className="w-4 h-4" />
        </button>
      </div>
      {helpText && (
        <p id={helpId} className={`text-xs mt-1.5 flex items-center gap-1.5 ${capsLock ? 'text-accent' : 'text-slate-500'}`}>
          {capsLock && <Icon name="alertTriangle" className="w-3.5 h-3.5 shrink-0" />}
          {helpText}
        </p>
      )}
    </div>
  );
}
