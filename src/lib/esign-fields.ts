// Which placed fields belong to a signer.
//
// Signature-family spots (signature / initials / date) always belong to someone; older
// documents placed them before per-signer assignment existed, so those fall back to the
// client role.
//
// Text and checkbox fields are different: a template's blanks (a TREC contract has
// hundreds) are filled by the broker BEFORE sending, and are already stamped into the
// PDF that gets sent. Only a text/checkbox field the agent explicitly assigned to a
// signer in the composer is an input for that signer. Treating an unassigned one as the
// client's made every empty optional blank a required client input — a contract with
// unticked optional boxes could not be signed — and re-stamped the broker's values a
// second time on the executed copy.
const INPUT_TYPES = new Set(['text', 'check']);

export function isBrokerFilled(f: { type?: unknown; signerRole?: unknown; signerIndex?: unknown; signerKey?: unknown }): boolean {
  return INPUT_TYPES.has(String(f.type)) && !f.signerIndex && !f.signerRole && !f.signerKey;
}

/** Placed spots that carry a person's email AND a position, but the signer at that position is somebody else. `emailsInOrder` = the request's signers' emails, lowercase, by signing position (1-based in the spots). */
export function spotsOutOfLine<T extends { signerEmail?: unknown; signerIndex?: unknown }>(spots: T[], emailsInOrder: string[]): T[] {
  return spots.filter(f => f && f.signerEmail && f.signerIndex && emailsInOrder[Number(f.signerIndex) - 1] !== String(f.signerEmail).trim().toLowerCase());
}
