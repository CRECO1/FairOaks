'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, ArrowLeft, CheckCircle, Sparkles } from 'lucide-react';
import { trackQuizStart, trackQuizStep, trackQuizComplete, trackLead } from '@/lib/analytics';
import { Header, Footer } from '@/components/layout';
import { Button } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';
import { getRecaptchaToken } from '@/lib/recaptcha-client';
import { attributionPayload } from '@/lib/attribution';
import { Honeypot } from '@/components/Honeypot';
import { thankYouPath } from '@/lib/thank-you';
import { BrokerTrustCard } from '@/components/sections/BrokerTrustCard';

interface QuizStep {
  id: string;
  question: string;
  options: { label: string; value: string; emoji?: string }[];
  multi?: boolean;
}

const STEPS: QuizStep[] = [
  {
    id: 'buyer_type',
    question: "What brings you here today?",
    options: [
      { label: 'Buying my first home', value: 'first-time', emoji: '🏠' },
      { label: 'Moving up / upsizing', value: 'upsize', emoji: '⬆️' },
      { label: 'Downsizing', value: 'downsize', emoji: '⬇️' },
      { label: 'Investment property', value: 'investment', emoji: '💼' },
      { label: 'Relocating to the area', value: 'relocation', emoji: '📦' },
    ],
  },
  {
    id: 'timeline',
    question: "How soon are you looking to move?",
    options: [
      { label: 'ASAP (within 60 days)', value: 'asap', emoji: '🔥' },
      { label: '3–6 months', value: '3-6-months', emoji: '📅' },
      { label: '6–12 months', value: '6-12-months', emoji: '🗓️' },
      { label: 'Just exploring', value: 'exploring', emoji: '👀' },
    ],
  },
  {
    id: 'budget',
    question: "What's your home budget?",
    options: [
      { label: 'Under $400K', value: 'under-400k' },
      { label: '$400K – $600K', value: '400-600k' },
      { label: '$600K – $900K', value: '600-900k' },
      { label: '$900K – $1.2M', value: '900-1.2m' },
      { label: '$1.2M+', value: '1.2m-plus' },
      { label: 'Not sure yet', value: 'unsure' },
    ],
  },
  {
    id: 'bedrooms',
    question: "How many bedrooms do you need?",
    options: [
      { label: '2 bedrooms', value: '2' },
      { label: '3 bedrooms', value: '3' },
      { label: '4 bedrooms', value: '4' },
      { label: '5+ bedrooms', value: '5+' },
    ],
  },
  {
    id: 'priorities',
    question: "What matters most to you? (Select all that apply)",
    multi: true,
    options: [
      { label: 'Top-rated schools', value: 'schools', emoji: '🎓' },
      { label: 'Acreage / large lot', value: 'acreage', emoji: '🌿' },
      { label: 'Pool or outdoor living', value: 'pool', emoji: '🏊' },
      { label: 'Hill Country views', value: 'views', emoji: '⛰️' },
      { label: 'Close to SA / commute', value: 'commute', emoji: '🚗' },
      { label: 'New construction', value: 'new-build', emoji: '🏗️' },
      { label: 'Gated community', value: 'gated', emoji: '🔒' },
      { label: 'Single-story floor plan', value: 'single-story', emoji: '↔️' },
    ],
  },
  {
    id: 'area',
    question: "Do you have a preferred area?",
    options: [
      { label: 'Fair Oaks Ranch', value: 'fair-oaks-ranch' },
      { label: 'Boerne', value: 'boerne' },
      { label: 'Helotes', value: 'helotes' },
      { label: 'Leon Springs', value: 'leon-springs' },
      { label: 'Open to suggestions', value: 'open' },
    ],
  },
];

type Answers = Record<string, string | string[]>;

export default function QuizPage() {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Answers>({});
  const [contactStep, setContactStep] = useState(false);
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { trackQuizStart(STEPS.length); }, []);

  const current = STEPS[step];
  const progress = ((step + 1) / STEPS.length) * 100;

  function select(value: string) {
    if (current.multi) {
      const prev = (answers[current.id] as string[]) ?? [];
      const next = prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value];
      setAnswers(a => ({ ...a, [current.id]: next }));
    } else {
      setAnswers(a => ({ ...a, [current.id]: value }));
      trackQuizStep(step, value, current.id);
      if (step < STEPS.length - 1) {
        setTimeout(() => setStep(s => s + 1), 200);
      } else {
        setTimeout(() => setContactStep(true), 200);
      }
    }
  }

  function isSelected(value: string) {
    const v = answers[current.id];
    return Array.isArray(v) ? v.includes(value) : v === value;
  }

  async function handleContact(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Honeypot — read before the first await, while currentTarget still exists.
    const website = (new FormData(e.currentTarget).get('website') as string | null) || undefined;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/quiz/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...attributionPayload('quiz', { email, name }), recaptchaToken: await getRecaptchaToken('quiz_lead'), name, email, phone, answers, website }),
      });
      if (!res.ok) throw new Error(`quiz lead POST ${res.status}`);
      // Only show "Results On the Way" on a real success — a dropped submit used
      // to render the confirmation while the lead was never saved.
      trackQuizComplete();
      trackLead({ form_type: 'quiz' });
      router.push(thankYouPath('quiz'));
    } catch {
      setError('Something went wrong sending your answers. Please try again, or call or text us at 210-390-9997.');
    } finally {
      setLoading(false);
    }
  }

  if (contactStep) {
    return (
      <>
        <Header variant="minimal" />
        <main className="min-h-screen pt-20 bg-background-cream">
          <Container className="py-16">
            <div className="mx-auto max-w-lg">
              <div className="mb-8 text-center">
                <Sparkles className="mx-auto mb-4 h-10 w-10 text-gold" />
                <h2 className="font-heading text-display-sm font-bold text-primary mb-2">
                  Almost There!
                </h2>
                <p className="text-body text-foreground-muted">
                  Tell us how to reach you and we&apos;ll send personalized home recommendations.
                </p>
              </div>
              <BrokerTrustCard surface="quiz" className="mb-4" />
              <form onSubmit={handleContact} className="space-y-4 bg-white rounded-2xl shadow-card p-5 sm:p-8">
                <Honeypot />
                <div>
                  <label className="label-readable">Your Name *</label>
                  <input required value={name} onChange={e => setName(e.target.value)} placeholder="First & Last Name" className="w-full rounded-lg border border-border px-4 py-3 text-body-sm text-primary focus:outline-none focus:ring-2 focus:ring-gold" />
                </div>
                <div>
                  <label className="label-readable">Email Address *</label>
                  <input required type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" className="w-full rounded-lg border border-border px-4 py-3 text-body-sm text-primary focus:outline-none focus:ring-2 focus:ring-gold" />
                </div>
                <div>
                  <label className="label-readable">Phone (optional)</label>
                  <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="210-555-0000" className="w-full rounded-lg border border-border px-4 py-3 text-body-sm text-primary focus:outline-none focus:ring-2 focus:ring-gold" />
                </div>
                <p className="text-caption text-foreground-muted">
                  By submitting, you agree to be contacted by Fair Oaks Realty Group. We never share your information.
                </p>
                {error && <p role="alert" className="text-body-sm text-red-600">{error}</p>}
                <Button type="submit" size="lg" fullWidth loading={loading}>
                  Send My Recommendations
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Button>
              </form>
            </div>
          </Container>
        </main>
        <Footer />
      </>
    );
  }

  return (
    <>
      <Header variant="minimal" />
      <main className="min-h-screen pt-20 bg-background-cream">
        <Container className="py-12">
          <div className="mx-auto max-w-2xl">
            {/* Header */}
            <div className="mb-10 text-center">
              <p className="overline mb-2 text-gold">Home Finder Quiz</p>
              <h1 className="font-heading text-display-sm font-bold text-primary">Find Your Perfect Home</h1>
              <p className="mt-2 text-body text-foreground-muted">
                Question {step + 1} of {STEPS.length}
              </p>
            </div>

            {/* Progress */}
            <div className="mb-10 h-2 w-full rounded-full bg-border overflow-hidden">
              <div
                className="h-full rounded-full bg-gold transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>

            {/* Question */}
            <div className="bg-white rounded-2xl shadow-card p-5 sm:p-8">
              <h2 className="mb-6 sm:mb-8 font-heading text-heading-xl font-bold text-primary text-center">
                {current.question}
              </h2>

              <div className={`grid gap-3 ${current.options.length > 4 ? 'grid-cols-2' : 'grid-cols-1 sm:grid-cols-2'}`}>
                {current.options.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => select(opt.value)}
                    className={`rounded-xl border-2 p-4 text-left transition-all hover:border-gold hover:bg-gold/5 ${
                      isSelected(opt.value)
                        ? 'border-gold bg-gold/10 text-primary'
                        : 'border-border text-foreground-muted'
                    }`}
                  >
                    {opt.emoji && <span className="mr-2 text-xl">{opt.emoji}</span>}
                    <span className="text-body-sm font-medium">{opt.label}</span>
                    {isSelected(opt.value) && <CheckCircle className="float-right h-5 w-5 text-gold" />}
                  </button>
                ))}
              </div>

              {current.multi && (
                <div className="mt-6 text-center">
                  <Button
                    size="lg"
                    onClick={() => {
                      if (step < STEPS.length - 1) setStep(s => s + 1);
                      else setContactStep(true);
                    }}
                    disabled={!answers[current.id] || (answers[current.id] as string[]).length === 0}
                  >
                    Continue
                    <ArrowRight className="ml-2 h-5 w-5" />
                  </Button>
                </div>
              )}
            </div>

            {/* Nav */}
            {step > 0 && (
              <button
                onClick={() => setStep(s => s - 1)}
                className="mt-6 flex items-center gap-2 text-body-sm text-foreground-muted hover:text-primary transition-colors mx-auto"
              >
                <ArrowLeft className="h-4 w-4" /> Back
              </button>
            )}
          </div>
        </Container>
      </main>
      <Footer />
    </>
  );
}
