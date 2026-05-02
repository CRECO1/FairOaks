'use client';

import { useRouter } from 'next/navigation';

export default function CRMLanding() {
  const router = useRouter();

  const units = [
    {
      key: 'residential',
      name: 'Fair Oaks Realty Group',
      tagline: 'Residential CRM',
      description: 'Buyers, sellers, listings & residential campaigns',
      icon: '🏡',
      href: '/crm/residential',
    },
    {
      key: 'commercial',
      name: 'CRECO',
      tagline: 'Commercial CRM',
      description: 'Tenants, landlords, investors & commercial campaigns',
      icon: '🏢',
      href: '/crm/commercial',
    },
  ] as const;

  return (
    <div style={{
      minHeight: '100vh',
      background: '#111',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: "'DM Sans', sans-serif",
      padding: '40px 20px',
    }}>
      <div style={{ textAlign: 'center', marginBottom: 48 }}>
        <div style={{
          fontFamily: "'Cormorant Garamond', serif",
          fontSize: 36,
          fontWeight: 700,
          color: '#c9922c',
          marginBottom: 8,
        }}>
          Brokerage CRM
        </div>
        <div style={{ fontSize: 14, color: 'rgba(255,255,255,.45)', letterSpacing: 2, textTransform: 'uppercase' }}>
          Select your workspace
        </div>
      </div>

      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', justifyContent: 'center', maxWidth: 700 }}>
        {units.map(u => (
          <button
            key={u.key}
            onClick={() => router.push(u.href)}
            style={{
              width: 300,
              background: 'rgba(255,255,255,.04)',
              border: '1px solid rgba(201,146,44,.3)',
              borderRadius: 16,
              padding: '36px 32px',
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'all .2s',
              fontFamily: "'DM Sans', sans-serif",
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLButtonElement).style.background = 'rgba(201,146,44,.1)';
              (e.currentTarget as HTMLButtonElement).style.borderColor = '#c9922c';
              (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-2px)';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,.04)';
              (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(201,146,44,.3)';
              (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)';
            }}
          >
            <div style={{ fontSize: 36, marginBottom: 16 }}>{u.icon}</div>
            <div style={{
              fontFamily: "'Cormorant Garamond', serif",
              fontSize: 22,
              fontWeight: 700,
              color: '#c9922c',
              marginBottom: 4,
            }}>
              {u.name}
            </div>
            <div style={{
              fontSize: 10,
              letterSpacing: 2,
              textTransform: 'uppercase',
              color: 'rgba(255,255,255,.35)',
              marginBottom: 14,
            }}>
              {u.tagline}
            </div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,.5)', lineHeight: 1.5 }}>
              {u.description}
            </div>
            <div style={{
              marginTop: 24,
              fontSize: 12,
              color: '#c9922c',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}>
              Enter workspace →
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
