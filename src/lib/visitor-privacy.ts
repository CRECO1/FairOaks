/**
 * Who may see that a contact is (or was) on our websites.
 *
 * Zack, Oct 2026: Brian must not see when a potential client is on the site — no alert emails, no phone pings, no
 * morning summary, no per-contact "Website activity", no timeline breadcrumbs. Only the account owner (super_admin)
 * does, the same boundary as the live feed, Lead Attribution and the traffic reports. Widen it here, once.
 */
export const canSeeVisitorActivity = (role: string | null | undefined): boolean => role === 'super_admin';

/** Timeline notes the known-contact alert writes onto a contact ("🔔 Website: …", "🌙 Website (after hours): …"). */
export const VISITOR_NOTE_LIKE = ['🔔 Website:%', '🌙 Website (after hours)%'];
export const isVisitorNote = (notes: string | null | undefined): boolean => /^(🔔 Website:|🌙 Website \(after hours\))/.test(notes ?? '');
