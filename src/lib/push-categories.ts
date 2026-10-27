/** Which kinds of phone alert exist. Client-safe (no server imports) so the settings UI and the sender share one list. */
export type PushCategory = 'mentions' | 'leads' | 'calls' | 'signatures' | 'visitors';
export const PUSH_CATEGORIES: { key: PushCategory; label: string; hint: string; on: boolean }[] = [
  { key: 'mentions', label: 'Tags & assignments', hint: 'Someone @mentions you or hands you a task or call list', on: true },
  { key: 'leads', label: 'New leads', hint: 'A website, email or phone lead lands on you', on: true },
  { key: 'calls', label: 'Calls & voicemails', hint: 'The bot or a voicemail captured someone who wants a callback', on: true },
  { key: 'signatures', label: 'Signatures', hint: 'A document was signed, or is fully signed', on: true },
  { key: 'visitors', label: 'Contacts on the website', hint: 'A contact you know taps to call or downloads something (can be chatty)', on: false },
];
export const DEFAULT_PUSH_CATEGORIES: PushCategory[] = PUSH_CATEGORIES.filter(c => c.on).map(c => c.key);
