// Run:  npx tsx scripts/phish-check.test.ts
import assert from 'node:assert/strict';
import { assessEmail, looksSuspicious } from '../src/lib/phish-check';
const team = ['Robert Hamric', 'Zack Stovall'];
const bad = (x: Parameters<typeof assessEmail>[0]) => { const r = assessEmail({ teamNames: team, ...x }); assert.ok(looksSuspicious(r), JSON.stringify(r)); return r; };
const ok = (x: Parameters<typeof assessEmail>[0]) => { const r = assessEmail({ teamNames: team, ...x }); assert.ok(!looksSuspicious(r), JSON.stringify(r)); };

// The real one from 2026-11-17
const real = bad({ from: '"REQUIRES ACTION" <csmdmoore@comcast.net>', subject: 'Zack Stovall',
  text: "Hello Robert, What's the preferred number for me to text you at? I'll follow up shortly with further instruction. from a different number." });
assert.ok(real.reasons.length >= 2);
bad({ from: 'Zack Stovall <zstovall77@gmail.com>', subject: 'Quick favor', text: 'Are you available for a quick task? I need gift cards.' });
bad({ from: 'Billing <a@b-pay.net>', text: 'see', html: '<a href="http://evil.example.ru/x">www.chase.com/login</a>' });
bad({ from: 'Docs <a@b.com>', subject: 'Invoice', attachments: [{ name: 'invoice.pdf.exe' }] });
bad({ from: 'Jo <jo@acme.com>', replyTo: 'Jo <jo@acme-pay.ru>', text: 'Please update our bank details: new routing number', subject: 'x' });
// Ordinary mail stays quiet
ok({ from: 'Maria Lopez <maria@acmeretail.com>', subject: 'Re: lease', text: 'Can you call me at 210-555-0100 about the lease? Text me if easier.' });
ok({ from: 'Robert Hamric <robert@crecotx.com>', text: 'what number should I text you at' });
ok({ from: 'LoopNet <alerts@loopnet.com>', html: '<a href="https://www.loopnet.com/x">loopnet.com/x</a>', attachments: [{ name: 'flyer.pdf' }] });
ok({ from: 'Title Co <closing@alamotitle.com>', subject: 'Wire instructions', text: 'Attached are the closing documents.' });
// 2026-11-18: outside brokers' marketing blasts (Constant Contact) were flagged: Reply-To differs + tracked link text
const blast = { from: 'Zac Barfield | Legacy Commercial <zac-legacycommercialre.com@shared1.ccsend.com>', replyTo: 'zac@legacycommercialre.com', subject: 'Renovated 1,694 SF Office For Lease',
  text: 'Six office areas, lobby, kitchen', html: '<a href="https://r20.rs6.net/tn.jsp?f=abc">legacycommercialre.com</a>' };
ok({ ...blast, bulk: true });
ok({ ...blast });                                    // even without the bulk flag, a Constant Contact tracker link alone is fine
ok({ ...blast, html: '<a href="https://track.unknownesp.example/c/1">legacycommercialre.com</a>', bulk: true });
bad({ ...blast, text: 'Please wire the funds today, new routing number', bulk: true });   // hard signals still count in bulk mail
bad({ ...blast, html: '<a href="http://203.0.113.9/x">legacycommercialre.com</a>', bulk: true });
bad({ from: 'Billing <a@b-pay.net>', text: 'see', html: '<a href="http://evil.example.ru/x">www.chase.com/login</a>', replyTo: 'x@evil.ru' });   // personal mail still caught
console.log('phish-check: ok');
