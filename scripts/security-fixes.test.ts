// Regression tests for the 2026-10 security audit fixes. Run:  npx tsx scripts/security-fixes.test.ts
import assert from 'node:assert/strict';

process.env.TOKEN_ENCRYPTION_KEY = 'k'.repeat(48);
delete process.env.OAUTH_STATE_SECRET;

(async () => {
  const { signOAuthState, verifyOAuthState, nonceMatches } = await import('../src/lib/oauth-state');
  const { encryptToken, decryptToken } = await import('../src/lib/token-crypto');
  const { safeEqual } = await import('../src/lib/secret-compare');
  const { blockKey } = await import('../src/lib/block-key');

  // ── C1/H1: signed OAuth state ──────────────────────────────────────────────
  const { state, nonce } = signOAuthState({ uid: 'user-a', bu: 'commercial', retry: false });
  const ok = verifyOAuthState(state);
  assert.equal(ok?.uid, 'user-a'); assert.equal(ok?.bu, 'commercial'); assert.equal(ok?.nonce, nonce);

  // An attacker editing the userId inside the state (the old exploit) must fail verification.
  const [body, sig] = state.split('.');
  const forgedBody = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), uid: 'victim' })).toString('base64url');
  assert.equal(verifyOAuthState(`${forgedBody}.${sig}`), null, 'edited uid must not verify');
  assert.equal(verifyOAuthState(`${body}.${sig.slice(0, -2)}AA`), null, 'bad signature');
  assert.equal(verifyOAuthState('victim|commercial||somenonce'), null, 'legacy pipe-delimited state is rejected');
  assert.equal(verifyOAuthState(''), null); assert.equal(verifyOAuthState(null), null); assert.equal(verifyOAuthState('a.b'), null);

  // Expired state.
  const expired = signOAuthState({ uid: 'user-a' }, -5).state;
  assert.equal(verifyOAuthState(expired), null, 'expired state');

  // A state signed under a different key does not verify.
  const other = signOAuthState({ uid: 'user-a' }).state;
  process.env.TOKEN_ENCRYPTION_KEY = 'z'.repeat(48);
  assert.equal(verifyOAuthState(other), null, 'wrong key');
  process.env.TOKEN_ENCRYPTION_KEY = 'k'.repeat(48);

  // With no key configured, signing fails closed (no hard-coded fallback).
  delete process.env.TOKEN_ENCRYPTION_KEY;
  assert.throws(() => signOAuthState({ uid: 'x' }));
  assert.equal(verifyOAuthState(state), null);
  process.env.TOKEN_ENCRYPTION_KEY = 'k'.repeat(48);

  assert.equal(nonceMatches(nonce, nonce), true);
  assert.equal(nonceMatches(nonce, 'other'), false);
  assert.equal(nonceMatches('', ''), false); assert.equal(nonceMatches(undefined, nonce), false);

  // ── M14: strict token decryption ───────────────────────────────────────────
  const enc = encryptToken('ya29.real-token');
  assert.equal(decryptToken(enc), 'ya29.real-token');
  assert.equal(decryptToken('ya29.plaintext-in-db'), '', 'plaintext is no longer passed through');
  assert.equal(decryptToken(enc.slice(0, -2) + (enc.endsWith('00') ? '11' : '00')), '', 'tampered ciphertext');
  assert.equal(decryptToken('not:enough'), '');
  assert.equal(decryptToken(''), '');

  // ── constant-time compare ──────────────────────────────────────────────────
  assert.equal(safeEqual('secret', 'secret'), true);
  assert.equal(safeEqual('secret', 'secreT'), false);
  assert.equal(safeEqual('secret', 'secret1'), false);
  assert.equal(safeEqual('', ''), false); assert.equal(safeEqual(null, 'x'), false); assert.equal(safeEqual('x', undefined), false);

  // ── block list key still dependency-free and stable ───────────────────────
  assert.equal(blockKey('(210) 555-0123'), '2105550123');

  console.log('security-fixes: all assertions passed');
})().catch(e => { console.error(e); process.exit(1); });
