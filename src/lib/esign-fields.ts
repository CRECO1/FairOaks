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
