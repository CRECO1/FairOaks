'use client';

import React, { useEffect, useState } from 'react';
import GmailMailbox, { type ContactMatch } from './GmailMailbox';
import type { LiveMessage } from '@/lib/gmail-live';
import InboxSection from './InboxSection';
import DraftsSection from './DraftsSection';
import SentSection from './SentSection';
import type { EmailDraft } from '@/lib/email-drafts';
import type { InboxRow } from '@/lib/use-inbox';

// The Emails page: Inbox · Drafts · Sent, one place for all email work (the sidebar lists the three tabs under "Emails").

export type EmailsTab = 'inbox' | 'drafts' | 'sent';

type Props = {
  isMobile: boolean;
  tab: EmailsTab;
  setTab: (t: EmailsTab) => void;
  unread: number;
  draftCount: number;
  inbox: {
    rows: InboxRow[] | null; mine: (r: InboxRow) => boolean; isUnread: (r: InboxRow) => boolean; isDone: (r: InboxRow) => boolean;
    markRead: (ids: string[]) => void; markUnread: (ids: string[]) => void; setDoneIds: (ids: string[], on: boolean) => void;
    markAllRead: (rows: InboxRow[]) => void; reload: () => void;
  };
  myAddresses: string[];
  nameFor: (email: string) => string | undefined;
  dealLabel: (id: string) => string | null;
  clientLabel: (id: string) => string | null;
  onOpenDeal: (id: string) => void;
  onOpenContact: (id: string) => void;
  contactFor: (email: string) => ContactMatch;
  onLiveReply: (m: LiveMessage, threadId: string, all: boolean, account: string | null) => void;
  onLiveForward: (m: LiveMessage, threadId: string, account: string | null) => void;
  onCompose: () => void;
  notify: (msg: string) => void;
  onAddContact: (email: string, name: string) => Promise<boolean>;
  onInboxReply: (r: InboxRow, all: boolean) => void;
  canInboxReplyAll: (r: InboxRow) => boolean;
  onResumeDraft: (d: EmailDraft) => void;
};

export default function EmailsSection(p: Props) {
  // Inbox and Sent can show your real Gmail ("All mail", the default) or only what the CRM filed / tracked.
  const [source, setSourceState] = useState<'gmail' | 'crm'>('gmail');
  useEffect(() => { try { if (localStorage.getItem('crm-emails-source') === 'crm') setSourceState('crm'); } catch { /* ignore */ } }, []);
  const setSource = (v: 'gmail' | 'crm') => { setSourceState(v); try { localStorage.setItem('crm-emails-source', v); } catch { /* ignore */ } };
  const toggle = (gmailLabel: string, crmLabel: string) => (
    <div role="group" aria-label="Mail source" style={{ display: 'inline-flex', padding: 3, gap: 2, background: 'var(--k-f3f4f6)', borderRadius: 10, marginBottom: 14 }}>
      {([['gmail', gmailLabel], ['crm', crmLabel]] as const).map(([v, l]) => (
        <button key={v} type="button" onClick={() => setSource(v)} aria-pressed={source === v}
          style={{ padding: p.isMobile ? '9px 14px' : '6px 14px', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", background: source === v ? 'var(--k-fff)' : 'transparent', color: source === v ? 'var(--k-111)' : 'var(--k-6b7280)', boxShadow: source === v ? '0 1px 2px rgba(0,0,0,.08)' : 'none' }}>{l}</button>
      ))}
    </div>
  );
  const tabs: Array<[EmailsTab, string, number]> = [['inbox', 'Inbox', p.unread], ['drafts', 'Drafts', p.draftCount], ['sent', 'Sent', 0]];
  return (
    <div style={{ maxWidth: source === 'gmail' && p.tab !== 'drafts' ? 1400 : 980, margin: '0 auto', padding: p.isMobile ? '12px 12px 96px' : '20px 24px 48px' }}>
      <div role="tablist" aria-label="Emails" className="crm-tabs-scroll" style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--k-e5e7eb)', marginBottom: 16, overflowX: 'auto' }}>
        {tabs.map(([id, label, n]) => {
          const on = p.tab === id;
          return (
            <button key={id} role="tab" aria-selected={on} onClick={() => p.setTab(id)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: p.isMobile ? '12px 16px' : '10px 16px', minHeight: p.isMobile ? 46 : 40, background: 'none', border: 'none', borderBottom: `2px solid ${on ? '#c9922c' : 'transparent'}`, marginBottom: -1, cursor: 'pointer', fontSize: 14.5, fontWeight: on ? 700 : 600, color: on ? 'var(--k-111)' : 'var(--k-6b7280)', fontFamily: "'DM Sans',sans-serif", whiteSpace: 'nowrap' }}>
              {label}
              {n > 0 && <span style={{ background: id === 'inbox' ? '#c9922c' : 'var(--k-e5e7eb)', color: id === 'inbox' ? '#fff' : 'var(--k-374151)', fontSize: 11, fontWeight: 700, padding: '0 7px', borderRadius: 10, lineHeight: '18px' }}>{n}</span>}
            </button>
          );
        })}
      </div>

      {p.tab === 'inbox' && (
        <>
          {toggle('All mail', 'CRM replies')}
          {source === 'gmail'
            ? <GmailMailbox box="inbox" isMobile={p.isMobile} contactFor={p.contactFor} onOpenDeal={p.onOpenDeal} onOpenContact={p.onOpenContact} onReply={p.onLiveReply} onForward={p.onLiveForward} onNewCompose={p.onCompose} notify={p.notify} onAddContact={p.onAddContact} />
            : <InboxSection isMobile={p.isMobile} {...p.inbox} nameFor={p.nameFor} dealLabel={p.dealLabel} clientLabel={p.clientLabel} onOpenDeal={p.onOpenDeal} onOpenContact={p.onOpenContact} onReply={p.onInboxReply} canReplyAll={p.canInboxReplyAll} />}
        </>
      )}
      {p.tab === 'drafts' && <DraftsSection isMobile={p.isMobile} onResume={p.onResumeDraft} />}
      {p.tab === 'sent' && (
        <>
          {toggle('All sent', 'Tracked opens')}
          {source === 'gmail'
            ? <GmailMailbox box="sent" isMobile={p.isMobile} contactFor={p.contactFor} onOpenDeal={p.onOpenDeal} onOpenContact={p.onOpenContact} onReply={p.onLiveReply} onForward={p.onLiveForward} onNewCompose={p.onCompose} notify={p.notify} onAddContact={p.onAddContact} />
            : <SentSection embedded isMobile={p.isMobile} myAddresses={p.myAddresses} nameFor={p.nameFor} dealLabel={p.dealLabel} clientLabel={p.clientLabel} onOpenDeal={p.onOpenDeal} onOpenContact={p.onOpenContact} />}
        </>
      )}
    </div>
  );
}
