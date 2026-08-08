import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Welcome to VultStack',
  robots: { index: false, follow: false },
};

// Stripe redirects here after a successful checkout. Provisioning happens
// asynchronously via the webhook, so this page just confirms and points the
// new owner to their email for the set-password link.
export default function SignupPage() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0c0c0e',
        padding: '24px',
        fontFamily: 'Arial, sans-serif',
      }}
    >
      <div style={{ width: '100%', maxWidth: 480, textAlign: 'center' }}>
        <h1 style={{ fontFamily: 'Georgia, serif', color: '#fff', fontSize: 34, margin: 0 }}>
          Vult<span style={{ color: '#c9922c' }}>Stack</span>
        </h1>

        <div
          style={{
            marginTop: 28,
            background: '#16161a',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 16,
            padding: 32,
          }}
        >
          <div style={{ fontSize: 44, lineHeight: 1 }}>✓</div>
          <h2 style={{ color: '#fff', fontSize: 24, margin: '16px 0 8px' }}>
            Payment received
          </h2>
          <p style={{ color: '#cbd5e1', fontSize: 16, lineHeight: 1.6, margin: 0 }}>
            Your VultStack workspace is being set up. We just emailed you a link to
            <strong> set your password and log in</strong>. It can take a minute to
            arrive — check your inbox (and spam folder).
          </p>

          <a
            href="https://crm.vultstack.com/manage/login"
            style={{
              display: 'inline-block',
              marginTop: 28,
              background: '#c9922c',
              color: '#0c0c0e',
              padding: '14px 32px',
              borderRadius: 10,
              textDecoration: 'none',
              fontSize: 16,
              fontWeight: 700,
            }}
          >
            Go to login
          </a>
        </div>

        <p style={{ color: '#6b7280', fontSize: 13, marginTop: 20 }}>
          Didn&apos;t get the email? Contact{' '}
          <a href="mailto:vultstack@gmail.com" style={{ color: '#c9922c' }}>
            vultstack@gmail.com
          </a>
          .
        </p>
      </div>
    </main>
  );
}
