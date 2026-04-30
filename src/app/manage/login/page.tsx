'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Eye, EyeOff, Lock } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { signIn } from '@/lib/auth';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get('redirect') ?? '/manage';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await signIn(email, password);
      router.push(redirect);
    } catch {
      setError('Invalid email or password. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background-cream p-6">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="mb-10 text-center">
          <span className="font-heading text-2xl font-bold tracking-tight text-primary">
            Fair Oaks <span className="text-gold">Realty Group</span>
          </span>
          <p className="mt-2 text-body-sm text-foreground-muted">Team Portal</p>
        </div>

        {/* Card */}
        <div className="rounded-2xl bg-white p-8 shadow-card">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gold/20">
              <Lock className="h-5 w-5 text-gold-dark" />
            </div>
            <h1 className="font-heading text-heading-xl font-bold text-primary">Sign In</h1>
          </div>

          {error && (
            <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-body-sm text-destructive">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label-readable">Email Address</label>
              <input
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@fairoaksrealtygroup.com"
                className="w-full rounded-lg border border-border px-4 py-3 text-body-sm text-primary focus:outline-none focus:ring-2 focus:ring-gold"
                autoComplete="email"
              />
            </div>
            <div>
              <label className="label-readable">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-lg border border-border px-4 py-3 pr-12 text-body-sm text-primary focus:outline-none focus:ring-2 focus:ring-gold"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-foreground-muted hover:text-primary transition-colors"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </div>
            <Button type="submit" size="lg" fullWidth loading={loading} className="mt-2">
              Sign In
            </Button>
          </form>
        </div>

        <p className="mt-6 text-center text-caption text-foreground-muted">
          Need access?{' '}
          <a href="mailto:info@fairoaksrealtygroup.com" className="text-gold hover:underline">
            Contact your administrator
          </a>
        </p>
      </div>
    </main>
  );
}

export default function ManageLoginPage() {
  return (
    <Suspense fallback={
      <main className="flex min-h-screen items-center justify-center bg-background-cream">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-gold border-t-transparent" />
      </main>
    }>
      <LoginForm />
    </Suspense>
  );
}
