// Email click-tracking (Resend → Amazon SES "awstrack") wraps every campaign link as
//   https://….awstrack.me/L0/<encoded target>/1/<message id>/<signature>=452
// Link scanners (Proofpoint, Microsoft Safe Links…) sometimes rewrite that and land on
// our page with the tail glued onto the last query value, e.g.
//   utm_content=fu-body-inline/1/010001a1…-000000/Lpl1zl…=452
// which splits attribution reports into one-off values. Strip the tail wherever it
// appears in a string. The pattern (16-hex SES id + UUID + "-000000" + signature) is
// specific enough that it can't match a real value.
const SES_TAIL = /\/\d\/0[0-9a-f]{15}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-0{6}(?:\/[A-Za-z0-9_\-+/]*=*\d*)?/gi;

export function stripClickTracking(v: string): string {
  return v.replace(SES_TAIL, '');
}
