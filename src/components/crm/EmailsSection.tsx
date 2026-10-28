'use client';

import React from 'react';
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
  onInboxReply: (r: InboxRow, all: boolean) => void;
  canInboxReplyAll: (r: InboxRow) => boolean;
  onResumeDraft: (d: EmailDraft) => void;
};

export default function EmailsSection(p: Props) {
  const tabs: Array<[EmailsTab, string, number]> = [['inbox', 'Inbox', p.unread], ['drafts', 'Drafts', p.draftCount], ['sent', 'Sent', 0]];
  return (
    <div style={{ maxWidth: 980, margin: '0 auto', padding: p.isMobile ? '12px 12px 96px' : '20px 24px 48px' }}>
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
        <InboxSection isMobile={p.isMobile} {...p.inbox} nameFor={p.nameFor} dealLabel={p.dealLabel} clientLabel={p.clientLabel} onOpenDeal={p.onOpenDeal} onOpenContact={p.onOpenContact} onReply={p.onInboxReply} canReplyAll={p.canInboxReplyAll} />
      )}
      {p.tab === 'drafts' && <DraftsSection isMobile={p.isMobile} onResume={p.onResumeDraft} />}
      {p.tab === 'sent' && (
        <SentSection embedded isMobile={p.isMobile} myAddresses={p.myAddresses} nameFor={p.nameFor} dealLabel={p.dealLabel} clientLabel={p.clientLabel} onOpenDeal={p.onOpenDeal} onOpenContact={p.onOpenContact} />
      )}
    </div>
  );
}
