// =====================================================================
// ArachnoForge — src/utils/authFlow.test.js (V41)
// Accesso: link email di ritorno, testi degli errori, regole password.
// =====================================================================
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAuthRedirect,
  describeRedirectError,
  translateAuthError,
  validateNewPassword,
  isPlausibleEmail,
  NEW_PASSWORD_MIN_LENGTH,
  LOGIN_PASSWORD_MIN_LENGTH
} from './authFlow.js';

describe('parseAuthRedirect', () => {
  test('riconosce il ritorno dal link di recupero password', () => {
    const r = parseAuthRedirect('#access_token=abc&expires_in=3600&refresh_token=x&token_type=bearer&type=recovery', '');
    assert.equal(r.recovery, true);
    assert.equal(r.error, null);
  });
  test('un link scaduto è un errore, mai un recupero', () => {
    const r = parseAuthRedirect('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
    assert.equal(r.recovery, false);
    assert.deepEqual(r.error, { code: 'otp_expired', description: 'Email link is invalid or has expired' });
  });
  test('gli hash del router non sono né recupero né errore', () => {
    assert.deepEqual(parseAuthRedirect('#/mission-control', ''), { recovery: false, error: null });
    assert.deepEqual(parseAuthRedirect('', '?sandbox=1'), { recovery: false, error: null });
  });
  test('legge anche la query string (flusso PKCE)', () => {
    const r = parseAuthRedirect('', '?error=server_error&error_description=boom');
    assert.equal(r.error.code, 'server_error');
  });
});

describe('describeRedirectError', () => {
  test('link scaduto', () => {
    assert.match(describeRedirectError({ code: 'otp_expired', description: '' }), /scaduto/);
  });
  test('altro errore', () => {
    assert.match(describeRedirectError({ code: 'access_denied', description: 'x' }), /non è valido/);
  });
  test('nessun errore', () => {
    assert.equal(describeRedirectError(null), null);
  });
});

describe('translateAuthError', () => {
  test('credenziali errate', () => {
    assert.equal(translateAuthError('Invalid login credentials'), 'Email o password non corrette.');
  });
  test('"diversa dalla vecchia" vince sul controllo di lunghezza', () => {
    assert.match(translateAuthError('New password should be different from the old password.'), /diversa/);
  });
  test('password corta con il minimo passato dal chiamante', () => {
    assert.match(translateAuthError('Password should be at least 6 characters', { minLength: 10 }), /almeno 10/);
  });
  test('password debole o trapelata', () => {
    assert.match(translateAuthError('Password is known to be weak and easy to guess, please choose a different one.'), /debole/);
  });
  test('rete assente', () => {
    assert.match(translateAuthError('Failed to fetch'), /connessione/);
  });
  test('limite di frequenza', () => {
    assert.match(translateAuthError('For security purposes, you can only request this after 60 seconds.'), /attendi/);
  });
  test('messaggio vuoto e sconosciuto', () => {
    assert.equal(translateAuthError(''), 'Operazione non riuscita. Riprova.');
    assert.equal(translateAuthError('Qualcosa di strano'), 'Operazione non riuscita: Qualcosa di strano');
  });
});

describe('validateNewPassword', () => {
  test('troppo corta', () => {
    assert.match(validateNewPassword('corta', 'corta'), new RegExp(String(NEW_PASSWORD_MIN_LENGTH)));
  });
  test('solo spazi', () => {
    assert.match(validateNewPassword('          ', '          '), /spazi/);
  });
  test('non coincidono', () => {
    assert.match(validateNewPassword('unaPassword123', 'unaPassword124'), /coincidono/);
  });
  test('valida', () => {
    assert.equal(validateNewPassword('unaPassword123', 'unaPassword123'), null);
    assert.equal(validateNewPassword('unaPassword123'), null);
  });
  test('il minimo del login resta quello storico', () => {
    assert.equal(LOGIN_PASSWORD_MIN_LENGTH, 6);
  });
});

describe('isPlausibleEmail', () => {
  test('forme valide e non valide', () => {
    assert.equal(isPlausibleEmail('gabriele@example.it'), true);
    assert.equal(isPlausibleEmail('  gabriele@example.it  '), true);
    assert.equal(isPlausibleEmail('gabriele@'), false);
    assert.equal(isPlausibleEmail('gabriele example.it'), false);
    assert.equal(isPlausibleEmail(''), false);
  });
});
