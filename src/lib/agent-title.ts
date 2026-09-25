/**
 * The professional title that renders in an email signature for `{{agent_title}}`.
 *
 * Titles follow the sender agent chosen on the campaign ("Send As"), so a signature
 * swaps in full when the sender changes:
 *   Zachary A. Stovall, Broker   ·   Brian Blanco, Associate   ·   Ed Blanco, Associate
 *
 * Derived from the CRM role rather than a stored column: the workspace owner
 * (super_admin) is the Broker; every other agent is an Associate. This is the
 * behaviour Zack asked for (2026-09-25) and needs no migration. If a second true
 * broker is ever added, give this a real `crm_profiles.title` column and read that
 * here instead — every send path already funnels through this one helper.
 */
export function agentTitle(role?: string | null): string {
  return role === 'super_admin' ? 'Broker' : 'Associate';
}
