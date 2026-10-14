/**
 * Who owns a lead that arrives by email (the website's alert emails, Crexi / LoopNet / CoStar
 * notifications).
 *
 * The email sync reads every connected inbox, and used to hand the contact to whichever inbox it
 * processed first — so the same lead was Brian's or Zack's depending on loop order (29 website
 * leads landed on Brian that way after the website routing had already been pointed at Zack).
 *
 * Rule (Zack, Oct 2026): every email lead comes to the broker (super_admin), who delegates from
 * there. The inbox that received it keeps visibility as a backup so nobody loses sight of a lead
 * they were copied on. If there is no super_admin the old rule applies (the inbox's owner).
 */
export interface OwnerProfile { id: string; role?: string | null }

export function emailLeadOwner(
  profiles: OwnerProfile[],
  inboxUserId: string,
): { ownerId: string; backupIds: string[] } {
  const broker = profiles.find(p => p.role === 'super_admin');
  const ownerId = broker?.id ?? inboxUserId;
  return { ownerId, backupIds: inboxUserId !== ownerId ? [inboxUserId] : [] };
}
