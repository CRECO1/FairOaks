'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { needsSecondFactor } from '@/lib/mfa';
import type { DrivePerson } from './DocsDrive';

/**
 * The signed-in person for a standalone My Drive page (/crm/doc/<id>, /crm/form/<id>): the same cookie session the CRM uses, their profile and the team
 * list. 'out' = not signed in (or still owes the second factor), so the page sends them through the CRM sign-in and back.
 */
export interface CrmProfile { id: string; first_name?: string | null; last_name?: string | null; role?: string | null; business_unit?: string | null }
export function useCrmSession(bu: 'commercial' | 'residential') {
  const [state, setState] = useState<'loading' | 'out' | 'ready'>('loading');
  const [token, setToken] = useState<string | undefined>();
  const [me, setMe] = useState<CrmProfile | null>(null);
  const [people, setPeople] = useState<DrivePerson[]>([]);

  useEffect(() => {
    const supabase = createClient();
    let alive = true;
    supabase.auth.getSession().then(async ({ data }) => {
      const s = data.session;
      if (!alive) return;
      if (!s || needsSecondFactor(s.user, s.access_token)) { setState('out'); return; }
      setToken(s.access_token);
      const [{ data: mine }, { data: all }] = await Promise.all([
        supabase.from('crm_profiles').select('id,first_name,last_name,role,business_unit').eq('id', s.user.id).single(),
        supabase.from('crm_profiles').select('id,first_name,last_name,role').or(`business_unit.eq.${bu},role.eq.admin,role.eq.super_admin`).order('last_name'),
      ]);
      if (!alive) return;
      if (!mine) { setState('out'); return; }
      setMe(mine as CrmProfile); setPeople((all ?? []) as DrivePerson[]); setState('ready');
    }).catch(() => { if (alive) setState('out'); });
    // keep the token fresh (an hour-long session refreshes itself while the tab stays open)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => { if (s) setToken(s.access_token); });
    return () => { alive = false; subscription.unsubscribe(); };
  }, [bu]);

  return { state, token, me, people, isAdmin: me?.role === 'admin' || me?.role === 'super_admin' };
}
