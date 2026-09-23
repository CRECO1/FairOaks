/**
 * Honeypot field — invisible to humans, irresistible to dumb bots.
 *
 * Many spam-bot frameworks blindly fill every text input on a form. A hidden
 * field no real user can see or tab to gives a 95%+ accurate spam signal at
 * zero UX cost. Pairs with reCAPTCHA: reCAPTCHA scores sophisticated bots;
 * the honeypot catches the dumb majority cheaply, and works even when
 * reCAPTCHA isn't configured. Ported from the CRECO site's counterpart.
 *
 * Usage:
 *   <Honeypot />                              // in the form JSX
 *   const website = new FormData(form).get('website');
 *   if (website) return fake-success;         // server-side, in /api/leads
 */

interface Props {
  /** Field name. Innocuous-sounding so bots fill it. */
  name?: string;
}

export function Honeypot({ name = 'website' }: Props) {
  return (
    <div
      aria-hidden="true"
      style={{ position: 'absolute', left: '-9999px', width: '1px', height: '1px', overflow: 'hidden', opacity: 0, pointerEvents: 'none' }}
    >
      <label htmlFor={`hp-${name}`}>Don&apos;t fill this in if you&apos;re human:</label>
      <input type="text" id={`hp-${name}`} name={name} tabIndex={-1} autoComplete="off" />
    </div>
  );
}
