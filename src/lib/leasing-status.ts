// Client-safe (no exceljs): the owner's wording for a prospect's stage and the colour chip it sits in.
export const STATUS_WORDS: Record<string, string> = { Prospect: 'Reviewing', 'Proposal Out': 'Submitted' };
export const exportStatus = (st: string) => STATUS_WORDS[st] ?? st;
export const STATUS_CHIP: Record<string, { fill: string; text: string }> = {
  Reviewing: { fill: 'FFD0E0F3', text: 'FF1F5FBF' },
  Submitted: { fill: 'FFA9C4E8', text: 'FF1A3E8C' },
  Touring: { fill: 'FFFFF2CC', text: 'FF7F6000' },
  'LOI Out': { fill: 'FFFCE5CD', text: 'FF8A4B08' },
  'Lease Out': { fill: 'FFD9EAD3', text: 'FF274E13' },
  Signed: { fill: 'FF93C47D', text: 'FF1F3D2E' },
  Passed: { fill: 'FFD9D2E9', text: 'FF4C3A7A' },
  Interested: { fill: 'FFB6D7A8', text: 'FF1F3D2E' },
  Contacted: { fill: 'FFEFEFEF', text: 'FF555555' },
  'Not contacted': { fill: 'FFFFFFFF', text: 'FF999999' },
};

