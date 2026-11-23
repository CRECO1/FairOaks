// Run: npx tsx scripts/esign-email-check.test.ts
import { emailProblem, emailWarning } from '../src/lib/esign-email-check';
let bad = 0;
const t = (name: string, ok: boolean) => { if (!ok) { bad++; console.error('FAIL', name); } else console.log('ok  ', name); };
t('plain address passes', emailProblem('jane@acme.com') === null && emailWarning('jane@acme.com') === null);
t('empty is not a problem (just not filled in)', emailProblem('') === null && emailWarning('  ') === null);
t('no @ is a problem', !!emailProblem('jane.acme.com'));
t('no dot in domain is a problem', !!emailProblem('jane@acme'));
t('two addresses is a problem', !!emailProblem('a@b.com, c@d.com'));
t('space inside is a problem', !!emailProblem('jane @acme.com'));
t('.invalid placeholder warns', !!emailWarning('test@example.invalid'));
t('example.com warns', !!emailWarning('jane@example.com'));
t('noreply warns', !!emailWarning('noreply@acme.com'));
t('gmial.com suggests gmail', /jane@gmail\.com/.test(emailWarning('jane@gmial.com') ?? ''));
t('.con ending warns', !!emailWarning('jane@acme.con'));
t('plus addressing is fine', emailProblem('jane+deal@acme.co') === null && emailWarning('jane+deal@acme.co') === null);
console.log(bad ? `\n${bad} failed` : '\nall passed'); process.exit(bad ? 1 : 0);
