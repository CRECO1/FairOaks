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
  // Visually hidden with the sr-only clip pattern — zero layout footprint and NO
  // off-screen positioning. `left:-9999px` is a common honeypot style but iOS
  // Safari doesn't reliably clip it under body{overflow-x:hidden}, so it makes
  // the page pannable / "not scaling" on iPhones. This stays in the DOM (bots
  // still fill it) while never affecting the viewport.
  return (
    <div
      aria-hidden="true"
      style={{ position: 'absolute', width: '1px', height: '1px', padding: 0, margin: '-1px', overflow: 'hidden', clip: 'rect(0, 0, 0, 0)', whiteSpace: 'nowrap', border: 0 }}
    >
      <label htmlFor={`hp-${name}`}>Don&apos;t fill this in if you&apos;re human:</label>
      <input type="text" id={`hp-${name}`} name={name} tabIndex={-1} autoComplete="off" />
    </div>
  );
}
