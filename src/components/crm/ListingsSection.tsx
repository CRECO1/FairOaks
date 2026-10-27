'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { recallView, rememberView, useRememberedSelection } from '@/lib/view-memory';
import TransactionDocEditor from '@/components/crm/TransactionDocEditor';
import LoiBuilder from '@/components/crm/LoiBuilder';
import EmailDocDialog from '@/components/crm/EmailDocDialog';
import { specForForm, type LoiSpec } from '@/lib/loi-spec';
import DocPreviewModal from '@/components/crm/DocPreviewModal';
import SignPreviewModal from '@/components/crm/SignPreviewModal';
import { defaultEsignMessage } from '@/lib/esign-message';
import RentRoll from '@/components/crm/RentRoll';
import MentionTextarea, { parseMentionIds, parseMentionContactIds } from '@/components/crm/MentionTextarea';
import LeasingActivity from '@/components/crm/LeasingActivity';
import EmailProspects from '@/components/crm/EmailProspects';
import PropertyPerformance from '@/components/crm/PropertyPerformance';
import { useDragScroll } from '@/lib/use-drag-scroll';
import CamReconciliation from '@/components/crm/CamReconciliation';
import LeaseDraftModal, { type LeaseDraftValues } from '@/components/crm/LeaseDraftModal';
import Skeleton from '@/components/crm/Skeleton';

// Forms whose form_code opens the dynamic term-list builder instead of the
// coordinate-overlay editor.

// ── Types ────────────────────────────────────────────────────────────────────

interface Listing {
  id: string;
  business_unit: string;
  tagged_contact_ids?: string[];
  name: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  type?: string;
  status?: string;
  asking_price?: number | null;
  sq_ft?: number | null;
  lot_size?: string;
  year_built?: string;
  description?: string;
  notes?: string;
  highlights?: string | null;
  flyer_headline?: string | null;
  zoning?: string | null;
  elevator?: boolean | null;
  grade_level_doors?: boolean | null;
  dock_high_doors?: boolean | null;
  flyer_type?: string | null;
  flyer_path?: string | null;
  flyer_generated_at?: string | null;
  co_agent_id?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  listing_agent_id?: string;
  assigned_agent_ids?: string[];
  is_restricted?: boolean;
  created_at: string;
  updated_at?: string;
}

interface ListingFile {
  id: string;
  listing_id: string;
  name: string;
  file_type?: string;
  file_size?: number;
  category: string;
  created_at: string;
  sort_order?: number | null;
  url?: string;
}

interface Profile { id: string; first_name: string; last_name: string; role?: string; }

interface Contact { id: string; first_name: string; last_name: string; business_name?: string; email?: string; phone?: string; cell_phone?: string; type?: string }
interface ListingContact { id: string; role?: string; client_id: string; crm_clients?: Contact | null }

interface Deal {
  id: string; client: string; client_email?: string | null; client_phone?: string | null;
  client_id?: string | null; type?: string; property?: string; value?: number | null;
  stage?: string; agent_id?: string | null; listing_id?: string | null; business_unit?: string;
  created_at?: string; last_touch?: string;
}
const DEAL_TYPES = ['Tenant Lease', 'Buyer Purchase', 'Landlord Listing', 'Seller Listing'];
const DEAL_STAGES = ['Prospect', 'Active', 'LOI', 'In Contract', 'Closed', 'Lost'];
const STAGE_CHIP: Record<string, { bg: string; color: string }> = {
  Prospect: { bg: 'var(--k-f1f5f9)', color: 'var(--k-475569)' }, Active: { bg: 'var(--k-dbeafe)', color: 'var(--k-1d4ed8)' },
  LOI: { bg: 'var(--k-fef3c7)', color: 'var(--k-b45309)' }, 'In Contract': { bg: 'var(--k-e0e7ff)', color: 'var(--k-4338ca)' },
  Closed: { bg: 'var(--k-dcfce7)', color: 'var(--k-15803d)' }, Lost: { bg: 'var(--k-fee2e2)', color: 'var(--k-dc2626)' },
};
interface EnvSigner { id: string; signer_role: string; name: string; email: string; signing_order: number; status: string; signed_at?: string | null; viewed_at?: string | null }
interface Envelope { id: string; submission_id?: string | null; status: string; executed_url?: string | null; crm_envelope_signers?: EnvSigner[] }

interface Props {
  businessUnit: string;
  isAdmin: boolean;
  authToken?: string;
  profiles: Profile[];
  clients: Contact[];
  onToast: (msg: string) => void;
  // Opens the envelope composer to import an outside PDF and send it for signature
  // on THIS property (the created document is linked to the listing). Without it the
  // property can only send documents that started as filled CRM forms / leases.
  onAddDocument?: (listingId: string) => void;
  // "Send for signature" on an already-uploaded property file (a PDF): the parent
  // pulls its bytes into the composer, pre-linked to this listing.
  onSignFile?: (url: string, name: string, listingId: string) => void;
  // Bumped by the parent after the composer sends, so a newly-imported document
  // appears in the property's Transaction Docs list without reopening the panel.
  reloadSignal?: number;
  // A teammate was @-tagged in a note on this property (Internal Notes, Rent Roll notes). The parent
  // writes the bell notification: (ids, "mentioned you in …", entity type, entity id).
  onMention?: (ids: string[], message: string, entityType: string, entityId?: string) => void;
}

// ── Constants ────────────────────────────────────────────────────────────────

const TYPES = ['Retail', 'Office', 'Industrial', 'Land', 'Multifamily', 'Mixed-Use', 'Medical', 'Flex'];
const STATUSES = ['active', 'pending', 'leased', 'sold', 'off_market'];

const STATUS_CFG: Record<string, { label: string; bg: string; color: string }> = {
  active:     { label: 'Active',     bg: 'var(--k-dcfce7)', color: 'var(--k-15803d)' },
  pending:    { label: 'Pending',    bg: 'var(--k-fef3c7)', color: 'var(--k-b45309)' },
  leased:     { label: 'Leased',     bg: 'var(--k-dbeafe)', color: 'var(--k-1d4ed8)' },
  sold:       { label: 'Sold',       bg: '#f3e8ff', color: '#7e22ce' },
  off_market: { label: 'Off Market', bg: 'var(--k-f1f5f9)', color: 'var(--k-64748b)' },
};

const CATEGORIES = [
  { key: 'floor_plan', label: '📐 Floor Plans' },
  { key: 'photo',      label: '📷 Photos' },
  { key: 'brochure',   label: '📄 Brochures' },
  { key: 'document',   label: '📎 Documents' },
];

const TYPE_COLORS: Record<string, { bg: string; color: string }> = {
  Retail:      { bg: 'var(--k-fef3c7)', color: 'var(--k-b45309)' },
  Office:      { bg: 'var(--k-dbeafe)', color: 'var(--k-1d4ed8)' },
  Industrial:  { bg: 'var(--k-f1f5f9)', color: 'var(--k-475569)' },
  Land:        { bg: 'var(--k-dcfce7)', color: 'var(--k-15803d)' },
  Multifamily: { bg: '#f3e8ff', color: '#7e22ce' },
  'Mixed-Use': { bg: '#fce7f3', color: 'var(--k-be185d)' },
  Medical:     { bg: 'var(--k-cffafe)', color: 'var(--k-0e7490)' },
  Flex:        { bg: 'var(--k-fff7ed)', color: 'var(--k-c2410c)' },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt$(n?: number | null) {
  if (!n) return '—';
  return n >= 1_000_000
    ? `$${(n / 1_000_000).toFixed(2)}M`
    : `$${Number(n).toLocaleString()}`;
}

function fmtSqFt(n?: number | null) {
  if (!n) return '—';
  return `${Number(n).toLocaleString()} SF`;
}

function fileIcon(type?: string, cat?: string) {
  if (cat === 'floor_plan') return '📐';
  if (cat === 'photo') return '📷';
  if (cat === 'brochure') return '📄';
  if (type?.includes('pdf')) return '📕';
  if (type?.includes('image')) return '🖼️';
  if (type?.includes('sheet') || type?.includes('excel') || type?.includes('csv')) return '📊';
  if (type?.includes('word') || type?.includes('doc')) return '📝';
  return '📎';
}

function fmtBytes(n?: number | null) {
  if (!n) return '';
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

// ── Blank forms ──────────────────────────────────────────────────────────────

const BLANK_FORM = {
  name: '', address: '', city: '', state: 'TX', zip: '',
  type: 'Retail', status: 'active', asking_price: '', sq_ft: '',
  lot_size: '', year_built: '', description: '', notes: '', highlights: '', flyer_headline: '', listing_agent_id: '', co_agent_id: '', flyer_type: '', map_pin: '',
  zoning: '', elevator: '', grade_level_doors: '', dock_high_doors: '',
};

// Signer-role options (shared by the send modal's role picker + placed-field labels).
const SIGNER_ROLES: [string, string][] = [['client', 'Client'], ['landlord', 'Landlord'], ['agent', 'Agent'], ['seller', 'Seller'], ['buyer', 'Buyer'], ['witness', 'Witness'], ['other', 'Other']];
const roleLabel = (r: string) => SIGNER_ROLES.find(([v]) => v === r)?.[1] || (r ? r[0].toUpperCase() + r.slice(1) : 'Signer');
const fieldTypeLabel = (t: string) => t === 'signature' ? 'Signature' : t === 'initial' ? 'Initials' : t === 'date' ? 'Date' : t.charAt(0).toUpperCase() + t.slice(1);

// ── Main component ────────────────────────────────────────────────────────────

export default function ListingsSection({ businessUnit, isAdmin, authToken, profiles, clients, onToast, onAddDocument, onSignFile, reloadSignal, onMention }: Props) {
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState('');
  const [typeFilter, setTypeFilter]     = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Detail panel
  const [active, setActive]     = useState<Listing | null>(null);
  // Guards cross-listing races: openListing sets this to the listing being
  // opened; each async loader drops its response if a different (or no) listing
  // is active by the time it resolves — so A's docs/deals/envelopes can't paint
  // into B's panel.
  const activeListingIdRef = useRef<string | null>(null);
  const [activeTab, setActiveTab] = useState<'info' | 'performance' | 'documents' | 'rentroll' | 'leasing' | 'recon' | 'prospects' | 'deals' | 'photos' | 'contacts' | 'team'>('info');
  const [editForm, setEditForm] = useState<typeof BLANK_FORM>(BLANK_FORM);
  const [dirty, setDirty]       = useState(false);

  // Files
  const [files, setFiles]           = useState<ListingFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [uploading, setUploading]   = useState(false);
  const [uploadCat, setUploadCat]   = useState('document');   // 'document' is the common case — it used to default to Floor Plans
  const fileInputRef                = useRef<HTMLInputElement>(null);

  // New listing modal
  const [showNew, setShowNew] = useState(false);
  const [newForm, setNewForm] = useState<typeof BLANK_FORM>(BLANK_FORM);
  const [creating, setCreating] = useState(false);

  // Transaction-doc forms in the open listing's folder.
  interface FormTemplate { id: string; name: string; form_code?: string; category?: string; pinned?: boolean }
  interface FormSubmission { id: string; form_id?: string; deal_id?: string | null; title?: string; url?: string | null; updated_at?: string; crm_forms?: { name?: string; form_code?: string } | null }
  const [crmForms, setCrmForms] = useState<FormTemplate[]>([]);
  const [listingForms, setListingForms] = useState<FormSubmission[]>([]);
  const [formPicker, setFormPicker] = useState(false);
  // Per-deal "add a form" dropdown on the Deals tab (mirrors the deal Docs tab).
  const [dealFormPick, setDealFormPick] = useState<Record<string, string>>({});
  const [dealFormAdding, setDealFormAdding] = useState<string | null>(null);
  const [editorDoc, setEditorDoc] = useState<{ id: string; name: string; url: string; submissionId?: string } | null>(null);
  const [loiDoc, setLoiDoc] = useState<{ formId: string; name: string; submissionId?: string; spec: LoiSpec } | null>(null);

  // Team / sharing state for the open listing.
  const [teamOwner, setTeamOwner] = useState('');
  const [teamAssigned, setTeamAssigned] = useState<string[]>([]);
  const [teamRestricted, setTeamRestricted] = useState(false);
  const [teamSaving, setTeamSaving] = useState(false);

  // Contacts linked to the open listing.
  const [listingContacts, setListingContacts] = useState<ListingContact[]>([]);
  const [contactSearch, setContactSearch] = useState('');
  const [contactRole, setContactRole] = useState('Landlord');
  const [addingContact, setAddingContact] = useState(false);
  const [flyerBusy, setFlyerBusy] = useState(false);

  // Deals-at-this-property tab
  const [deals, setDeals] = useState<Deal[]>([]);
  const [dealForms, setDealForms] = useState<Record<string, FormSubmission[]>>({});
  const [allDeals, setAllDeals] = useState<Deal[]>([]);
  const [showNewDeal, setShowNewDeal] = useState(false);
  const [showLinkDeal, setShowLinkDeal] = useState(false);
  const [linkSearch, setLinkSearch] = useState('');
  const [dealClientSearch, setDealClientSearch] = useState('');
  const [newDeal, setNewDeal] = useState({ client: '', client_email: '', client_phone: '', client_id: '', type: 'Tenant Lease', stage: 'Prospect' });
  const [dealBusy, setDealBusy] = useState(false);
  const [formDealId, setFormDealId] = useState<string | null>(null); // which deal a form editor is bound to
  const [envMap, setEnvMap] = useState<Record<string, Envelope>>({}); // submission_id -> envelope
  const [sendModal, setSendModal] = useState<{ submissionId: string; dealId?: string | null; title: string; formId?: string; url?: string | null } | null>(null);
  // Held while the agent steps out to place signature fields, so the signer list they
  // just typed is still there when they come back.
  const [pendingSend, setPendingSend] = useState<{ submissionId: string; dealId?: string | null; title: string; formId?: string; signers: { role: string; name: string; email: string }[]; msg: string } | null>(null);
  const [sendPreview, setSendPreview] = useState(false);
  const [sendSigFields, setSendSigFields] = useState<number | null>(null);
  // Placed signature fields, grouped by their ORIGINAL role (the immutable key back to
  // the stored field). `role` is the editable target so a block can be reassigned to a
  // different party; `keep=false` drops it. Persisted to the submission on send.
  const [sendFieldGroups, setSendFieldGroups] = useState<{ origRole: string; role: string; types: string[]; keep: boolean }[]>([]);
  const [sendValues, setSendValues] = useState<Array<Record<string, unknown>>>([]);
  const [previewFile, setPreviewFile] = useState<{ url: string; name: string; type?: string | null } | null>(null);
  // Which document row is being renamed, and the draft name in the box.
  // Whether the API will serve this caller the rent roll at all — the same probe
  // gates both the Rent Roll and Reconciliation tabs, so a hidden tab and a refused
  // request can never disagree.
  const [canSeeRentRoll, setCanSeeRentRoll] = useState(false);
  const [hasRentRoll, setHasRentRoll] = useState(false);
  const [draftingLease, setDraftingLease] = useState(false);
  const [renamingDoc, setRenamingDoc] = useState<string | null>(null);
  const [docMenu, setDocMenu] = useState<string | null>(null);
  const [dropOver, setDropOver] = useState(false);   // a file is being dragged over the upload area   // which document row's ⋯ menu is open
  const [renameDraft, setRenameDraft] = useState('');
  const [sendSigners, setSendSigners] = useState<{ role: string; name: string; email: string }[]>([]);
  const [sendPick, setSendPick] = useState<number | null>(null); // signer row showing contact suggestions
  const [sendMsg, setSendMsg] = useState('');
  const [sendBusy, setSendBusy] = useState(false);
  const [emailDocId, setEmailDocId] = useState<string | null>(null);
  const [showMoreForms, setShowMoreForms] = useState(false);
  const [formSearch, setFormSearch] = useState('');   // the library is long — let agents type to find a form

  // Memoised on the token: callbacks list authHeaders as a dependency, and a fresh object each render
  // re-created all of them (and any effect built on them) on every keystroke.
  const authHeaders = useMemo<Record<string, string>>(() => {
    const h: Record<string, string> = {};
    if (authToken) h.Authorization = `Bearer ${authToken}`;
    return h;
  }, [authToken]);
  // The property card's tab row: drag it with the mouse as well as scrolling it.
  const tabDrag = useDragScroll<HTMLDivElement>();

  // ── Load ────────────────────────────────────────────────────────────────────

  const loadListings = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/crm/listings?business_unit=${businessUnit}`, { headers: authHeaders });
    const json = await res.json();
    setListings(json.listings ?? []);
    setLoading(false);
  }, [businessUnit, authToken]); // eslint-disable-line

  useEffect(() => { loadListings(); }, [loadListings]);

  // 30-day web performance per property, shown as a chip on each card. Best effort: no chip if it fails.
  const [perfById, setPerfById] = useState<Record<string, { real: number; inquiries: number }>>({});
  useEffect(() => {
    if (!listings.length) return;
    let live = true;
    fetch(`/api/crm/property-performance?days=30&unit=${businessUnit}`, { headers: authHeaders })
      .then(r => (r.ok ? r.json() : null))
      .then(j => {
        if (!live || !j?.rows) return;
        const m: Record<string, { real: number; inquiries: number }> = {};
        for (const r of j.rows as { listingId: string; real: number; inquiries: number }[]) m[r.listingId] = { real: r.real, inquiries: r.inquiries };
        setPerfById(m);
      })
      .catch(() => {});
    return () => { live = false; };
  }, [listings.length, businessUnit, authToken]); // eslint-disable-line

  // Reopen the property you had open before a refresh, on the same tab (lib/view-memory).
  useRememberedSelection(`${businessUnit}:listing`, active?.id, !loading && listings.length > 0, id => {
    const l = listings.find(x => x.id === id);
    if (!l) return;
    openListing(l);
    const tab = recallView(`${businessUnit}:listing-tab`);
    const tabs = ['info', 'performance', 'documents', 'rentroll', 'leasing', 'recon', 'prospects', 'deals', 'photos', 'contacts', 'team'] as const;
    const saved = tabs.find(t => t === tab);
    if (saved) setActiveTab(saved);
  });
  useEffect(() => { if (active) rememberView(`${businessUnit}:listing-tab`, activeTab); }, [active, activeTab, businessUnit]);

  const loadFiles = useCallback(async (listingId: string) => {
    setFilesLoading(true);
    const res = await fetch(`/api/crm/listing-files?listing_id=${listingId}`, { headers: authHeaders });
    const json = await res.json();
    if (activeListingIdRef.current !== listingId) return; // a different listing was opened mid-flight
    setFiles(json.files ?? []);
    setFilesLoading(false);
  }, [authToken]); // eslint-disable-line

  const loadListingForms = useCallback(async (listingId: string) => {
    const res = await fetch(`/api/crm/form-submissions?listing_id=${listingId}`, { headers: authHeaders });
    const json = await res.json().catch(() => ({}));
    if (activeListingIdRef.current !== listingId) return;
    setListingForms(json.submissions ?? []);
  }, [authToken]); // eslint-disable-line

  // After the composer imports + sends a document for this property (parent bumps
  // reloadSignal), refresh the open listing's Transaction Docs + envelope status so
  // the new document appears without reopening the panel.
  useEffect(() => {
    if (reloadSignal && active) { loadListingForms(active.id); loadEnvelopes(active.id); }
  }, [reloadSignal]); // eslint-disable-line

  const loadCrmForms = useCallback(async () => {
    const res = await fetch(`/api/crm/forms?business_unit=${businessUnit}`, { headers: authHeaders });
    const json = await res.json().catch(() => ({}));
    setCrmForms(json.forms ?? []);
  }, [businessUnit, authToken]); // eslint-disable-line

  const loadListingContacts = useCallback(async (listingId: string) => {
    const res = await fetch(`/api/crm/listing-contacts?listing_id=${listingId}`, { headers: authHeaders });
    const json = await res.json().catch(() => ({}));
    if (activeListingIdRef.current !== listingId) return;
    setListingContacts(json.contacts ?? []);
  }, [authToken]); // eslint-disable-line

  const loadDealForms = useCallback(async (dealId: string) => {
    const res = await fetch(`/api/crm/form-submissions?deal_id=${dealId}`, { headers: authHeaders });
    const json = await res.json().catch(() => ({}));
    setDealForms(prev => ({ ...prev, [dealId]: json.submissions ?? [] }));
  }, [authToken]); // eslint-disable-line

  const loadDeals = useCallback(async (listingId: string) => {
    const res = await fetch(`/api/crm/deals?listing_id=${listingId}`, { headers: authHeaders });
    const json = await res.json().catch(() => ({}));
    if (activeListingIdRef.current !== listingId) return;
    const ds: Deal[] = json.deals ?? [];
    setDeals(ds);
    ds.forEach(d => loadDealForms(d.id));
  }, [authToken, loadDealForms]); // eslint-disable-line

  const loadAllDeals = useCallback(async () => {
    const res = await fetch(`/api/crm/deals`, { headers: authHeaders });
    const json = await res.json().catch(() => ({}));
    setAllDeals(json.deals ?? []);
  }, [authToken]); // eslint-disable-line

  const loadEnvelopes = useCallback(async (listingId: string) => {
    const res = await fetch(`/api/crm/envelopes?listing_id=${listingId}`, { headers: authHeaders });
    const json = await res.json().catch(() => ({}));
    if (activeListingIdRef.current !== listingId) return;
    const map: Record<string, Envelope> = {};
    for (const e of (json.envelopes ?? [])) if (e.submission_id && !map[e.submission_id]) map[e.submission_id] = e; // GET is newest-first; keep the latest
    setEnvMap(map);
  }, [authToken]); // eslint-disable-line

  // Fetch the blank template's signed URL, then open the fillable editor bound to this property.
  const openFormEditor = useCallback(async (form: { id: string; name: string }, submissionId?: string, formCode?: string) => {
    setFormPicker(false);
    // The Letters of Intent use the dynamic term-list builder, not the overlay editor.
    const code = formCode || crmForms.find(f => f.id === form.id)?.form_code;
    const spec = specForForm(code, form.name);
    if (spec) { setLoiDoc({ formId: form.id, name: form.name, submissionId, spec }); return; }
    try {
      const res = await fetch(`/api/crm/forms/${form.id}/url`, { headers: authHeaders });
      const json = await res.json();
      if (!json.url) { onToast('Could not open form'); return; }
      setEditorDoc({ id: form.id, name: form.name, url: json.url, submissionId });
    } catch { onToast('Could not open form'); }
  }, [authToken, onToast, crmForms]); // eslint-disable-line

  // ── Open / close listing ────────────────────────────────────────────────────

  function openListing(l: Listing) {
    activeListingIdRef.current = l.id;
    setActive(l);
    setActiveTab('info');
    // Rent roll is owner-level information, so the tabs follow what the server will
    // actually serve: a 404 here means this agent isn't tagged on the property.
    setCanSeeRentRoll(false); setHasRentRoll(false);
    fetch(`/api/crm/rent-roll?listing_id=${l.id}`, { headers: authHeaders })
      .then(async r => (r.ok ? r.json() : null))
      .then(j => {
        if (activeListingIdRef.current !== l.id || !j) return;
        setCanSeeRentRoll(true);
        setHasRentRoll((j.rows ?? []).length > 0);
      })
      .catch(() => { /* tabs just stay hidden */ });
    setEditForm({
      name: l.name ?? '', address: l.address ?? '', city: l.city ?? '',
      state: l.state ?? 'TX', zip: l.zip ?? '', type: l.type ?? 'Retail',
      status: l.status ?? 'active', asking_price: l.asking_price != null ? String(l.asking_price) : '',
      sq_ft: l.sq_ft != null ? String(l.sq_ft) : '',
      lot_size: l.lot_size ?? '', year_built: l.year_built ?? '',
      description: l.description ?? '', notes: l.notes ?? '', highlights: l.highlights ?? '', flyer_headline: l.flyer_headline ?? '',
      co_agent_id: l.co_agent_id ?? '', flyer_type: l.flyer_type ?? '',
      zoning: l.zoning ?? '',
      elevator: l.elevator == null ? '' : String(l.elevator),
      grade_level_doors: l.grade_level_doors == null ? '' : String(l.grade_level_doors),
      dock_high_doors: l.dock_high_doors == null ? '' : String(l.dock_high_doors),
      map_pin: (l.latitude != null && l.longitude != null) ? `${l.latitude}, ${l.longitude}` : '',
      listing_agent_id: l.listing_agent_id ?? '',
    });
    setDirty(false);
    setFiles([]);
    loadFiles(l.id);
    setListingForms([]);
    loadListingForms(l.id);
    loadCrmForms();
    setTeamOwner(l.listing_agent_id ?? '');
    setTeamAssigned(l.assigned_agent_ids ?? []);
    setTeamRestricted(!!l.is_restricted);
    setListingContacts([]);
    setContactSearch('');
    loadListingContacts(l.id);
    setDeals([]);
    setDealForms({});
    loadDeals(l.id);
    setEnvMap({});
    loadEnvelopes(l.id);
  }

  function closePanel() { activeListingIdRef.current = null; setActive(null); setFiles([]); setListingForms([]); setDirty(false); }

  // ── Save listing ────────────────────────────────────────────────────────────

  async function saveListing() {
    if (!active) return;
    const body: Record<string, unknown> = { ...editForm };
    body.asking_price = editForm.asking_price !== '' ? Number(editForm.asking_price) : null;
    // "29.7255, -98.6526" pasted from Google Maps -> the two columns the flyer map reads
    { const m = String(editForm.map_pin || '').match(/(-?\d{1,3}\.\d+)\s*[, ]\s*(-?\d{1,3}\.\d+)/);
      body.latitude = m ? Number(m[1]) : null; body.longitude = m ? Number(m[2]) : null;
      delete (body as Record<string, unknown>).map_pin; }
    body.sq_ft        = editForm.sq_ft !== '' ? Number(editForm.sq_ft) : null;
    // Contacts @-tagged in the Internal Notes (silent): derived from the text, so the tag and the sentence can't drift apart.
    body.tagged_contact_ids = parseMentionContactIds(String(editForm.notes ?? ''), clients, profiles);
    for (const k of ['elevator', 'grade_level_doors', 'dock_high_doors'] as const) {
      const v = (editForm as Record<string, string>)[k];
      body[k] = v === '' ? null : v === 'true';     // unanswered stays unknown, not "No"
    }
    const res = await fetch(`/api/crm/listings/${active.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify(body),
    });
    if (!res.ok) { onToast('Error saving listing'); return; }
    const { listing } = await res.json();
    // Notify only people newly @-tagged in the Internal Notes by this save.
    if (onMention) {
      const had = new Set(parseMentionIds(active.notes ?? '', profiles));
      const fresh = parseMentionIds(String(editForm.notes ?? ''), profiles).filter(id => !had.has(id));
      if (fresh.length) onMention(fresh, `mentioned you in the notes for ${listing.name || listing.address || 'a property'}`, 'listing', active.id);
    }
    setListings(prev => prev.map(l => l.id === active.id ? listing : l));
    setActive(listing);
    setDirty(false);
    onToast('Listing saved ✓');
  }

  async function saveTeam() {
    if (!active) return;
    setTeamSaving(true);
    const res = await fetch(`/api/crm/listings/${active.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ listing_agent_id: teamOwner || null, assigned_agent_ids: teamAssigned, is_restricted: teamRestricted }),
    });
    setTeamSaving(false);
    if (!res.ok) { onToast('Error saving team'); return; }
    const { listing } = await res.json();
    setListings(prev => prev.map(l => l.id === active.id ? listing : l));
    setActive(listing);
    onToast('Sharing saved ✓');
  }

  async function addContact(clientId: string) {
    if (!active) return;
    setAddingContact(true);
    const res = await fetch('/api/crm/listing-contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ listing_id: active.id, client_id: clientId, role: contactRole }),
    });
    setAddingContact(false);
    setContactSearch('');
    if (!res.ok) { onToast('Could not add contact'); return; }
    const { contact } = await res.json();
    setListingContacts(prev => [...prev.filter(c => c.id !== contact.id), contact]);
    onToast('Contact added ✓');
  }

  // Create a contact in the master list (crm_clients) and link it in one step, so a
  // party that isn't a contact yet is added ONCE with the chosen role — no dupes.
  async function createAndLinkContact(name: string) {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (!parts.length || !active) return;
    setAddingContact(true);
    const roleType: Record<string, string> = { Tenant: 'Tenant', Landlord: 'Landlord/Investor', Buyer: 'Buyer', Seller: 'Seller', 'Listing Agent': 'Broker', 'Co-broker': 'Broker' };
    const res = await fetch('/api/crm/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ first_name: parts[0], last_name: parts.slice(1).join(' ') || null, type: roleType[contactRole] || 'Other' }),
    });
    if (!res.ok) { setAddingContact(false); onToast('Could not create the contact'); return; }
    const { contact } = await res.json();
    await addContact(contact.id); // links it to the listing with the selected role + reloads
  }

  async function removeContact(id: string, name?: string) {
    if (!window.confirm(`Remove ${name || 'this contact'} from this property?\n\nThe contact record itself is kept — only the link to this property is removed.`)) return;
    setListingContacts(prev => prev.filter(c => c.id !== id));
    await fetch(`/api/crm/listing-contacts?id=${id}`, { method: 'DELETE', headers: authHeaders });
  }

  // ── Deals at this property ────────────────────────────────────────────────────
  async function createDeal() {
    if (!active) return;
    if (!newDeal.client.trim()) { onToast('Client name required'); return; }
    setDealBusy(true);
    const res = await fetch('/api/crm/deals', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ ...newDeal, property: active.name || active.address || '', listing_id: active.id, agent_id: active.listing_agent_id || null, business_unit: businessUnit }),
    });
    setDealBusy(false);
    if (!res.ok) { onToast('Could not create deal'); return; }
    setShowNewDeal(false);
    setNewDeal({ client: '', client_email: '', client_phone: '', client_id: '', type: 'Tenant Lease', stage: 'Prospect' });
    setDealClientSearch('');
    loadDeals(active.id);
    onToast('Deal created ✓');
  }

  async function linkDeal(dealId: string) {
    if (!active) return;
    const res = await fetch(`/api/crm/deals?id=${dealId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ listing_id: active.id }),
    });
    if (!res.ok) { onToast('Could not link deal'); return; }
    setShowLinkDeal(false); setLinkSearch('');
    loadDeals(active.id);
    onToast('Deal linked ✓');
  }

  async function unlinkDeal(dealId: string) {
    if (!active || !window.confirm('Remove this deal from the property? The deal itself is not deleted.')) return;
    const res = await fetch(`/api/crm/deals?id=${dealId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ listing_id: null }),
    });
    if (res.ok) { setDeals(prev => prev.filter(d => d.id !== dealId)); onToast('Deal unlinked'); }
  }

  function editDealForm(dealId: string, form: { id: string; name: string }, submissionId: string, formCode?: string) { setFormDealId(dealId); openFormEditor(form, submissionId, formCode); }

  // Add one library form to a deal as a blank submission — same flow as the
  // deal's own Docs tab, so a form picked here lands in "Waiting to be filled".
  async function addFormToDeal(dealId: string, form: FormTemplate) {
    setDealFormAdding(dealId);
    const res = await fetch('/api/crm/form-submissions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ form_id: form.id, deal_id: dealId, business_unit: businessUnit, title: form.name, values: [] }),
    }).catch(() => null);
    if (res?.ok) { await loadDealForms(dealId); setDealFormPick(prev => ({ ...prev, [dealId]: '' })); onToast(`✓ Added ${form.name}`); }
    else onToast('Could not add that form');
    setDealFormAdding(null);
  }

  function openSendModal(d: Deal | null, f: FormSubmission, restore?: { signers: { role: string; name: string; email: string }[]; msg: string }) {
    const nameOfC = (c: { business_name?: string; first_name?: string; last_name?: string }) =>
      c.business_name || `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim();
    const landlord = listingContacts.find(c => (c.role || '').toLowerCase() === 'landlord')?.crm_clients;
    let seed: { role: string; name: string; email: string }[];
    if (restore) seed = restore.signers;
    else if (d) {
      seed = [{ role: 'client', name: d.client || '', email: d.client_email || '' }];
      if (landlord?.email) seed.push({ role: 'landlord', name: nameOfC(landlord), email: landlord.email });
    } else {
      // Property-level doc: start from the folder's own contacts (landlord first).
      seed = listingContacts
        .filter(c => c.crm_clients?.email)
        .slice(0, 2)
        .map(c => ({ role: (c.role || '').toLowerCase() === 'landlord' ? 'landlord' : 'client', name: nameOfC(c.crm_clients!), email: c.crm_clients!.email! }));
      if (!seed.length) seed = [{ role: 'client', name: '', email: '' }];
    }
    setSendSigners(seed);
    setSendPick(null);
    setSendMsg(restore ? restore.msg : defaultEsignMessage(f.title || f.crm_forms?.name));
    setSendPreview(false);
    setSendSigFields(null);
    setSendFieldGroups([]);
    setSendValues([]);
    setSendModal({ submissionId: f.id, dealId: d?.id ?? f.deal_id ?? null, title: f.title || f.crm_forms?.name || 'Document', formId: f.form_id, url: f.url ?? null });
    // Capture the placed signature fields so the agent can trim any that don't
    // apply to this deal (e.g. a 2nd seller block on a single-seller sale).
    fetch(`/api/crm/form-submissions/${f.id}`, { headers: authHeaders })
      .then(r => r.json())
      .then(j => {
        const vals: Array<Record<string, unknown>> = Array.isArray(j.submission?.values) ? j.submission.values : [];
        setSendValues(vals);
        const sig = vals.filter(x => ['signature', 'initial', 'date'].includes(String(x.type)));
        setSendSigFields(sig.length);
        const byRole = new Map<string, string[]>();
        for (const s of sig) { const r = String(s.signerRole || 'client'); if (!byRole.has(r)) byRole.set(r, []); byRole.get(r)!.push(String(s.type)); }
        setSendFieldGroups(Array.from(byRole.entries()).map(([role, types]) => ({ origRole: role, role, types, keep: true })));
      })
      .catch(() => { setSendSigFields(0); setSendFieldGroups([]); });
  }

  // Send flow, step 2: hop into the document to place signature / initial / date
  // fields. The half-filled send (signers + message) is stashed and restored when the
  // editor closes, so stepping out doesn't cost the agent their typing.
  function goPlaceFields() {
    const m = sendModal;
    if (!m) return;
    setPendingSend({ ...m, signers: sendSigners, msg: sendMsg });
    setSendModal(null);
    const form = { id: m.formId || '', name: m.title };
    const code = crmForms.find(cf => cf.id === m.formId)?.form_code;
    if (m.dealId) editDealForm(m.dealId, form, m.submissionId, code);
    else { setFormDealId(null); openFormEditor(form, m.submissionId, code); }
  }

  // Back from placing fields — reopen the send modal where they left off.
  function resumeSend() {
    const ps = pendingSend;
    if (!ps) return;
    setPendingSend(null);
    const f = [...listingForms, ...Object.values(dealForms).flat()].find(x => x.id === ps.submissionId);
    const deal = ps.dealId ? deals.find(d => d.id === ps.dealId) ?? null : null;
    openSendModal(deal, (f ?? { id: ps.submissionId, title: ps.title, form_id: ps.formId }) as FormSubmission,
      { signers: ps.signers, msg: ps.msg });
  }

  async function sendForSignature() {
    if (!sendModal) return;
    const signers = sendSigners.filter(s => s.email.includes('@') && s.name.trim())
      .map((s, i) => ({ signer_role: s.role, name: s.name.trim(), email: s.email.trim(), signing_order: i + 1 }));
    if (signers.length === 0) { onToast('Add at least one signer with a valid email'); return; }
    setSendBusy(true);
    // If the agent removed or reassigned any placed signature fields, persist the edited
    // set on the submission BEFORE sending, so each field is dropped or routed to the
    // right party.
    const SIG = ['signature', 'initial', 'date'];
    const byOrig = new Map(sendFieldGroups.map(g => [g.origRole, g]));
    const removed = sendFieldGroups.filter(g => !g.keep);
    const reassigned = sendFieldGroups.filter(g => g.keep && g.role !== g.origRole);
    if ((removed.length || reassigned.length) && sendValues.length) {
      const kept = sendValues.flatMap(v => {
        if (!SIG.includes(String(v.type))) return [v];
        const g = byOrig.get(String(v.signerRole || 'client'));
        if (!g) return [v];
        if (!g.keep) return [];
        return [g.role !== g.origRole ? { ...v, signerRole: g.role } : v];
      });
      const parts: string[] = [];
      if (removed.length) parts.push(`Removed ${removed.map(g => roleLabel(g.origRole)).join(', ')}`);
      if (reassigned.length) parts.push(`Reassigned ${reassigned.map(g => `${roleLabel(g.origRole)} → ${roleLabel(g.role)}`).join(', ')}`);
      const up = await fetch(`/api/crm/form-submissions/${sendModal.submissionId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ values: kept, logSummary: `${parts.join(' · ')} (signature fields) before sending` }),
      });
      if (!up.ok) { setSendBusy(false); onToast('Could not update the signature fields'); return; }
    }
    const res = await fetch('/api/crm/envelopes', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ submission_id: sendModal.submissionId, deal_id: sendModal.dealId || null, listing_id: active?.id, title: sendModal.title, message: sendMsg, signers }),
    });
    const j = await res.json().catch(() => ({}));
    setSendBusy(false);
    if (!res.ok) { onToast(j.error || 'Could not send for signature'); return; }
    setSendModal(null);
    if (active) loadEnvelopes(active.id);
    onToast(j.sent ? `📤 Sent to ${signers[0].email} ✓` : 'Envelope created');
  }

  async function deleteSubmission(id: string, opts?: { dealId?: string }) {
    const env = envMap[id];
    const outForSig = !!(env && env.status !== 'completed' && env.status !== 'voided');
    const msg = outForSig
      ? 'This document is out for signature. Deleting it will CANCEL the pending signature request (the signers can no longer sign) and remove the document. Continue?'
      : 'Delete this document? This cannot be undone.';
    if (!window.confirm(msg)) return;
    const res = await fetch(`/api/crm/form-submissions?id=${id}`, { method: 'DELETE', headers: authHeaders });
    if (!res.ok) { onToast('Could not delete the document'); return; }
    if (opts?.dealId) loadDealForms(opts.dealId);
    if (active) loadListingForms(active.id);
    onToast('Document deleted');
  }

  // Cancel a pending signature request without deleting the doc (so it can be edited + re-sent).
  async function voidEnvelope(envelopeId: string) {
    if (!window.confirm('Cancel this signature request? The signers will no longer be able to sign. The document stays so you can edit and re-send it.')) return;
    const res = await fetch('/api/crm/envelopes', { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authHeaders }, body: JSON.stringify({ envelope_id: envelopeId, action: 'void' }) });
    if (!res.ok) { const j = await res.json().catch(() => ({})); onToast(j.error || 'Could not cancel the request'); return; }
    if (active) loadEnvelopes(active.id);
    onToast('Signature request cancelled');
  }

  async function togglePin(fm: FormTemplate) {
    const next = !fm.pinned;
    setCrmForms(prev => prev.map(x => x.id === fm.id ? { ...x, pinned: next } : x)); // optimistic
    const res = await fetch(`/api/crm/forms/${fm.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authHeaders }, body: JSON.stringify({ pinned: next }) });
    if (!res.ok) { setCrmForms(prev => prev.map(x => x.id === fm.id ? { ...x, pinned: !next } : x)); onToast('Could not update'); }
  }

  // Rename a document in place. Forms come in named after the template they were
  // filled from ("Building Lease Agreement"), which is useless once a property has
  // three of them — the agent needs to call it what it actually is.
  async function renameSubmission(id: string, title: string, opts?: { dealId?: string }) {
    const name = title.trim();
    if (!name) { onToast('Give the document a name'); return; }
    const res = await fetch(`/api/crm/form-submissions/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ title: name }),
    });
    if (!res.ok) { onToast((await res.json().catch(() => ({})))?.error || 'Could not rename the document'); return; }
    if (opts?.dealId) loadDealForms(opts.dealId);
    if (active) loadListingForms(active.id);
    onToast('Renamed ✓');
  }

  async function copySubmission(id: string, opts?: { dealId?: string }) {
    const res = await fetch('/api/crm/form-submissions', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders }, body: JSON.stringify({ copy_from: id }) });
    if (!res.ok) { onToast('Could not copy the document'); return; }
    if (opts?.dealId) loadDealForms(opts.dealId);
    if (active) loadListingForms(active.id);
    onToast('Copy created ✓');
  }

  // Generate a branded one-page PDF flyer from this property's data + photos.
  // Open, save, or rebuild the property's flyer. The server keeps the generated PDF
  // and only rebuilds when the listing has changed since — `force` is the agent
  // saying "I changed something, make me a new one" regardless.
  async function generateFlyer(opts?: { force?: boolean; download?: boolean }) {
    if (!active) return;
    setFlyerBusy(true);
    try {
      const qs = [opts?.force ? 'force=1' : '', opts?.download ? 'download=1' : ''].filter(Boolean).join('&');
      const res = await fetch(`/api/crm/listings/${active.id}/flyer${qs ? `?${qs}` : ''}`, { headers: authHeaders });
      if (!res.ok) { onToast(opts?.force ? 'Could not rebuild the flyer' : 'Could not open the flyer'); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (opts?.download) {
        const a = document.createElement('a');
        a.href = url;
        a.download = `${(active.name || active.address || 'listing').replace(/[^a-zA-Z0-9]+/g, '-').slice(0, 50)}-flyer.pdf`;
        a.click();
        onToast('Flyer downloaded ✓');
      } else {
        window.open(url, '_blank');
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      // Pick up flyer_generated_at so the header stops saying it's out of date.
      const built = res.headers.get('X-Flyer-Generated-At');
      if (built) {
        setActive(a => a && a.id === active.id ? { ...a, flyer_generated_at: built } : a);
        setListings(ls => ls.map(l => l.id === active.id ? { ...l, flyer_generated_at: built } : l));
      }
      if (opts?.force) onToast('Updated flyer created ✓');
    } catch { onToast('Could not open the flyer'); }
    finally { setFlyerBusy(false); }
  }

  // ── Delete listing ──────────────────────────────────────────────────────────

  async function deleteListing() {
    if (!active || !confirm(`Delete "${active.name}"? This cannot be undone.`)) return;
    await fetch(`/api/crm/listings/${active.id}`, { method: 'DELETE', headers: authHeaders });
    setListings(prev => prev.filter(l => l.id !== active.id));
    closePanel();
    onToast('Listing deleted');
  }

  // ── Create listing ──────────────────────────────────────────────────────────

  async function createListing() {
    if (!newForm.name.trim()) return;
    setCreating(true);
    const body: Record<string, unknown> = { ...newForm, business_unit: businessUnit };
    body.asking_price = newForm.asking_price !== '' ? Number(newForm.asking_price) : null;
    body.sq_ft        = newForm.sq_ft !== '' ? Number(newForm.sq_ft) : null;
    body.tagged_contact_ids = parseMentionContactIds(String(newForm.notes ?? ''), clients, profiles);
    const res = await fetch('/api/crm/listings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify(body),
    });
    setCreating(false);
    if (!res.ok) { onToast('Error creating listing'); return; }
    const { listing } = await res.json();
    if (onMention) {
      const fresh = parseMentionIds(String(newForm.notes ?? ''), profiles);
      if (fresh.length) onMention(fresh, `mentioned you in the notes for ${listing.name || listing.address || 'a new property'}`, 'listing', listing.id);
    }
    setListings(prev => [listing, ...prev]);
    setShowNew(false);
    setNewForm(BLANK_FORM);
    onToast('Listing created ✓');
    openListing(listing);
  }

  // ── File upload ─────────────────────────────────────────────────────────────

  async function uploadFile(e: React.ChangeEvent<HTMLInputElement>) {
    if (!active || !e.target.files?.[0]) return;
    const file = e.target.files[0];
    setUploading(true);
    e.target.value = '';
    try {
      // Step 1: Get a presigned upload URL (small JSON request — no body size limit issue)
      const presignRes = await fetch('/api/crm/listing-files/presign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          listing_id: active.id,
          filename: file.name,
          category: uploadCat,
          file_size: file.size,
          file_type: file.type || '',
        }),
      });
      const presignJson = await presignRes.json();
      if (!presignRes.ok) { onToast(presignJson.error ?? 'Upload failed'); setUploading(false); return; }

      const { uploadUrl, storagePath, meta } = presignJson;

      // Step 2: PUT the file directly to Supabase Storage (bypasses Vercel body size limit)
      const putRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });
      if (!putRes.ok) {
        onToast(`Upload failed (storage error ${putRes.status})`);
        setUploading(false);
        return;
      }

      // Step 3: Save the file record to DB
      const confirmRes = await fetch('/api/crm/listing-files/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ ...meta, storage_path: storagePath }),
      });
      const confirmJson = await confirmRes.json();
      if (!confirmRes.ok) { onToast(confirmJson.error ?? 'Upload failed'); setUploading(false); return; }
      if (confirmJson.duplicate) { onToast(`${file.name} is already on this property as “${confirmJson.file?.name ?? 'an existing file'}” — not added again`); return; }

      setFiles(prev => [confirmJson.file, ...prev]);
      onToast('File uploaded ✓');
    } catch (err) {
      console.error('[uploadFile] error:', err);
      onToast('Upload failed — check console for details');
    } finally {
      setUploading(false);
    }
  }

  // ── Photos ────────────────────────────────────────────────────────────────
  // Upload straight into the Photos tab (any number at once) rather than routing
  // through Documents with the right category selected.
  const [photoBusy, setPhotoBusy] = useState(false);
  const [dragPhoto, setDragPhoto] = useState<string | null>(null);
  const [hoverPhoto, setHoverPhoto] = useState<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const replacingRef = useRef<ListingFile | null>(null);

  // One file through presign → PUT → confirm; returns the saved row.
  const putPhoto = useCallback(async (file: File, opts?: { allowDuplicate?: boolean }): Promise<ListingFile | null> => {
    if (!active) return null;
    const pre = await fetch('/api/crm/listing-files/presign', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ listing_id: active.id, filename: file.name, category: 'photo', file_size: file.size, file_type: file.type || '' }),
    });
    const pj = await pre.json().catch(() => ({}));
    if (!pre.ok) { onToast(pj.error ?? 'Upload failed'); return null; }
    const put = await fetch(pj.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
    if (!put.ok) { onToast(`Upload failed (storage ${put.status})`); return null; }
    const conf = await fetch('/api/crm/listing-files/confirm', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ ...pj.meta, storage_path: pj.storagePath, ...(opts?.allowDuplicate ? { allow_duplicate: true } : {}) }),
    });
    const cj = await conf.json().catch(() => ({}));
    if (!conf.ok) { onToast(cj.error ?? 'Upload failed'); return null; }
    if (cj.duplicate) { onToast(`${file.name} is already on this property as “${cj.file?.name ?? 'an existing file'}” — not added again`); return null; }
    return cj.file as ListingFile;
  }, [active, authHeaders, onToast]);

  async function addPhotos(list: FileList | null) {
    if (!active || !list?.length) return;
    const imgs = Array.from(list).filter(f => (f.type || '').startsWith('image/'));
    if (!imgs.length) { onToast('Photos need to be image files'); return; }
    setPhotoBusy(true);
    try {
      const added: ListingFile[] = [];
      for (const f of imgs) { const row = await putPhoto(f); if (row) added.push(row); }
      if (added.length) {
        setFiles(prev => [...prev, ...added]);
        onToast(`${added.length} photo${added.length === 1 ? '' : 's'} added ✓`);
      }
    } finally { setPhotoBusy(false); }
  }

  // Persist the order the tiles are in; position 0 becomes the flyer's cover.
  const savePhotoOrder = useCallback(async (ordered: ListingFile[]) => {
    if (!active) return;
    const res = await fetch('/api/crm/listing-files', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ listing_id: active.id, order: ordered.map(f => f.id) }),
    });
    if (!res.ok) { onToast('Could not save the photo order'); loadFiles(active.id); return; }
    // Mirror the saved positions locally so the cover badge and the flyer's
    // out-of-date check agree without a refetch.
    const pos = new Map(ordered.map((f, i) => [f.id, i]));
    setFiles(prev => prev.map(f => pos.has(f.id) ? { ...f, sort_order: pos.get(f.id)! } : f));
  }, [active, authHeaders, onToast]); // eslint-disable-line

  // Drop a dragged tile in front of the one it was dropped on.
  function movePhoto(photos: ListingFile[], fromId: string, toId: string) {
    if (fromId === toId) return;
    const from = photos.findIndex(f => f.id === fromId);
    const to = photos.findIndex(f => f.id === toId);
    if (from < 0 || to < 0) return;
    const next = [...photos];
    next.splice(to, 0, next.splice(from, 1)[0]);
    savePhotoOrder(next);
  }
  const makeCover = (photos: ListingFile[], id: string) => movePhoto(photos, id, photos[0]?.id ?? id);

  // Swap one photo without disturbing the rest — the replacement takes the old
  // one's position, so a "just change that picture" edit doesn't reshuffle anything.
  async function replacePhoto(file: File) {
    const old = replacingRef.current;
    replacingRef.current = null;
    if (!active || !old) return;
    setPhotoBusy(true);
    try {
      const row = await putPhoto(file, { allowDuplicate: true });   // replacing with identical bytes must still work
      if (!row) return;
      await fetch('/api/crm/listing-files', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ fileId: old.id }),
      });
      setFiles(prev => {
        const next = prev.filter(f => f.id !== old.id);
        const at = prev.findIndex(f => f.id === old.id);
        next.splice(Math.max(0, at), 0, row);
        const photos = next.filter(f => f.category === 'photo');
        savePhotoOrder(photos);
        return next;
      });
      onToast('Photo replaced ✓');
    } finally { setPhotoBusy(false); }
  }

  async function deleteFile(fileId: string, name: string) {
    if (!confirm(`Remove "${name}"?`)) return;
    const res = await fetch('/api/crm/listing-files', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ fileId }),
    });
    if (!res.ok) { onToast('Error deleting file'); return; }
    setFiles(prev => prev.filter(f => f.id !== fileId));
    onToast('File removed');
  }

  // ── Filtered listings ───────────────────────────────────────────────────────

  const filtered = listings.filter(l => {
    if (typeFilter && l.type !== typeFilter) return false;
    if (statusFilter && l.status !== statusFilter) return false;
    if (search) {
      const s = `${l.name} ${l.address ?? ''} ${l.city ?? ''}`.toLowerCase();
      if (!s.includes(search.toLowerCase())) return false;
    }
    return true;
  });

  // ── Shared input style ──────────────────────────────────────────────────────

  const INP: React.CSSProperties = {
    padding: '10px 12px', border: '1px solid var(--k-e5e7eb)', borderRadius: 8, fontSize: 16,
    color: 'var(--k-374151)', fontFamily: "'DM Sans',sans-serif", width: '100%',
    boxSizing: 'border-box', background: 'var(--k-fafafa)', minHeight: 44,
  };
  const LBL = (s: string) => (
    <div style={{ fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase', color: 'var(--k-6b7280)', fontWeight: 700, marginBottom: 5, fontFamily: "'DM Sans',sans-serif" }}>{s}</div>
  );

  // ── Form fields (shared by new + edit) ─────────────────────────────────────

  // Rendered by CALLING it inline — {renderForm(...)} — never as <FormFields/>.
  // As a nested COMPONENT it got a new identity every render, so React remounted
  // its inputs on each keystroke and stole focus. Called as a plain function, the
  // returned elements reconcile in place and the field keeps focus.
  function renderForm({ form, onChange }: { form: typeof BLANK_FORM; onChange: (f: typeof BLANK_FORM) => void }) {
    const set = (k: keyof typeof BLANK_FORM, v: string) => onChange({ ...form, [k]: v });
    // One heading per group, so a long form reads as a few short sections instead of one wall of fields.
    const SEC = (title: string, hint?: string) => (
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '8px 0 -2px', paddingBottom: 6, borderBottom: '1px solid var(--k-f0ece3)' }}>
        <span style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 17, fontWeight: 700, color: 'var(--k-111)' }}>{title}</span>
        {hint && <span style={{ fontSize: 11.5, color: 'var(--k-9ca3af)' }}>{hint}</span>}
      </div>
    );
    const grid = (min = 200): React.CSSProperties => ({ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(min(${min}px,100%), 1fr))`, gap: 12 });
    const yesNo = (k: keyof typeof BLANK_FORM) => (
      <select style={INP} value={form[k]} onChange={e => set(k, e.target.value)}>
        <option value="">—</option><option value="true">Yes</option><option value="false">No</option>
      </select>
    );
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingBottom: 6 }}>
        {SEC('Basics')}
        <div>
          {LBL('Property Name *')}
          <input style={INP} value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Fair Oaks Commerce Center" />
        </div>
        <div style={grid()}>
          <div>{LBL('Type')}
            <select style={INP} value={form.type} onChange={e => set('type', e.target.value)}>
              {TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div>{LBL('Status')}
            <select style={INP} value={form.status} onChange={e => set('status', e.target.value)}>
              {STATUSES.map(s => <option key={s} value={s}>{STATUS_CFG[s]?.label ?? s}</option>)}
            </select>
          </div>
        </div>

        {SEC('Location')}
        <div>
          {LBL('Address')}
          <input style={INP} value={form.address} onChange={e => set('address', e.target.value)} placeholder="Street address" />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr) minmax(0,1fr)', gap: 10 }}>
          <div>{LBL('City')}<input style={INP} value={form.city} onChange={e => set('city', e.target.value)} placeholder="San Antonio" /></div>
          <div>{LBL('State')}<input style={INP} value={form.state} onChange={e => set('state', e.target.value)} placeholder="TX" /></div>
          <div>{LBL('ZIP')}<input style={INP} value={form.zip} onChange={e => set('zip', e.target.value)} placeholder="78258" /></div>
        </div>

        {SEC('Size & pricing')}
        <div style={grid()}>
          <div>{LBL('Asking Price / Rate ($)')}<input style={INP} type="number" value={form.asking_price} onChange={e => set('asking_price', e.target.value)} placeholder="e.g. 28.00 /SF/yr" /></div>
          <div>{LBL('Sq Ft')}<input style={INP} type="number" value={form.sq_ft} onChange={e => set('sq_ft', e.target.value)} placeholder="e.g. 4200" /></div>
          <div>{LBL('Lot Size')}<input style={INP} value={form.lot_size} onChange={e => set('lot_size', e.target.value)} placeholder="e.g. 0.85 acres" /></div>
          <div>{LBL('Year Built')}<input style={INP} value={form.year_built} onChange={e => set('year_built', e.target.value)} placeholder="e.g. 2005" /></div>
          <div>{LBL('Zoning')}<input style={INP} value={form.zoning} onChange={e => set('zoning', e.target.value)} placeholder="e.g. I-1, C-2" /></div>
        </div>

        {SEC('Building features')}
        <div style={grid(150)}>
          <div>{LBL('Elevator')}{yesNo('elevator')}</div>
          <div>{LBL('Grade-level doors')}{yesNo('grade_level_doors')}</div>
          <div>{LBL('Dock-high doors')}{yesNo('dock_high_doors')}</div>
        </div>

        {SEC('Team')}
        <div style={grid()}>
          <div>
            {LBL('Listing Agent')}
            <select style={INP} value={form.listing_agent_id} onChange={e => set('listing_agent_id', e.target.value)}>
              <option value="">— Unassigned —</option>
              {profiles.map(p => <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>)}
            </select>
          </div>
          <div>
            {LBL('Co-listing Agent (flyer)')}
            <select style={INP} value={form.co_agent_id} onChange={e => set('co_agent_id', e.target.value)}>
              <option value="">— None —</option>
              {profiles.map(p => <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>)}
            </select>
          </div>
        </div>

        {SEC('Marketing flyer', 'what the property flyer shows')}
        <div style={grid()}>
          <div>
            {LBL('Flyer Heading')}
            <select style={INP} value={form.flyer_type} onChange={e => set('flyer_type', e.target.value)}>
              <option value="">Auto (from price)</option>
              <option value="lease">For Lease</option>
              <option value="sale">For Sale</option>
            </select>
          </div>
          <div>
            {LBL('Map Pin')}
            <input style={INP} value={form.map_pin} onChange={e => set('map_pin', e.target.value)} placeholder="29.7255, -98.6526" />
          </div>
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--k-9ca3af)', marginTop: -6 }}>Map pin: right-click the spot in Google Maps → click the coordinates to copy → paste here. Leave blank to auto-locate from the address.</div>
        <div>
          {LBL('Flyer Headline (optional)')}
          <input style={INP} value={form.flyer_headline} onChange={e => set('flyer_headline', e.target.value)} maxLength={90} placeholder="Built-to-suit retail in the heart of Fair Oaks Ranch" />
          <div style={{ fontSize: 11.5, color: 'var(--k-9ca3af)', marginTop: 3 }}>One line printed over the cover photo of the flyer. Leave blank for none.</div>
        </div>
        <div>
          {LBL('Flyer Description')}
          <textarea style={{ ...INP, minHeight: 90, resize: 'vertical' }} value={form.description} onChange={e => set('description', e.target.value)} placeholder="Property highlights, features, zoning…" />
        </div>
        <div>
          {LBL('Flyer Highlights (one per line)')}
          <textarea style={{ ...INP, minHeight: 80, resize: 'vertical' }} value={form.highlights} onChange={e => set('highlights', e.target.value)} placeholder={'Move-in ready medical building\nHigh visibility\nAmple parking'} />
          <div style={{ fontSize: 11.5, color: 'var(--k-9ca3af)', marginTop: 3 }}>Bulleted list on the property flyer — one highlight per line.</div>
        </div>

        {SEC('Internal', 'never shown on the flyer')}
        <div>
          {LBL('Internal Notes')}
          <MentionTextarea style={{ ...INP, minHeight: 80, resize: 'vertical' }} profiles={profiles} contacts={clients} value={form.notes} onChange={v => set('notes', v)} placeholder="Showing instructions, landlord contact, commission notes… (@ to tag a teammate or a contact)" />
        </div>
      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ fontFamily: "'DM Sans',sans-serif" }}>

      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍  Search listings…"
          style={{ ...INP, flex: 1, minWidth: 160, fontSize: 16 }} />
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
          style={{ ...INP, width: 'auto', flex: 'none', color: typeFilter ? 'var(--k-111)' : 'var(--k-9ca3af)', fontSize: 16 }}>
          <option value="">All Types</option>
          {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          style={{ ...INP, width: 'auto', flex: 'none', color: statusFilter ? 'var(--k-111)' : 'var(--k-9ca3af)', fontSize: 16 }}>
          <option value="">All Statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{STATUS_CFG[s]?.label}</option>)}
        </select>
        <div style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--k-9ca3af)' }}>{filtered.length} listing{filtered.length !== 1 ? 's' : ''}</span>
          {isAdmin && (
            <button onClick={() => setShowNew(true)}
              style={{ padding: '10px 18px', background: '#c9922c', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', minHeight: 44 }}>
              + New Listing
            </button>
          )}
        </div>
      </div>

      {/* Grid */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--k-9ca3af)' }}>
          <div style={{ fontSize: 28, marginBottom: 10 }}>🏢</div>Loading listings…
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--k-9ca3af)' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🏢</div>
          <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 6 }}>No listings yet</div>
          {isAdmin && <div style={{ fontSize: 13 }}>Click <strong>+ New Listing</strong> to add your first property.</div>}
        </div>
      ) : (() => {
        const DEAL_STATUSES = ['leased', 'sold'];
        const ours = filtered.filter(l => !DEAL_STATUSES.includes(l.status ?? ''));
        const dealProps = filtered.filter(l => DEAL_STATUSES.includes(l.status ?? ''));
        const gridStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(300px, 100%), 1fr))', gap: 16 };
        const renderCard = (l: Listing) => {
            const sc = STATUS_CFG[l.status ?? 'active'] ?? STATUS_CFG.active;
            const tc = TYPE_COLORS[l.type ?? ''] ?? { bg: 'var(--k-f1f5f9)', color: 'var(--k-475569)' };
            const agent = profiles.find(p => p.id === l.listing_agent_id);
            return (
              <div key={l.id} onClick={() => openListing(l)}
                style={{ background: 'var(--k-fff)', border: '1px solid var(--k-e5e7eb)', borderRadius: 14, overflow: 'hidden', cursor: 'pointer', boxShadow: '0 1px 4px rgba(0,0,0,.05)', transition: 'box-shadow .15s, transform .1s' }}
                onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 6px 20px rgba(0,0,0,.1)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
                onMouseLeave={e => { e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,.05)'; e.currentTarget.style.transform = 'none'; }}>

                {/* Color bar */}
                <div style={{ height: 4, background: tc.color, opacity: 0.7 }} />

                <div style={{ padding: '16px 18px' }}>
                  {/* Header row */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 17, fontWeight: 700, color: 'var(--k-111)', lineHeight: 1.25, marginBottom: 3 }}>{l.name}</div>
                      {(l.address || l.city) && (
                        <div style={{ fontSize: 12, color: 'var(--k-6b7280)' }}>
                          {[l.address, l.city, l.state].filter(Boolean).join(', ')}
                        </div>
                      )}
                    </div>
                    <span style={{ ...sc, padding: '3px 10px', borderRadius: 20, fontSize: 10, fontWeight: 700, flexShrink: 0, letterSpacing: 0.3 } as React.CSSProperties}>
                      {sc.label}
                    </span>
                  </div>

                  {/* Type + price row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                    <span style={{ ...tc, padding: '2px 9px', borderRadius: 6, fontSize: 11, fontWeight: 700 } as React.CSSProperties}>{l.type}</span>
                    {l.sq_ft && <span style={{ fontSize: 12, color: 'var(--k-6b7280)' }}>{fmtSqFt(l.sq_ft)}</span>}
                    {l.asking_price && (
                      <span style={{ marginLeft: 'auto', fontSize: 14, fontWeight: 700, color: '#c9922c' }}>{fmt$(l.asking_price)}</span>
                    )}
                  </div>

                  {/* Description snippet */}
                  {l.description && (
                    <div style={{ fontSize: 12, color: 'var(--k-6b7280)', lineHeight: 1.5, marginBottom: 12, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' } as React.CSSProperties}>
                      {l.description}
                    </div>
                  )}

                  {/* Footer */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 10, borderTop: '1px solid var(--k-f3f4f6)' }}>
                    {agent ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ width: 22, height: 22, borderRadius: '50%', background: '#c9922c', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, flexShrink: 0 }}>
                          {agent.first_name[0]}{agent.last_name[0]}
                        </div>
                        <span style={{ fontSize: 11, color: 'var(--k-6b7280)' }}>{agent.first_name} {agent.last_name}</span>
                      </div>
                    ) : <span />}
                    {(perfById[l.id]?.real || perfById[l.id]?.inquiries) ? (
                      <span title="Real visitors and inquiries on this property's web pages, last 30 days" style={{ marginLeft: 'auto', fontSize: 11, color: '#9A6E18', fontWeight: 700, background: 'var(--k-fdf6e3)', borderRadius: 10, padding: '1px 8px' }}>
                        👁 {perfById[l.id].real}{perfById[l.id].inquiries ? ` · ✉ ${perfById[l.id].inquiries}` : ''} <span style={{ fontWeight: 500, color: '#b9965a' }}>30d</span>
                      </span>
                    ) : null}
                    <span style={{ marginLeft: perfById[l.id]?.real || perfById[l.id]?.inquiries ? 0 : 'auto', fontSize: 11, color: 'var(--k-9ca3af)' }}>
                      {new Date(l.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </span>
                  </div>
                </div>
              </div>
            );
        };
        const section = (title: string, items: Listing[], hint: string) => (
          <div style={{ marginBottom: 26 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 12 }}>
              <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 18, fontWeight: 700, color: 'var(--k-111)' }}>{title}</div>
              <span style={{ fontSize: 12, color: 'var(--k-9ca3af)', background: 'var(--k-f3f4f6)', borderRadius: 10, padding: '1px 8px', fontWeight: 600 }}>{items.length}</span>
            </div>
            {items.length === 0
              ? <div style={{ fontSize: 13, color: 'var(--k-9ca3af)', fontStyle: 'italic', padding: '4px 0' }}>{hint}</div>
              : <div style={gridStyle}>{items.map(renderCard)}</div>}
          </div>
        );
        return (
          <div>
            {section('🏢 Our Listings', ours, 'No active listings yet — click + New Listing to add one.')}
            {section('🤝 Deal Properties', dealProps, 'Properties from your closed lease & purchase deals show here — mark a listing Leased or Sold, or promote a deal.')}
          </div>
        );
      })()}

      {/* ── Detail Panel ──────────────────────────────────────────────────────── */}
      {active && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 400, display: 'flex' }} onClick={e => { if (e.target === e.currentTarget) closePanel(); }}>
          <div style={{ flex: 1 }} onClick={closePanel} />
          <div style={{ width: Math.min(activeTab === 'rentroll' || activeTab === 'prospects' || activeTab === 'leasing' ? 1100 : 620, window.innerWidth), background: 'var(--k-fff)', boxShadow: '-4px 0 40px rgba(0,0,0,.16)', display: 'flex', flexDirection: 'column', overflowY: 'auto', transition: 'width .18s ease' }}>

            {/* Panel header: the title keeps the full width; status chips + flyer actions sit on their own row beneath it
                (they used to share the title's row and squeezed it to one word per line, eating half the panel's height). */}
            <div style={{ padding: '16px 24px 0', borderBottom: '1px solid var(--k-eceae4)', background: 'var(--k-fff)', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div title={active.name} style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 22, fontWeight: 700, color: 'var(--k-111)', lineHeight: 1.2, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' } as React.CSSProperties}>{active.name}</div>
                  {(active.address || active.city) && (
                    <div style={{ fontSize: 13, color: 'var(--k-6b7280)', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      📍 {[active.address, active.city, active.state, active.zip].filter(Boolean).join(', ')}
                    </div>
                  )}
                </div>
                <button onClick={closePanel} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--k-6b7280)', fontSize: 20, lineHeight: 1, padding: 4, flexShrink: 0 }}>✕</button>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', margin: '10px 0 10px' }}>
                {(() => {
                  const sc = STATUS_CFG[active.status ?? 'active'] ?? STATUS_CFG.active;
                  const tc = TYPE_COLORS[active.type ?? ''] ?? { bg: 'var(--k-f1f5f9)', color: 'var(--k-475569)' };
                  return (
                    <>
                      <span style={{ ...sc, padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700 } as React.CSSProperties}>{sc.label}</span>
                      {active.type && <span style={{ ...tc, padding: '3px 9px', borderRadius: 6, fontSize: 11.5, fontWeight: 700 } as React.CSSProperties}>{active.type}</span>}
                      {active.sq_ft && <span style={{ fontSize: 12.5, color: 'var(--k-6b7280)' }}>{fmtSqFt(active.sq_ft)}</span>}
                      {active.asking_price && <span style={{ fontSize: 13, fontWeight: 700, color: '#c9922c' }}>{fmt$(active.asking_price)}</span>}
                    </>
                  );
                })()}
                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {(() => {
                    const built = active.flyer_generated_at ? new Date(active.flyer_generated_at) : null;
                    // Same test the server makes, so the header agrees with what an open
                    // would actually do: the flyer is out of date once the listing or any
                    // of its uploads is newer than the flyer.
                    const newestFile = files.reduce((m, f) => Math.max(m, f.created_at ? new Date(f.created_at).getTime() : 0), 0);
                    const changedAt = Math.max(active.updated_at ? new Date(active.updated_at).getTime() : 0, newestFile);
                    const stale = !!built && changedAt > built.getTime();
                    const bs: React.CSSProperties = { padding: '6px 11px', borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: flyerBusy ? 'default' : 'pointer', opacity: flyerBusy ? 0.6 : 1, whiteSpace: 'nowrap', fontFamily: "'DM Sans',sans-serif" };
                    return (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {built && (
                          <span title={`Flyer built ${built.toLocaleString('en-US')}`} style={{ fontSize: 11.5, color: stale ? 'var(--k-b45309)' : 'var(--k-9ca3af)', fontWeight: stale ? 700 : 400, whiteSpace: 'nowrap' }}>
                            {stale ? '⚠ out of date' : `Flyer · ${built.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
                          </span>
                        )}
                        <button onClick={() => generateFlyer()} disabled={flyerBusy} title={built ? 'Open the saved flyer' : 'Create a branded PDF flyer'}
                          style={{ ...bs, border: '1px solid var(--k-f0e2c4)', background: 'var(--k-fdf6e9)', color: 'var(--k-a06a12)' }}>
                          {flyerBusy ? '…' : built ? '📄 View flyer' : '📄 Create flyer'}
                        </button>
                        {built && (
                          <>
                            <button onClick={() => generateFlyer({ download: true })} disabled={flyerBusy} title="Download the flyer as a PDF"
                              style={{ ...bs, border: '1px solid var(--k-e5e7eb)', background: 'var(--k-fff)', color: 'var(--k-6b7280)' }}>⬇</button>
                            <button onClick={() => generateFlyer({ force: true })} disabled={flyerBusy} title="Rebuild the flyer from the current photos and details"
                              style={{ ...bs, border: stale ? 'none' : '1px solid var(--k-e5e7eb)', background: stale ? '#c9922c' : 'var(--k-fff)', color: stale ? '#fff' : 'var(--k-6b7280)' }}>
                              ↻ Update flyer
                            </button>
                          </>
                        )}
                      </div>
                    );
                  })()}
                </div>
              </div>
              {/* Tabs: one line, scrolls sideways, never wraps a label; the fade on the right says there's more */}
              <div style={{ position: 'relative', margin: '0 -24px' }}>
                <div ref={tabDrag.ref} {...tabDrag.handlers} style={{ display: 'flex', gap: 0, overflowX: 'auto', scrollbarWidth: 'none', padding: '0 24px', WebkitMaskImage: 'linear-gradient(to right, #000 calc(100% - 36px), transparent)', maskImage: 'linear-gradient(to right, #000 calc(100% - 36px), transparent)', ...tabDrag.style }}>
                  {[{ k: 'info', label: '📋 Details' }, { k: 'performance', label: '📈 Performance' }, { k: 'documents', label: '📄 Documents' },
                    ...(canSeeRentRoll ? [{ k: 'rentroll', label: '📊 Rent Roll' }] : []),
                    // The owner's weekly leasing activity report, kept live (LeasingActivity).
                    ...(canSeeRentRoll ? [{ k: 'leasing', label: '📋 Leasing' }] : []),
                    // Only where there is a rent roll, and only for someone allowed to see it.
                    ...(canSeeRentRoll && hasRentRoll ? [{ k: 'recon', label: '🧾 Reconciliation' }] : []),
                    // Who this property's campaigns emailed + open rates + who to ask for (EmailProspects).
                    ...(canSeeRentRoll ? [{ k: 'prospects', label: '📬 Prospects' }] : []),
                    { k: 'deals', label: '💼 Deals' }, { k: 'photos', label: '🖼 Photos' }, { k: 'contacts', label: '👥 Contacts' }, { k: 'team', label: '🔗 Team' }].map(t => (
                    <button key={t.k} onClick={() => setActiveTab(t.k as 'info' | 'performance' | 'documents' | 'rentroll' | 'leasing' | 'recon' | 'prospects' | 'deals' | 'photos' | 'contacts' | 'team')}
                      style={{ padding: '9px 14px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: "'DM Sans',sans-serif", whiteSpace: 'nowrap', flexShrink: 0, color: activeTab === t.k ? '#c9922c' : 'var(--k-6b7280)', borderBottom: `2px solid ${activeTab === t.k ? '#c9922c' : 'transparent'}`, transition: 'all .15s' }}>
                      {t.label}
                    </button>
                  ))}
                  <span style={{ flex: '0 0 36px' }} />
                </div>
              </div>
            </div>

            {/* Panel body */}
            <div style={{ flex: 1, padding: '20px 24px', overflowY: 'auto' }}>

              {/* ── Info tab ── */}
              {activeTab === 'info' && renderForm({ form: editForm, onChange: f => { setEditForm(f); setDirty(true); } })}

              {/* ── Documents tab (fillable forms + uploaded files) ── */}
              {activeTab === 'documents' && (
                <div>
                  {/* Transaction-doc forms bound to this property */}
                  <div style={{ marginBottom: 22 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}><span style={{ fontSize: 12, letterSpacing: .8, textTransform: 'uppercase', color: '#c9922c', fontWeight: 700 }}>Transaction docs</span><span style={{ fontSize: 11.5, color: 'var(--k-9ca3af)', background: 'var(--k-f3f4f6)', borderRadius: 10, padding: '1px 8px', fontWeight: 600 }}>{listingForms.length}</span></div>
                      <div style={{ display: 'flex', gap: 7 }}>
                        {canSeeRentRoll && (
                          <button onClick={() => setDraftingLease(true)} title="Describe a lease in a sentence and review what it fills in"
                            style={{ padding: '6px 12px', fontSize: 12.5, fontWeight: 700, background: 'var(--k-fffdf6)', color: 'var(--k-a06a12)', border: '1px dashed var(--k-e6d3a2)', borderRadius: 8, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>✨ Draft a lease</button>
                        )}
                        {onAddDocument && active && (
                          <button onClick={() => onAddDocument(active.id)} title="Upload an outside PDF — an addendum, a vendor contract, anything — and send it for signature on this property"
                            style={{ padding: '6px 12px', fontSize: 12.5, fontWeight: 700, background: 'var(--k-fffdf6)', color: 'var(--k-a06a12)', border: '1px dashed var(--k-e6d3a2)', borderRadius: 8, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>＋ Import a PDF</button>
                        )}
                        <button onClick={() => { setFormDealId(null); loadCrmForms(); setFormSearch(''); setFormPicker(true); }} style={{ padding: '6px 12px', fontSize: 12.5, fontWeight: 700, background: '#c9922c', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>✍️ Fill a form</button>
                      </div>
                    </div>
                    {listingForms.length === 0 ? (
                      <div style={{ fontSize: 13, color: 'var(--k-9ca3af)', padding: '4px 0 6px' }}>No forms yet. Fill a lease, LOI, or any commercial/TREC form and it saves to this property.</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {listingForms.map(f => {
                          // A document is two short lines, not one crowded row: the title gets the full width (it used to be crushed to a
                          // few letters — or to nothing — by six buttons), the state is a badge, and the rarely-used actions live in ⋯.
                          const env = envMap[f.id];
                          const live = !!env && env.status !== 'voided';
                          const signers = live ? (env!.crm_envelope_signers || []) : [];
                          const doneN = signers.filter(x => x.status === 'signed' || x.signed_at).length;
                          const signed = live && env!.status === 'completed';
                          const title = f.title || f.crm_forms?.name || 'Form';
                          const deal = f.deal_id ? deals.find(x => x.id === f.deal_id) : null;
                          const btn: React.CSSProperties = { fontSize: 12.5, fontWeight: 600, borderRadius: 7, padding: '6px 11px', cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: "'DM Sans',sans-serif", minHeight: 32 };
                          const ghost: React.CSSProperties = { ...btn, color: 'var(--k-374151)', background: 'var(--k-fff)', border: '1px solid var(--k-e5e7eb)' };
                          const menuItem: React.CSSProperties = { display: 'block', width: '100%', textAlign: 'left', padding: '9px 14px', background: 'none', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", color: 'var(--k-374151)' };
                          return (
                            <div key={f.id} style={{ background: signed ? 'var(--k-f7fdf9)' : 'var(--k-fffdf6)', border: `1px solid ${signed ? 'var(--k-c9ead4)' : 'var(--k-f0e2c4)'}`, borderRadius: 10, padding: '12px 14px', position: 'relative' }}>
                              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                                <span style={{ fontSize: 20, flexShrink: 0, lineHeight: 1.2 }}>📄</span>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  {renamingDoc === f.id ? (
                                    <input autoFocus value={renameDraft}
                                      onChange={e => setRenameDraft(e.target.value)}
                                      onKeyDown={e => {
                                        if (e.key === 'Enter') { renameSubmission(f.id, renameDraft); setRenamingDoc(null); }
                                        if (e.key === 'Escape') setRenamingDoc(null);
                                      }}
                                      onBlur={() => { renameSubmission(f.id, renameDraft); setRenamingDoc(null); }}
                                      style={{ width: '100%', boxSizing: 'border-box', fontSize: 14, fontWeight: 600, color: 'var(--k-1a1a1a)', border: '1px solid #c9922c', borderRadius: 6, padding: '4px 8px', fontFamily: "'DM Sans',sans-serif", background: 'var(--k-fff)' }} />
                                  ) : (
                                    <div onDoubleClick={() => { setRenameDraft(title); setRenamingDoc(f.id); }} title={`${title} — double-click to rename`}
                                      style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--k-1a1a1a)', lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', wordBreak: 'break-word', cursor: 'text' } as React.CSSProperties}>{title}</div>
                                  )}
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                                    {signed
                                      ? <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--k-15803d)', background: 'var(--k-dcfce7)', borderRadius: 20, padding: '2px 9px' }}>✓ Signed</span>
                                      : live
                                        ? <span title="Out for signature" style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--k-1d4ed8)', background: 'var(--k-dbeafe)', borderRadius: 20, padding: '2px 9px', whiteSpace: 'nowrap' }}>📤 Out for signature · {doneN}/{signers.length}</span>
                                        : <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--k-6b7280)', background: 'var(--k-f3f4f6)', borderRadius: 20, padding: '2px 9px' }}>Draft</span>}
                                    {/* Mirrored in from a deal at this property — same row, edited either side */}
                                    {f.deal_id && <span title="Lives on this deal — edits here and on the deal are the same document" style={{ fontSize: 11, fontWeight: 700, background: 'var(--k-eef2ff)', color: 'var(--k-4338ca)', borderRadius: 20, padding: '2px 9px', whiteSpace: 'nowrap' }}>💼 {deal?.client || 'deal'}</span>}
                                    <span style={{ fontSize: 12, color: 'var(--k-9ca3af)' }}>{f.crm_forms?.form_code ? `${f.crm_forms.form_code} · ` : ''}{f.updated_at ? `updated ${new Date(f.updated_at).toLocaleDateString()}` : ''}</span>
                                  </div>
                                </div>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 10, paddingLeft: 30 }}>
                                {f.url && <button onClick={() => setPreviewFile({ url: f.url!, name: `${title}.pdf`, type: 'application/pdf' })} style={ghost}>👁 View</button>}
                                <button onClick={() => { setFormDealId(null); openFormEditor({ id: f.form_id || '', name: f.crm_forms?.name || f.title || 'Form' }, f.id, f.crm_forms?.form_code); }} disabled={!f.form_id}
                                  style={{ ...ghost, color: 'var(--k-a06a12)', border: '1px solid var(--k-f0e2c4)', fontWeight: 700, cursor: f.form_id ? 'pointer' : 'default', opacity: f.form_id ? 1 : 0.5 }}>Edit</button>
                                {signed
                                  ? (env!.executed_url && <button onClick={() => setPreviewFile({ url: env!.executed_url!, name: `${title} (signed).pdf`, type: 'application/pdf' })} title="View the executed copy" style={{ ...btn, color: 'var(--k-15803d)', background: 'var(--k-dcfce7)', border: 'none', fontWeight: 700 }}>View signed copy</button>)
                                  : live
                                    ? <button onClick={() => openSendModal(null, f)} title="Send the signature request again" style={{ ...btn, color: 'var(--k-a06a12)', background: 'var(--k-fff)', border: '1px solid var(--k-f0e2c4)', fontWeight: 700 }}>↻ Resend</button>
                                    : <button onClick={() => openSendModal(null, f)} disabled={!f.url} title={f.url ? 'Send for signature' : 'Fill and save the form first'} style={{ ...btn, color: '#fff', background: f.url ? '#c9922c' : 'var(--k-e5e7eb)', border: 'none', fontWeight: 700, cursor: f.url ? 'pointer' : 'default' }}>📤 Send for signature</button>}
                                <div style={{ marginLeft: 'auto', position: 'relative' }}>
                                  <button onClick={() => setDocMenu(docMenu === f.id ? null : f.id)} aria-label="More actions" title="More: email, copy, cancel request, delete" style={{ ...ghost, padding: '6px 11px', fontSize: 16, lineHeight: 1 }}>⋯</button>
                                  {docMenu === f.id && (
                                    <>
                                      <div onClick={() => setDocMenu(null)} style={{ position: 'fixed', inset: 0, zIndex: 20 }} />
                                      <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 4px)', zIndex: 21, minWidth: 200, background: 'var(--k-fff)', border: '1px solid var(--k-e5e7eb)', borderRadius: 10, boxShadow: '0 10px 30px rgba(0,0,0,.14)', overflow: 'hidden' }}>
                                        {f.url && <button style={menuItem} onClick={() => { setDocMenu(null); setEmailDocId(f.id); }}>✉ Email this PDF</button>}
                                        <button style={menuItem} onClick={() => { setDocMenu(null); setRenameDraft(title); setRenamingDoc(f.id); }}>✎ Rename</button>
                                        <button style={menuItem} onClick={() => { setDocMenu(null); copySubmission(f.id); }}>⧉ Make a copy</button>
                                        {live && !signed && <button style={{ ...menuItem, color: 'var(--k-b91c1c)' }} onClick={() => { setDocMenu(null); voidEnvelope(env!.id); }}>⊘ Cancel signature request</button>}
                                        <button style={{ ...menuItem, color: 'var(--k-dc2626)', borderTop: '1px solid var(--k-f3f4f6)' }} onClick={() => { setDocMenu(null); deleteSubmission(f.id); }}>✕ Delete document</button>
                                      </div>
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* ── Uploaded files — same card language as the documents above ── */}
                  {(() => {
                    const head = (title: string, count?: number) => (
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '26px 0 10px' }}>
                        <span style={{ fontSize: 12, letterSpacing: .8, textTransform: 'uppercase', color: '#c9922c', fontWeight: 700 }}>{title}</span>
                        {count !== undefined && <span style={{ fontSize: 11.5, color: 'var(--k-9ca3af)', background: 'var(--k-f3f4f6)', borderRadius: 10, padding: '1px 8px', fontWeight: 600 }}>{count}</span>}
                      </div>
                    );
                    const row = (f: (typeof files)[number]) => (
                      <div key={f.id} style={{ background: 'var(--k-fff)', border: '1px solid var(--k-e8e6df)', borderRadius: 10, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span style={{ fontSize: 22, flexShrink: 0 }}>{fileIcon(f.file_type, f.category)}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div title={f.name} style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--k-1a1a1a)', lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', wordBreak: 'break-word' } as React.CSSProperties}>{f.name}</div>
                          <div style={{ fontSize: 11.5, color: 'var(--k-9ca3af)', marginTop: 2 }}>{fmtBytes(f.file_size)}{f.created_at ? ` · ${new Date(f.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}</div>
                        </div>
                        <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
                          {onSignFile && active && f.url && f.file_type === 'application/pdf' && (
                            <button onClick={() => onSignFile(f.url!, f.name, active.id)} title="Import this PDF into E-Sign and send it for signature"
                              style={{ padding: '6px 11px', background: '#c9922c', color: '#fff', border: 'none', borderRadius: 7, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', minHeight: 32 }}>✍️ Sign</button>
                          )}
                          {f.url && (
                            <button onClick={() => setPreviewFile({ url: f.url!, name: f.name, type: f.file_type })}
                              style={{ padding: '6px 11px', background: 'var(--k-fff)', border: '1px solid var(--k-e5e7eb)', borderRadius: 7, fontSize: 12.5, color: 'var(--k-374151)', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', minHeight: 32 }}>👁 View</button>
                          )}
                          {isAdmin && (
                            <button onClick={() => deleteFile(f.id, f.name)} aria-label={`Remove ${f.name}`} title="Remove this file"
                              style={{ padding: '6px 9px', background: 'var(--k-fff)', border: '1px solid var(--k-fecaca)', borderRadius: 7, fontSize: 12.5, color: 'var(--k-dc2626)', cursor: 'pointer', minHeight: 32 }}>✕</button>
                          )}
                        </div>
                      </div>
                    );
                    const knownCats = new Set(CATEGORIES.map(c => c.key));
                    const other = files.filter(f => !knownCats.has(f.category));
                    const groups = [...CATEGORIES.map(c => ({ key: c.key, label: c.label, items: files.filter(f => f.category === c.key) })), { key: '_other', label: '📎 Other', items: other }].filter(g => g.items.length);
                    return (
                      <>
                        {head('Uploaded files', filesLoading ? undefined : files.length)}
                        {/* Upload: one slim row (drag a file onto it, or pick a category and choose a file) */}
                        {isAdmin && (
                          <div
                            onDragOver={e => { e.preventDefault(); setDropOver(true); }}
                            onDragLeave={() => setDropOver(false)}
                            onDrop={e => {
                              e.preventDefault(); setDropOver(false);
                              const input = fileInputRef.current;
                              if (!input || !e.dataTransfer.files.length || uploading) return;
                              input.files = e.dataTransfer.files;                                   // hand the dropped file to the same handler the button uses
                              input.dispatchEvent(new Event('change', { bubbles: true }));
                            }}
                            style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', background: dropOver ? 'var(--k-fff8e6)' : 'var(--k-fafaf7)', border: `1.5px dashed ${dropOver ? '#c9922c' : 'var(--k-d9d4c4)'}`, borderRadius: 10, padding: '10px 12px', marginBottom: 14, transition: 'background .12s, border-color .12s' }}>
                            <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
                              style={{ padding: '8px 16px', background: '#c9922c', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13.5, fontWeight: 700, cursor: uploading ? 'not-allowed' : 'pointer', opacity: uploading ? 0.6 : 1, whiteSpace: 'nowrap', minHeight: 40 }}>
                              {uploading ? 'Uploading…' : '＋ Upload a file'}
                            </button>
                            <span style={{ fontSize: 12.5, color: 'var(--k-6b7280)' }}>into</span>
                            <select value={uploadCat} onChange={e => setUploadCat(e.target.value)} aria-label="File category"
                              style={{ ...INP, width: 'auto', minHeight: 40, padding: '6px 10px', fontSize: 14, flex: '0 1 auto' }}>
                              {CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                            </select>
                            <span style={{ fontSize: 11.5, color: 'var(--k-9ca3af)', flexBasis: '100%' }}>{dropOver ? 'Drop to upload' : 'or drag a file here · PDF, Word, Excel, PowerPoint, images, ZIP · up to 50 MB'}</span>
                            <input ref={fileInputRef} type="file" style={{ display: 'none' }} onChange={uploadFile}
                              accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.gif,.webp,.ppt,.pptx,.zip,.txt,.csv" />
                          </div>
                        )}
                        {filesLoading ? (
                          <div style={{ textAlign: 'center', padding: 30, color: 'var(--k-9ca3af)', fontSize: 14 }}>Loading files…</div>
                        ) : files.length === 0 ? (
                          <div style={{ textAlign: 'center', padding: '22px 0 8px', color: 'var(--k-9ca3af)' }}>
                            <div style={{ fontSize: 28, marginBottom: 6 }}>📁</div>
                            <div style={{ fontSize: 13 }}>No files uploaded yet</div>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                            {groups.map(g => (
                              <div key={g.key}>
                                <div style={{ fontSize: 11.5, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--k-9ca3af)', fontWeight: 700, marginBottom: 8 }}>{g.label} · {g.items.length}</div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{g.items.map(row)}</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              )}

              {/* ── Rent Roll tab (per-suite tenancy, vendors, building info) ── */}
              {draftingLease && active && (
                <LeaseDraftModal
                  listingId={active.id} authToken={authToken} onToast={onToast}
                  onClose={() => setDraftingLease(false)}
                  onCreate={async (v: LeaseDraftValues) => {
                    const r = await fetch('/api/crm/lease-draft', {
                      method: 'PUT', headers: { 'Content-Type': 'application/json', ...authHeaders },
                      body: JSON.stringify({ listing_id: active.id, values: v }),
                    });
                    const j = await r.json().catch(() => ({}));
                    if (!r.ok) { onToast(j.error || 'Could not create the lease'); return; }
                    onToast(j.linked_to_contact ? '✓ Lease created — filed on the property and the contact' : '✓ Lease created');
                    setDraftingLease(false);
                    loadListingForms(active.id);
                  }} />
              )}

              {activeTab === 'recon' && canSeeRentRoll && (
                <CamReconciliation
                  listingId={active.id} listingName={active.address || 'the property'}
                  address={[active.address, active.city, active.state].filter(Boolean).join(', ')}
                  authToken={authToken} isAdmin={isAdmin} onToast={onToast}
                  onPreview={f => setPreviewFile({ url: f.url, name: f.name, type: 'application/pdf' })} />
              )}

              {activeTab === 'performance' && (
                <PropertyPerformance listingId={active.id} authToken={authToken} isMobile={window.innerWidth < 768} onToast={onToast} />
              )}

              {activeTab === 'rentroll' && canSeeRentRoll && (
                <RentRoll listingId={active.id} listingName={active.name || active.address || ''} authToken={authToken} isAdmin={isAdmin} contacts={clients} onToast={onToast} profiles={profiles} onMention={onMention} />
              )}

              {activeTab === 'leasing' && canSeeRentRoll && (
                <div style={{ padding: '0 20px 20px' }}>
                  <LeasingActivity listingId={active.id} authToken={authToken} isAdmin={isAdmin} onToast={onToast} />
                </div>
              )}

              {activeTab === 'prospects' && canSeeRentRoll && (
                <div style={{ padding: '0 20px 20px' }}>
                  <EmailProspects listingId={active.id} authToken={authToken} emptyHint />
                </div>
              )}

              {/* ── Deals tab (deals at this property + their documents) ── */}
              {activeTab === 'deals' && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
                    <div style={{ fontSize: 12, letterSpacing: .8, textTransform: 'uppercase', color: '#c9922c', fontWeight: 700 }}>Deals at this Property</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => { loadAllDeals(); setShowLinkDeal(true); }} style={{ padding: '6px 12px', fontSize: 12.5, fontWeight: 700, background: 'var(--k-fff)', color: 'var(--k-a06a12)', border: '1px solid var(--k-f0e2c4)', borderRadius: 8, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>🔗 Link deal</button>
                      <button onClick={() => setShowNewDeal(true)} style={{ padding: '6px 12px', fontSize: 12.5, fontWeight: 700, background: '#c9922c', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>＋ New deal</button>
                    </div>
                  </div>
                  {deals.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--k-9ca3af)' }}>
                      <div style={{ fontSize: 34, marginBottom: 8 }}>💼</div>
                      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 3, color: 'var(--k-6b7280)' }}>No deals at this property yet</div>
                      <div style={{ fontSize: 13 }}>Start a deal to draft LOIs, leases &amp; condition reports here — then send them for signature.</div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {deals.map(d => {
                        const agent = profiles.find(p => p.id === d.agent_id);
                        const chip = STAGE_CHIP[d.stage || 'Prospect'] || STAGE_CHIP.Prospect;
                        // The deal endpoint mirrors the property's own docs into every deal; on the
                        // property page those already show under Documents, so a deal card lists only
                        // the docs that belong to that deal (otherwise each card repeated them, and its
                        // Edit/✕ acted on a doc that isn't the deal's).
                        const allDocs = (dealForms[d.id] ?? []).filter(f => f.deal_id === d.id);
                        // Filled docs get a row; blanks live in the dropdown below.
                        const docs = allDocs.filter(f => f.url);
                        const waiting = allDocs.filter(f => !f.url);
                        const onDeal = new Set(allDocs.map(f => f.form_id).filter(Boolean) as string[]);
                        const library = crmForms.filter(fm => !onDeal.has(fm.id));
                        const pick = dealFormPick[d.id] ?? '';
                        const pickIsWaiting = pick.startsWith('sub:');
                        const runPick = () => {
                          if (!pick) return;
                          if (pickIsWaiting) {
                            const f = waiting.find(w => w.id === pick.slice(4));
                            if (f) editDealForm(d.id, { id: f.form_id || '', name: f.crm_forms?.name || f.title || 'Form' }, f.id, f.crm_forms?.form_code);
                            setDealFormPick(prev => ({ ...prev, [d.id]: '' }));
                          } else {
                            const fm = crmForms.find(x => x.id === pick.slice(4));
                            if (fm) addFormToDeal(d.id, fm);
                          }
                        };
                        return (
                          <div key={d.id} style={{ border: '1px solid #eef0f2', borderRadius: 12, background: 'var(--k-fff)', overflow: 'hidden' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', background: 'var(--k-fbfbfa)', borderBottom: '1px solid var(--k-f3f4f6)' }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                  <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--k-1a1a1a)' }}>{d.client || 'Unnamed'}</span>
                                  <span style={{ fontSize: 11, fontWeight: 700, background: chip.bg, color: chip.color, padding: '2px 9px', borderRadius: 20 }}>{d.stage || 'Prospect'}</span>
                                </div>
                                <div style={{ fontSize: 12, color: 'var(--k-9ca3af)', marginTop: 2 }}>
                                  {d.type || '—'}{d.value ? ` · ${fmt$(d.value)}` : ''}{agent ? ` · ${agent.first_name} ${agent.last_name}` : ''}
                                </div>
                              </div>
                              <button onClick={() => unlinkDeal(d.id)} title="Remove from property" style={{ background: 'none', border: '1px solid var(--k-e5e7eb)', borderRadius: 7, color: 'var(--k-9ca3af)', fontSize: 13, cursor: 'pointer', padding: '5px 8px', flexShrink: 0 }}>✕</button>
                            </div>
                            {/* Add a form to this deal — blanks waiting first, then the library */}
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '10px 14px 0', flexWrap: 'wrap' }}>
                              <select value={pick} onChange={e => setDealFormPick(prev => ({ ...prev, [d.id]: e.target.value }))}
                                style={{ flex: 1, minWidth: 190, padding: '7px 10px', borderRadius: 8, border: '1px solid var(--k-e5e7eb)', background: 'var(--k-fff)', fontSize: 13, color: 'var(--k-374151)', fontFamily: "'DM Sans',sans-serif", cursor: 'pointer' }}>
                                <option value="">— Add a form to this deal —</option>
                                {waiting.length > 0 && (
                                  <optgroup label={`Waiting to be filled · ${waiting.length}`}>
                                    {waiting.map(f => (
                                      <option key={f.id} value={`sub:${f.id}`}>
                                        {f.title || f.crm_forms?.name || 'Form'}{f.crm_forms?.form_code ? ` · ${f.crm_forms.form_code}` : ''}
                                      </option>
                                    ))}
                                  </optgroup>
                                )}
                                {library.length > 0 && (
                                  <optgroup label="All forms">
                                    {library.map(fm => (
                                      <option key={fm.id} value={`lib:${fm.id}`}>{fm.name}{fm.form_code ? ` · ${fm.form_code}` : ''}</option>
                                    ))}
                                  </optgroup>
                                )}
                              </select>
                              <button onClick={runPick} disabled={!pick || dealFormAdding === d.id}
                                style={{ padding: '7px 14px', fontSize: 12.5, fontWeight: 700, borderRadius: 8, border: 'none', flexShrink: 0, fontFamily: "'DM Sans',sans-serif",
                                  background: pick ? '#c9922c' : 'var(--k-e5e7eb)', color: pick ? '#fff' : 'var(--k-9ca3af)', cursor: pick && dealFormAdding !== d.id ? 'pointer' : 'default' }}>
                                {dealFormAdding === d.id ? 'Adding…' : pickIsWaiting ? '✍️ Fill' : '+ Add'}
                              </button>
                            </div>
                            {docs.length > 0 && (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 14px' }}>
                                {docs.map(f => (
                                  <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--k-fffdf6)', border: '1px solid var(--k-f0e2c4)', borderRadius: 8, padding: '8px 12px' }}>
                                    <span style={{ fontSize: 17, flexShrink: 0 }}>📄</span>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                      <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--k-1a1a1a)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.title || f.crm_forms?.name || 'Form'}</div>
                                      <div style={{ fontSize: 11.5, color: 'var(--k-9ca3af)' }}>{f.updated_at ? `updated ${new Date(f.updated_at).toLocaleDateString()}` : ''}</div>
                                    </div>
                                    {f.url && <button onClick={() => setPreviewFile({ url: f.url!, name: `${f.title || f.crm_forms?.name || 'Document'}.pdf`, type: 'application/pdf' })} style={{ fontSize: 12, fontWeight: 600, color: 'var(--k-6b7280)', background: 'var(--k-fff)', border: '1px solid var(--k-e5e7eb)', borderRadius: 7, padding: '5px 9px', cursor: 'pointer', flexShrink: 0 }}>👁 View</button>}
                                    {f.url && <button onClick={() => setEmailDocId(f.id)} title="Email this PDF as an attachment" style={{ fontSize: 12, fontWeight: 700, color: 'var(--k-a06a12)', background: 'var(--k-fff)', border: '1px solid var(--k-f0e2c4)', borderRadius: 7, padding: '6px 10px', cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap' }}>✉ Email</button>}

                                    {(() => {
                                      const env = envMap[f.id];
                                      if (env && env.status !== 'voided') {
                                        const sg = env.crm_envelope_signers || [];
                                        const done = sg.filter(s => s.status === 'signed' || s.signed_at).length;
                                        const pending = env.status !== 'completed';
                                        return (
                                          <>
                                            {env.status === 'completed' && env.executed_url
                                              ? <button onClick={() => setPreviewFile({ url: env.executed_url!, name: `${f.title || f.crm_forms?.name || 'Document'} (signed).pdf`, type: 'application/pdf' })} style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--k-15803d)', background: 'var(--k-dcfce7)', border: 'none', borderRadius: 7, padding: '5px 10px', cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap' }}>✓ Signed</button>
                                              : <span title="Out for signature" style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--k-1d4ed8)', background: 'var(--k-dbeafe)', borderRadius: 7, padding: '5px 10px', flexShrink: 0, whiteSpace: 'nowrap' }}>📤 Sent · {done}/{sg.length}</span>}
                                            <button onClick={() => openSendModal(d, f)} disabled={!f.url} title="Resend for signature (e.g. after making edits)" style={{ fontSize: 13, fontWeight: 700, color: 'var(--k-a06a12)', background: 'var(--k-fff)', border: '1px solid var(--k-f0e2c4)', borderRadius: 7, padding: '5px 8px', cursor: f.url ? 'pointer' : 'default', flexShrink: 0 }}>↻</button>
                                            {pending && <button onClick={() => voidEnvelope(env.id)} title="Cancel the signature request" style={{ fontSize: 13, fontWeight: 700, color: 'var(--k-b91c1c)', background: 'var(--k-fff)', border: '1px solid var(--k-fecaca)', borderRadius: 7, padding: '5px 8px', cursor: 'pointer', flexShrink: 0 }}>⊘</button>}
                                          </>
                                        );
                                      }
                                      return <button onClick={() => openSendModal(d, f)} disabled={!f.url} title={f.url ? 'Send for signature' : 'Fill and save the form first'} style={{ fontSize: 12, fontWeight: 700, color: '#fff', background: f.url ? '#c9922c' : 'var(--k-e5e7eb)', border: 'none', borderRadius: 7, padding: '5px 10px', cursor: f.url ? 'pointer' : 'default', flexShrink: 0, whiteSpace: 'nowrap' }}>📤 Send</button>;
                                    })()}
                                    <button onClick={() => editDealForm(d.id, { id: f.form_id || '', name: f.crm_forms?.name || f.title || 'Form' }, f.id, f.crm_forms?.form_code)} disabled={!f.form_id} style={{ fontSize: 12, fontWeight: 700, color: 'var(--k-a06a12)', background: 'var(--k-fff)', border: '1px solid var(--k-f0e2c4)', borderRadius: 7, padding: '5px 10px', cursor: f.form_id ? 'pointer' : 'default', flexShrink: 0 }}>Edit</button>
                                    <button onClick={() => copySubmission(f.id, { dealId: d.id })} title="Make a copy" style={{ fontSize: 12, fontWeight: 700, color: 'var(--k-6b7280)', background: 'var(--k-fff)', border: '1px solid var(--k-e5e7eb)', borderRadius: 7, padding: '5px 8px', cursor: 'pointer', flexShrink: 0 }}>⧉</button>
                                    <button onClick={() => deleteSubmission(f.id, { dealId: d.id })} title="Delete document" style={{ fontSize: 12, fontWeight: 700, color: 'var(--k-dc2626)', background: 'var(--k-fff)', border: '1px solid var(--k-fecaca)', borderRadius: 7, padding: '5px 8px', cursor: 'pointer', flexShrink: 0 }}>✕</button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div style={{ fontSize: 11.5, color: '#c0c4cc', marginTop: 14, textAlign: 'center' }}>Forms filled here attach to the deal and show on this property. Tap 📤 Send to route one for e-signature.</div>
                </div>
              )}

              {/* ── Photos tab ── */}
              {activeTab === 'photos' && (
                <div>
                  {(() => {
                    // A file can be filed under "photo" without being one — a survey PDF
                    // was showing here as a broken image, and the flyer would have tried
                    // to use it as artwork. Judge by the actual type.
                    const isImage = (f: ListingFile) => (f.file_type || '').toLowerCase().startsWith('image/')
                      || /\.(jpe?g|png|gif|webp|heic|avif)$/i.test(f.name || '');
                    const allPhotoCat = files.filter(f => f.category === 'photo');
                    const photos = allPhotoCat.filter(isImage);
                    const notImages = allPhotoCat.filter(f => !isImage(f));
                    if (filesLoading) return <Skeleton rows={4} />;
                    const act: React.CSSProperties = { border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 700, padding: '3px 7px', cursor: 'pointer', lineHeight: 1.4, fontFamily: "'DM Sans',sans-serif" };
                    return (
                      <div>
                        <input ref={photoInputRef} type="file" accept="image/*" multiple style={{ display: 'none' }}
                          onChange={e => { const l = e.target.files; e.target.value = ''; addPhotos(l); }} />
                        <input ref={replaceRef} type="file" accept="image/*" style={{ display: 'none' }}
                          onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) replacePhoto(f); }} />

                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
                          <button onClick={() => photoInputRef.current?.click()} disabled={photoBusy}
                            style={{ ...act, padding: '7px 13px', fontSize: 12.5, background: '#c9922c', color: '#fff', opacity: photoBusy ? 0.6 : 1 }}>
                            {photoBusy ? 'Working…' : '＋ Add photos'}
                          </button>
                          <span style={{ fontSize: 12, color: 'var(--k-9ca3af)' }}>
                            {photos.length} photo{photos.length === 1 ? '' : 's'} · drag to reorder — the first one is the flyer cover
                          </span>
                        </div>

                        {notImages.length > 0 && (
                          <div style={{ fontSize: 12.5, color: 'var(--k-7c5a12)', background: 'var(--k-fffdf6)', border: '1px solid var(--k-f0e2c4)', borderRadius: 9, padding: '9px 12px', marginBottom: 12 }}>
                            ⚠ {notImages.length} file{notImages.length === 1 ? '' : 's'} here {notImages.length === 1 ? 'is' : 'are'} not an image ({notImages.map(f => f.name).join(', ')}) — {notImages.length === 1 ? 'it won\u2019t' : 'they won\u2019t'} appear on the flyer. Move {notImages.length === 1 ? 'it' : 'them'} to Documents.
                          </div>
                        )}
                        {photos.length === 0 ? (
                          <div
                            onDragOver={e => e.preventDefault()}
                            onDrop={e => { e.preventDefault(); addPhotos(e.dataTransfer.files); }}
                            onClick={() => photoInputRef.current?.click()}
                            style={{ textAlign: 'center', padding: 40, color: 'var(--k-9ca3af)', border: '2px dashed var(--k-e6d3a2)', borderRadius: 12, background: 'var(--k-fffdf6)', cursor: 'pointer' }}>
                            <div style={{ fontSize: 32, marginBottom: 8 }}>🖼</div>
                            <div style={{ fontSize: 13 }}>Drop photos here, or click to browse.</div>
                          </div>
                        ) : (
                          <div
                            onDragOver={e => e.preventDefault()}
                            onDrop={e => { e.preventDefault(); if (!dragPhoto) addPhotos(e.dataTransfer.files); }}
                            style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
                            {photos.map((f, i) => (
                              <div key={f.id}
                                draggable
                                onDragStart={() => setDragPhoto(f.id)}
                                onDragEnd={() => setDragPhoto(null)}
                                onDragOver={e => e.preventDefault()}
                                onDrop={e => { e.preventDefault(); e.stopPropagation(); if (dragPhoto) movePhoto(photos, dragPhoto, f.id); setDragPhoto(null); }}
                                onMouseEnter={() => setHoverPhoto(f.id)}
                                onMouseLeave={() => setHoverPhoto(h => (h === f.id ? null : h))}
                                onTouchStart={() => setHoverPhoto(f.id)}
                                style={{ position: 'relative', borderRadius: 10, overflow: 'hidden', aspectRatio: '4 / 3', background: 'var(--k-f3f4f6)',
                                  border: i === 0 ? `2px solid #c9922c` : '1px solid #eef0f2',
                                  opacity: dragPhoto === f.id ? 0.4 : 1, cursor: 'grab' }}>
                                {f.url && <img src={f.url} alt={f.name} loading="lazy" draggable={false} onClick={() => setPreviewFile({ url: f.url!, name: f.name, type: f.file_type })} style={{ width: '100%', height: '100%', objectFit: 'cover', cursor: 'pointer' }} />}
                                {i === 0 && (
                                  <span style={{ position: 'absolute', top: 6, left: 6, background: '#c9922c', color: '#fff', fontSize: 10.5, fontWeight: 800, padding: '2px 7px', borderRadius: 20 }}>★ COVER</span>
                                )}
                                <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, display: 'flex', gap: 4, justifyContent: 'center', padding: 5, background: 'linear-gradient(transparent, rgba(0,0,0,.6))',
                                  opacity: hoverPhoto === f.id || dragPhoto === f.id ? 1 : 0, transition: 'opacity .12s', pointerEvents: hoverPhoto === f.id || dragPhoto === f.id ? 'auto' : 'none' }}>
                                  {i !== 0 && <button onClick={() => makeCover(photos, f.id)} title="Use as the flyer cover" style={{ ...act, background: 'rgba(255,255,255,.92)', color: 'var(--k-a06a12)' }}>★ Cover</button>}
                                  <button onClick={() => { replacingRef.current = f; replaceRef.current?.click(); }} disabled={photoBusy} title="Swap this photo, keeping its position" style={{ ...act, background: 'rgba(255,255,255,.92)', color: 'var(--k-374151)' }}>⇄ Replace</button>
                                  <button onClick={() => deleteFile(f.id, f.name)} title="Remove this photo" style={{ ...act, background: 'rgba(255,255,255,.92)', color: 'var(--k-b91c1c)' }}>✕</button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* ── Contacts tab ── */}
              {activeTab === 'contacts' && (
                <div>
                  {/* Add a contact */}
                  <div style={{ background: 'var(--k-f8fafc)', border: '1px solid #eef0f2', borderRadius: 10, padding: '14px 16px', marginBottom: 18 }}>
                    <div style={{ display: 'flex', gap: 8, marginBottom: contactSearch.trim() ? 10 : 0, flexWrap: 'wrap' }}>
                      <select value={contactRole} onChange={e => setContactRole(e.target.value)} style={{ ...INP, width: 'auto', flex: 'none', fontSize: 15 }}>
                        {['Landlord','Tenant','Buyer','Seller','Listing Agent','Co-broker','Attorney','Property Mgr','Vendor','Other'].map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                      <input value={contactSearch} onChange={e => setContactSearch(e.target.value)} placeholder="🔍  Search contacts to add…" style={{ ...INP, flex: 1, minWidth: 150, fontSize: 15 }} />
                    </div>
                    {contactSearch.trim() && (() => {
                      const q = contactSearch.toLowerCase();
                      const linked = new Set(listingContacts.map(c => c.client_id));
                      const matches = clients.filter(c => !linked.has(c.id) && `${c.first_name} ${c.last_name} ${c.business_name ?? ''}`.toLowerCase().includes(q)).slice(0, 20);
                      return (
                        <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid #eef0f2', borderRadius: 8, background: 'var(--k-fff)' }}>
                          {matches.length === 0 ? (
                            <button onClick={() => createAndLinkContact(contactSearch)} disabled={addingContact}
                              style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '10px 12px', border: 'none', background: 'var(--k-fffdf6)', cursor: addingContact ? 'default' : 'pointer', fontFamily: "'DM Sans',sans-serif", fontSize: 13.5, fontWeight: 700, color: 'var(--k-a06a12)' }}>
                              ＋ Add “{contactSearch.trim()}” as a new {contactRole.toLowerCase()} contact
                            </button>
                          ) : matches.map(c => (
                            <button key={c.id} onClick={() => addContact(c.id)} disabled={addingContact}
                              style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '9px 12px', border: 'none', borderBottom: '1px solid var(--k-f3f4f6)', background: 'var(--k-fff)', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
                              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--k-111)' }}>{c.first_name} {c.last_name}</span>
                              {c.business_name && <span style={{ fontSize: 12, color: 'var(--k-9ca3af)' }}>· {c.business_name}</span>}
                              {c.type && <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--k-9ca3af)' }}>{c.type}</span>}
                            </button>
                          ))}
                        </div>
                      );
                    })()}
                  </div>

                  {/* Linked contacts */}
                  {listingContacts.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: 40, color: 'var(--k-9ca3af)' }}>
                      <div style={{ fontSize: 32, marginBottom: 8 }}>👥</div>
                      <div style={{ fontSize: 13 }}>No contacts linked yet. Add the landlord, tenant, agents, attorney, etc. above.</div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {listingContacts.map(lc => {
                        const c = lc.crm_clients;
                        const name = c ? `${c.first_name} ${c.last_name}` : 'Contact';
                        const phone = c?.phone || c?.cell_phone || '';
                        return (
                          <div key={lc.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--k-fff)', border: '1px solid #eef0f2', borderRadius: 10, padding: '11px 14px' }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--k-111)' }}>{name}</span>
                                {lc.role && <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--k-a06a12)', background: 'var(--k-fdf6e9)', border: '1px solid var(--k-f0e2c4)', borderRadius: 20, padding: '1px 8px' }}>{lc.role}</span>}
                              </div>
                              {(c?.business_name || phone || c?.email) && <div style={{ fontSize: 12, color: 'var(--k-9ca3af)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{[c?.business_name, phone, c?.email].filter(Boolean).join(' · ')}</div>}
                            </div>
                            {phone && <a href={`tel:${phone}`} title="Call" style={{ fontSize: 13, color: 'var(--k-16a34a)', textDecoration: 'none', border: '1px solid var(--k-bbf7d0)', borderRadius: 7, padding: '5px 9px', flexShrink: 0 }}>📞</a>}
                            {c?.email && <a href={`mailto:${c.email}`} title="Email" style={{ fontSize: 13, color: 'var(--k-2563eb)', textDecoration: 'none', border: '1px solid var(--k-bfdbfe)', borderRadius: 7, padding: '5px 9px', flexShrink: 0 }}>✉️</a>}
                            {isAdmin && <button onClick={() => removeContact(lc.id, lc.crm_clients ? (lc.crm_clients.business_name || `${lc.crm_clients.first_name ?? ''} ${lc.crm_clients.last_name ?? ''}`.trim()) : undefined)} title="Remove from this property" style={{ background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer', fontSize: 15, flexShrink: 0 }}>🗑</button>}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* ── Team tab (sharing) ── */}
              {activeTab === 'team' && (
                <div>
                  <div style={{ fontSize: 12, letterSpacing: .8, textTransform: 'uppercase', color: '#c9922c', fontWeight: 700, marginBottom: 10 }}>Owner</div>
                  <select value={teamOwner} onChange={e => setTeamOwner(e.target.value)} style={{ ...INP, marginBottom: 20, fontSize: 15 }}>
                    <option value="">— Unassigned —</option>
                    {profiles.map(p => <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>)}
                  </select>

                  <div style={{ fontSize: 12, letterSpacing: .8, textTransform: 'uppercase', color: '#c9922c', fontWeight: 700, marginBottom: 10 }}>Shared with</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 20 }}>
                    {profiles.filter(p => p.id !== teamOwner).map(p => {
                      const on = teamAssigned.includes(p.id);
                      return (
                        <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 8, border: `1px solid ${on ? '#c9922c' : '#eef0f2'}`, background: on ? 'var(--k-fdf6e9)' : 'var(--k-fff)', cursor: 'pointer' }}>
                          <input type="checkbox" checked={on} onChange={() => setTeamAssigned(a => on ? a.filter(x => x !== p.id) : [...a, p.id])} style={{ accentColor: '#c9922c' }} />
                          <span style={{ fontSize: 14, color: 'var(--k-374151)', fontWeight: 500 }}>{p.first_name} {p.last_name}</span>
                        </label>
                      );
                    })}
                    {profiles.filter(p => p.id !== teamOwner).length === 0 && <div style={{ fontSize: 13, color: 'var(--k-9ca3af)' }}>No other teammates in this workspace.</div>}
                  </div>

                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 14px', borderRadius: 10, border: '1px solid #eef0f2', background: 'var(--k-f8fafc)', cursor: 'pointer', marginBottom: 20 }}>
                    <input type="checkbox" checked={teamRestricted} onChange={e => setTeamRestricted(e.target.checked)} style={{ accentColor: '#c9922c', marginTop: 2 }} />
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--k-111)' }}>🔒 Restricted folder</div>
                      <div style={{ fontSize: 12, color: 'var(--k-6b7280)', marginTop: 2 }}>When on, only the owner, the teammates above, and admins can see and open this property. Off = visible to the whole team.</div>
                    </div>
                  </label>

                  <button onClick={saveTeam} disabled={teamSaving}
                    style={{ width: '100%', padding: '11px 0', borderRadius: 8, border: 'none', background: '#c9922c', color: '#fff', fontSize: 14, fontWeight: 700, cursor: teamSaving ? 'default' : 'pointer', opacity: teamSaving ? 0.6 : 1, fontFamily: "'DM Sans',sans-serif" }}>
                    {teamSaving ? 'Saving…' : 'Save sharing'}
                  </button>
                </div>
              )}
            </div>

            {/* Panel footer */}
            {activeTab === 'info' && isAdmin && (
              <div style={{ padding: '14px 24px', borderTop: '1px solid var(--k-f0f0f0)', display: 'flex', gap: 10 }}>
                <button onClick={deleteListing}
                  style={{ padding: '9px 14px', borderRadius: 8, border: '1px solid var(--k-fecaca)', background: 'var(--k-fff)', color: 'var(--k-dc2626)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
                  Delete
                </button>
                <button onClick={closePanel}
                  style={{ padding: '9px 18px', borderRadius: 8, border: '1px solid var(--k-e5e7eb)', background: 'var(--k-fff)', color: 'var(--k-6b7280)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
                  Cancel
                </button>
                <button onClick={saveListing} disabled={!dirty}
                  style={{ flex: 1, padding: '9px 18px', borderRadius: 8, border: 'none', background: dirty ? '#c9922c' : 'var(--k-e5e7eb)', color: dirty ? '#fff' : 'var(--k-9ca3af)', fontSize: 13, fontWeight: 700, cursor: dirty ? 'pointer' : 'default', fontFamily: "'DM Sans',sans-serif", transition: 'all .15s' }}>
                  Save Changes
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── New Listing Modal ─────────────────────────────────────────────────── */}
      {showNew && (
        <div className="crm-sheet" style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px', overflowY: 'auto' }}
          onClick={e => { if (e.target === e.currentTarget) setShowNew(false); }}>
          <div className="crm-sheet-panel" style={{ background: 'var(--k-fff)', borderRadius: 16, padding: 28, width: '100%', maxWidth: 540, boxShadow: '0 24px 64px rgba(0,0,0,.2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <h3 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 22, fontWeight: 700, margin: 0, color: 'var(--k-111)' }}>New Listing</h3>
              <button onClick={() => setShowNew(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--k-6b7280)', fontSize: 20, lineHeight: 1 }}>✕</button>
            </div>
            {renderForm({ form: newForm, onChange: setNewForm })}
            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
              <button onClick={() => setShowNew(false)}
                style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: '1px solid var(--k-e5e7eb)', background: 'var(--k-fff)', color: 'var(--k-6b7280)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>Cancel</button>
              <button onClick={createListing} disabled={!newForm.name.trim() || creating}
                style={{ flex: 2, padding: '10px 0', borderRadius: 8, border: 'none', background: newForm.name.trim() ? '#c9922c' : 'var(--k-e5e7eb)', color: newForm.name.trim() ? '#fff' : 'var(--k-9ca3af)', fontSize: 13, fontWeight: 700, cursor: newForm.name.trim() ? 'pointer' : 'default', fontFamily: "'DM Sans',sans-serif" }}>
                {creating ? 'Creating…' : 'Create Listing'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Form picker: choose a transaction-doc template for this property ── */}
      {/* New Deal at this property */}
      {showNewDeal && active && (
        <div className="crm-sheet" style={{ position: 'fixed', inset: 0, zIndex: 600, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px', overflowY: 'auto' }}
          onClick={e => { if (e.target === e.currentTarget) setShowNewDeal(false); }}>
          <div className="crm-sheet-panel" style={{ background: 'var(--k-fff)', borderRadius: 16, padding: 24, width: '100%', maxWidth: 540, boxShadow: '0 24px 64px rgba(0,0,0,.2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 20, fontWeight: 700, margin: 0, color: 'var(--k-111)' }}>New Deal — {active.name}</h3>
              <button onClick={() => setShowNewDeal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--k-6b7280)', fontSize: 20, lineHeight: 1 }}>✕</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                {LBL('Client *')}
                <input style={INP} value={newDeal.client} onChange={e => setNewDeal({ ...newDeal, client: e.target.value, client_id: '' })} placeholder="Client or company name" />
                {newDeal.client.trim().length >= 2 && !newDeal.client_id && (() => {
                  const q = newDeal.client.toLowerCase();
                  const matches = clients.filter(c => `${c.first_name} ${c.last_name} ${c.business_name ?? ''}`.toLowerCase().includes(q)).slice(0, 5);
                  return matches.length ? (
                    <div style={{ border: '1px solid #eef0f2', borderRadius: 8, marginTop: 4, overflow: 'hidden' }}>
                      {matches.map(c => {
                        const nm = c.business_name || `${c.first_name} ${c.last_name}`.trim();
                        return (
                          <button key={c.id} onClick={() => setNewDeal({ ...newDeal, client: nm, client_email: c.email || '', client_phone: c.phone || c.cell_phone || '', client_id: c.id })}
                            style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', border: 'none', borderBottom: '1px solid var(--k-f3f4f6)', background: 'var(--k-fff)', cursor: 'pointer', fontSize: 13, fontFamily: "'DM Sans',sans-serif" }}>
                            <span style={{ fontWeight: 600, color: 'var(--k-1a1a1a)' }}>{nm}</span>{c.email ? <span style={{ color: 'var(--k-9ca3af)' }}> · {c.email}</span> : null}
                          </button>
                        );
                      })}
                    </div>
                  ) : null;
                })()}
                {newDeal.client_id ? <div style={{ fontSize: 11.5, color: 'var(--k-15803d)', marginTop: 4 }}>✓ Linked to contact{newDeal.client_email ? ` · ${newDeal.client_email}` : ''}</div> : null}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>{LBL('Type')}<select style={INP} value={newDeal.type} onChange={e => setNewDeal({ ...newDeal, type: e.target.value })}>{DEAL_TYPES.map(t => <option key={t}>{t}</option>)}</select></div>
                <div>{LBL('Stage')}<select style={INP} value={newDeal.stage} onChange={e => setNewDeal({ ...newDeal, stage: e.target.value })}>{DEAL_STAGES.map(s => <option key={s}>{s}</option>)}</select></div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
              <button onClick={() => setShowNewDeal(false)} style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: '1px solid var(--k-e5e7eb)', background: 'var(--k-fff)', color: 'var(--k-6b7280)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>Cancel</button>
              <button onClick={createDeal} disabled={dealBusy || !newDeal.client.trim()} style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: 'none', background: '#c9922c', color: '#fff', fontSize: 13, fontWeight: 700, cursor: dealBusy ? 'default' : 'pointer', opacity: dealBusy || !newDeal.client.trim() ? 0.6 : 1, fontFamily: "'DM Sans',sans-serif" }}>{dealBusy ? 'Creating…' : 'Create deal'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Link an existing deal to this property */}
      {showLinkDeal && active && (
        <div className="crm-sheet" style={{ position: 'fixed', inset: 0, zIndex: 600, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px', overflowY: 'auto' }}
          onClick={e => { if (e.target === e.currentTarget) setShowLinkDeal(false); }}>
          <div className="crm-sheet-panel" style={{ background: 'var(--k-fff)', borderRadius: 16, padding: 24, width: '100%', maxWidth: 540, boxShadow: '0 24px 64px rgba(0,0,0,.2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 20, fontWeight: 700, margin: 0, color: 'var(--k-111)' }}>Link an existing deal</h3>
              <button onClick={() => setShowLinkDeal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--k-6b7280)', fontSize: 20, lineHeight: 1 }}>✕</button>
            </div>
            <input style={INP} value={linkSearch} onChange={e => setLinkSearch(e.target.value)} placeholder="🔍  Search deals by client or property…" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: '55vh', overflowY: 'auto', marginTop: 12 }}>
              {(() => {
                const q = linkSearch.toLowerCase();
                const list = allDeals.filter(d => d.listing_id !== active.id && `${d.client} ${d.property ?? ''}`.toLowerCase().includes(q)).slice(0, 40);
                if (list.length === 0) return <div style={{ fontSize: 13, color: 'var(--k-9ca3af)', padding: '8px 0' }}>No other deals found.</div>;
                return list.map(d => {
                  const chip = STAGE_CHIP[d.stage || 'Prospect'] || STAGE_CHIP.Prospect;
                  return (
                    <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, border: '1px solid #eef0f2', borderRadius: 8, padding: '8px 12px' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--k-1a1a1a)' }}>{d.client}<span style={{ fontSize: 11, fontWeight: 700, background: chip.bg, color: chip.color, padding: '1px 8px', borderRadius: 20, marginLeft: 8 }}>{d.stage}</span></div>
                        <div style={{ fontSize: 11.5, color: 'var(--k-9ca3af)' }}>{d.type || '—'}{d.property ? ` · ${d.property}` : ''}{d.listing_id ? ' · (linked elsewhere)' : ''}</div>
                      </div>
                      <button onClick={() => linkDeal(d.id)} style={{ fontSize: 12.5, fontWeight: 700, background: '#c9922c', color: '#fff', border: 'none', borderRadius: 7, padding: '6px 12px', cursor: 'pointer', flexShrink: 0 }}>Link here</button>
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        </div>
      )}

      {formPicker && active && (() => {
        const q = formSearch.trim().toLowerCase();
        const matches = q
          ? crmForms.filter(fm => [fm.name, fm.category, fm.form_code].some(v => String(v ?? '').toLowerCase().includes(q)))
          : crmForms;
        const pinnedForms = matches.filter(fm => fm.pinned);
        const restForms = matches.filter(fm => !fm.pinned);
        const primary = q ? matches : (pinnedForms.length ? pinnedForms : matches);
        const hasCurated = !q && pinnedForms.length > 0;
        const formRow = (fm: FormTemplate) => (
          <div key={fm.id} style={{ display: 'flex', alignItems: 'stretch', gap: 4 }}>
            <button onClick={() => openFormEditor({ id: fm.id, name: fm.name }, undefined, fm.form_code)}
              style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', padding: '10px 12px', borderRadius: 8, border: '1px solid #eef0f2', background: 'var(--k-fff)', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", minWidth: 0 }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--k-fafafa)')} onMouseLeave={e => (e.currentTarget.style.background = 'var(--k-fff)')}>
              <span style={{ fontSize: 18 }}>📄</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--k-1a1a1a)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fm.name}</div>
                {(fm.form_code || fm.category) && <div style={{ fontSize: 12, color: 'var(--k-9ca3af)' }}>{[fm.category, fm.form_code].filter(Boolean).join(' · ')}</div>}
              </div>
            </button>
            {isAdmin && (
              <button onClick={() => togglePin(fm)} title={fm.pinned ? 'Unpin from top' : 'Pin to top'}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: fm.pinned ? '#c9922c' : '#d1d5db', flexShrink: 0, padding: '0 4px' }}>{fm.pinned ? '★' : '☆'}</button>
            )}
          </div>
        );
        return (
        <div className="crm-sheet" style={{ position: 'fixed', inset: 0, zIndex: 600, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px', overflowY: 'auto' }}
          onClick={e => { if (e.target === e.currentTarget) setFormPicker(false); }}>
          <div className="crm-sheet-panel" style={{ background: 'var(--k-fff)', borderRadius: 16, padding: 24, width: '100%', maxWidth: 560, boxShadow: '0 24px 64px rgba(0,0,0,.2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 20, fontWeight: 700, margin: 0, color: 'var(--k-111)' }}>Fill a form — {active.name}</h3>
              <button onClick={() => setFormPicker(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--k-6b7280)', fontSize: 20, lineHeight: 1 }}>✕</button>
            </div>
            <input autoFocus value={formSearch} onChange={e => setFormSearch(e.target.value)}
              placeholder="Search forms — e.g. short term, LOI, lease…"
              style={{ ...INP, marginBottom: 12, fontSize: 14 }} />
            {crmForms.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--k-9ca3af)', padding: '8px 0' }}>No form templates found for this workspace.</div>
            ) : matches.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--k-9ca3af)', padding: '8px 0' }}>No form matches “{formSearch}”.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: '62vh', overflowY: 'auto' }}>
                {hasCurated && <div style={{ fontSize: 11, letterSpacing: .8, textTransform: 'uppercase', color: '#c9922c', fontWeight: 700, padding: '0 2px 2px' }}>Your forms</div>}
                {primary.map(formRow)}
                {hasCurated && restForms.length > 0 && (
                  <>
                    <button onClick={() => setShowMoreForms(s => !s)}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--k-6b7280)', fontSize: 13, fontWeight: 700, padding: '10px 2px 4px', fontFamily: "'DM Sans',sans-serif" }}>
                      {showMoreForms ? '▾' : '▸'} More forms ({restForms.length})
                    </button>
                    {showMoreForms && restForms.map(formRow)}
                  </>
                )}
                {isAdmin && !hasCurated && <div style={{ fontSize: 11.5, color: '#c0c4cc', padding: '8px 2px 0' }}>Tip: tap ☆ to pin the forms you use most — they stay at the top and the rest tuck into “More forms”.</div>}
              </div>
            )}
          </div>
        </div>
        );
      })()}

      {emailDocId && <EmailDocDialog submissionId={emailDocId} token={authToken} onClose={() => setEmailDocId(null)} />}
      {/* Send for signature */}
      {sendModal && (
        <div className="crm-sheet" style={{ position: 'fixed', inset: 0, zIndex: 650, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px', overflowY: 'auto' }}
          onClick={e => { if (e.target === e.currentTarget) setSendModal(null); }}>
          <div className="es-touch crm-sheet-panel" style={{ background: 'var(--k-fff)', borderRadius: 16, padding: 24, width: '100%', maxWidth: 540, boxShadow: '0 24px 64px rgba(0,0,0,.2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <h3 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 20, fontWeight: 700, margin: 0, color: 'var(--k-111)' }}>Send for signature</h3>
              <button onClick={() => setSendModal(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--k-6b7280)', fontSize: 20, lineHeight: 1 }}>✕</button>
            </div>
            <div style={{ fontSize: 13, color: 'var(--k-6b7280)', marginBottom: 12 }}><strong>{sendModal.title}</strong> — signers are emailed in order; each signs, then the next is notified. The executed copy is emailed to everyone.</div>
            {sendSigFields !== null && (sendSigFields > 0 ? (() => {
              const keptCount = sendFieldGroups.length ? sendFieldGroups.filter(g => g.keep).reduce((n, g) => n + g.types.length, 0) : sendSigFields;
              const anyRemoved = sendFieldGroups.some(g => !g.keep);
              return (
                <div style={{ fontSize: 12.5, color: 'var(--k-15803d)', background: 'var(--k-ecfdf5)', border: '1px solid var(--k-bbf7d0)', borderRadius: 8, padding: '10px 12px', marginBottom: 14 }}>
                  <div style={{ fontWeight: 700 }}>✒ {keptCount} signature field{keptCount === 1 ? '' : 's'} on this document — signers sign on the doc itself.</div>
                  {sendFieldGroups.length > 0 && (
                    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 5 }}>
                      {sendFieldGroups.map((g, gi) => {
                        const counts = g.types.reduce((m, t) => { m[t] = (m[t] || 0) + 1; return m; }, {} as Record<string, number>);
                        const summary = Object.entries(counts).map(([t, n]) => n > 1 ? `${n} ${fieldTypeLabel(t)}` : fieldTypeLabel(t)).join(' + ');
                        const hasSigner = sendSigners.some(s => s.role === g.role && s.email.includes('@') && s.name.trim());
                        return (
                          <div key={g.origRole} style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, rowGap: 4, fontSize: 12, background: 'var(--k-fff)', border: '1px solid var(--k-d6f0dd)', borderRadius: 7, padding: '4px 4px 4px 6px', opacity: g.keep ? 1 : 0.6 }}>
                            <select value={g.role} disabled={!g.keep} onChange={e => setSendFieldGroups(prev => prev.map((x, j) => j === gi ? { ...x, role: e.target.value } : x))}
                              title="Which party signs this block — change it to reassign the signature to a different signer" style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--k-166534)', background: 'var(--k-f7fdf9)', border: '1px solid var(--k-cdeed8)', borderRadius: 5, padding: '3px 6px', cursor: g.keep ? 'pointer' : 'default', textDecoration: g.keep ? 'none' : 'line-through' }}>
                              {SIGNER_ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                            </select>
                            <span style={{ flex: '1 1 100px', minWidth: 0, color: 'var(--k-4b7d5b)', textDecoration: g.keep ? 'none' : 'line-through' }}>{summary}</span>
                            {g.keep && !hasSigner && <span title="No signer below is set to this party yet — add one (or change a signer's role) so this block gets signed" style={{ fontSize: 10, fontWeight: 700, color: 'var(--k-b45309)', background: 'var(--k-fffbeb)', border: '1px solid var(--k-fde68a)', borderRadius: 5, padding: '1px 5px' }}>no signer</span>}
                            <span style={{ flex: 1 }} />
                            {g.keep
                              ? <button onClick={() => setSendFieldGroups(prev => prev.map((x, j) => j === gi ? { ...x, keep: false } : x))} title="Remove these fields — no one will sign here" style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: 'var(--k-dc2626)', background: 'var(--k-fff)', border: '1px solid var(--k-fecaca)', borderRadius: 6, padding: '3px 8px', cursor: 'pointer' }}>Remove</button>
                              : <button onClick={() => setSendFieldGroups(prev => prev.map((x, j) => j === gi ? { ...x, keep: true } : x))} title="Restore these fields" style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: 'var(--k-15803d)', background: 'var(--k-fff)', border: '1px solid var(--k-bbf7d0)', borderRadius: 6, padding: '3px 8px', cursor: 'pointer' }}>Undo</button>}
                          </div>
                        );
                      })}
                      {(anyRemoved || sendFieldGroups.some(g => g.keep && g.role !== g.origRole)) && <div style={{ fontSize: 11, color: 'var(--k-8a6d3b)' }}>Field changes save to the document when you send. Removed fields won’t be signed.</div>}
                      <button onClick={goPlaceFields} title="Open the document to place initials, a date, or a text field for a signer to fill in" style={{ marginTop: 6, width: '100%', fontSize: 12.5, fontWeight: 800, color: 'var(--k-a06a12)', background: 'var(--k-fffdf6)', border: '1.5px solid var(--k-e6d3a2)', borderRadius: 8, padding: '9px 10px', cursor: 'pointer' }}>✒ Add initials, dates &amp; other fields</button>
                    </div>
                  )}
                </div>
              );
            })() : (
              <div style={{ fontSize: 12.5, color: 'var(--k-b45309)', background: 'var(--k-fffbeb)', border: '1px solid var(--k-fde68a)', borderRadius: 8, padding: '10px 12px', marginBottom: 14, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ flex: 1, minWidth: 180 }}>No signature fields placed — signers will sign on an added Signatures page. To sign on the document’s own lines, place fields first.</span>
                <button onClick={goPlaceFields}
                  style={{ fontSize: 12, fontWeight: 700, color: 'var(--k-a06a12)', background: 'var(--k-fff)', border: '1px solid var(--k-f0e2c4)', borderRadius: 7, padding: '6px 11px', cursor: 'pointer', whiteSpace: 'nowrap' }}>✒ Add initials &amp; dates</button>
              </div>
            ))}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {sendSigners.map((s, i) => {
                const q = s.name.trim().toLowerCase();
                const sugg = sendPick === i && q ? clients.filter(c => (c.business_name || `${c.first_name} ${c.last_name}`).toLowerCase().includes(q)).slice(0, 6) : [];
                const rc: React.CSSProperties = { fontSize: 12, fontWeight: 800, lineHeight: 1, color: '#8a6d3b', background: 'var(--k-fbf6e9)', border: '1px solid var(--k-e6d3a2)', borderRadius: 5, cursor: 'pointer', padding: '3px 6px' };
                return (
                  <div key={i} style={{ border: '1px solid #eef0f2', borderRadius: 10, padding: 10, background: 'var(--k-fff)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <span style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--k-9ca3af)' }}>{i + 1}.</span>
                      <select value={s.role} onChange={e => setSendSigners(prev => prev.map((x, j) => j === i ? { ...x, role: e.target.value } : x))} style={{ ...INP, width: 'auto', flex: '0 0 118px', padding: '5px 8px', fontSize: 12.5 }}>
                        {SIGNER_ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                      <span style={{ flex: 1 }} />
                      <button onClick={() => setSendSigners(prev => { const j = i - 1; if (j < 0) return prev; const c = [...prev]; [c[i], c[j]] = [c[j], c[i]]; return c; })} disabled={i === 0} title="Move up" style={{ ...rc, opacity: i === 0 ? 0.3 : 1 }}>↑</button>
                      <button onClick={() => setSendSigners(prev => { const j = i + 1; if (j >= prev.length) return prev; const c = [...prev]; [c[i], c[j]] = [c[j], c[i]]; return c; })} disabled={i === sendSigners.length - 1} title="Move down" style={{ ...rc, opacity: i === sendSigners.length - 1 ? 0.3 : 1 }}>↓</button>
                      {sendSigners.length > 1 && <button onClick={() => setSendSigners(prev => prev.filter((_, j) => j !== i))} title="Remove signer" style={{ ...rc, color: 'var(--k-dc2626)', borderColor: 'var(--k-fecaca)', background: 'var(--k-fff)' }}>✕</button>}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <div style={{ position: 'relative' }}>
                        <input value={s.name} onChange={e => { setSendSigners(prev => prev.map((x, j) => j === i ? { ...x, name: e.target.value } : x)); setSendPick(i); }} onFocus={() => setSendPick(i)} onBlur={() => setTimeout(() => setSendPick(p => (p === i ? null : p)), 150)} placeholder="Name" style={{ ...INP, fontSize: 14 }} />
                        {sugg.length > 0 && (
                          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10, background: 'var(--k-fff)', border: '1px solid var(--k-e5e7eb)', borderRadius: 8, marginTop: 2, boxShadow: '0 6px 20px rgba(0,0,0,0.1)', maxHeight: 180, overflowY: 'auto' }}>
                            {sugg.map(c => { const nm = c.business_name || `${c.first_name} ${c.last_name}`.trim(); return (
                              <button key={c.id} onMouseDown={() => setSendSigners(prev => prev.map((x, j) => j === i ? { ...x, name: nm, email: c.email || x.email } : x))} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '7px 11px', border: 'none', background: 'var(--k-fff)', cursor: 'pointer', fontSize: 13 }}>{nm}{c.email ? <span style={{ color: 'var(--k-9ca3af)', fontSize: 11 }}> · {c.email}</span> : ''}</button>
                            ); })}
                          </div>
                        )}
                      </div>
                      <input value={s.email} onChange={e => setSendSigners(prev => prev.map((x, j) => j === i ? { ...x, email: e.target.value } : x))} placeholder="Email" style={{ ...INP, fontSize: 14 }} />
                    </div>
                  </div>
                );
              })}
              <button onClick={() => setSendSigners(prev => [...prev, { role: 'other', name: '', email: '' }])} style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--k-a06a12)', background: 'var(--k-fffdf6)', border: '1px dashed var(--k-e6d3a2)', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', alignSelf: 'flex-start' }}>＋ Add signer</button>
              <textarea value={sendMsg} onChange={e => setSendMsg(e.target.value)} placeholder="Optional message to the signers…" style={{ ...INP, minHeight: 54, resize: 'vertical', fontSize: 14 }} />
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
              <button onClick={() => setSendModal(null)} style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: '1px solid var(--k-e5e7eb)', background: 'var(--k-fff)', color: 'var(--k-6b7280)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>Cancel</button>
              <button
                onClick={() => {
                  const ready = sendSigners.filter(x => x.email.includes('@') && x.name.trim());
                  if (!ready.length) { onToast('Add at least one signer with a valid email'); return; }
                  // Nothing leaves from here — this opens the review, which carries the send.
                  if (sendModal?.url) setSendPreview(true); else onToast('This document has no file yet — import the PDF, or open the form and Save, before sending');
                }}
                disabled={sendBusy}
                style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: 'none', background: '#c9922c', color: '#fff', fontSize: 13, fontWeight: 700, cursor: sendBusy ? 'default' : 'pointer', opacity: sendBusy ? 0.6 : 1, fontFamily: "'DM Sans',sans-serif" }}>
                {sendBusy ? 'Sending…' : (sendModal?.url ? '✒ Create Signatures →' : '📤 Send for signature')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Review before sending: the document with every placement labelled ── */}
      {sendPreview && sendModal?.url && (() => {
        const SIG = ['signature', 'initial', 'date'];
        const byOrig = new Map(sendFieldGroups.map(g => [g.origRole, g]));
        const effective = sendValues.filter(v => SIG.includes(String(v.type))).flatMap(v => {
          const g = byOrig.get(String(v.signerRole || 'client'));
          if (g && !g.keep) return [];
          const role = g && g.role !== g.origRole ? g.role : String(v.signerRole || 'client');
          return [{ page: Number(v.page) || 1, fx: Number(v.fx), fy: Number(v.fy), fw: Number(v.fw), type: String(v.type), signerRole: role }];
        });
        const label = (role: string) => { const x = sendSigners.find(y => y.role === role && y.name.trim()); return x ? x.name : roleLabel(role) + ' (no signer yet)'; };
        return <SignPreviewModal url={sendModal.url!} fields={effective} signerLabel={label} busy={sendBusy}
          onClose={() => setSendPreview(false)}
          onConfirm={async () => { await sendForSignature(); setSendPreview(false); }}
          confirmLabel="📤 Send for signature" />;
      })()}

      {/* ── In-app document preview (view + print, no forced download) ── */}
      {previewFile && <DocPreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />}

      {/* ── Fillable transaction-doc editor, bound to the open property ── */}
      {editorDoc && active && (
        <TransactionDocEditor
          form={{ id: editorDoc.id, name: editorDoc.name }}
          url={editorDoc.url}
          authToken={authToken}
          isAdmin={isAdmin}
          listingId={active.id}
          dealId={formDealId ?? undefined}
          businessUnit={businessUnit}
          submissionId={editorDoc.submissionId}
          onToast={onToast}
          onClose={() => { setEditorDoc(null); setFormDealId(null); resumeSend(); }}
          onSaved={() => { if (formDealId) loadDealForms(formDealId); if (active) loadListingForms(active.id); onToast(formDealId ? 'Saved to deal ✓' : 'Saved to property ✓'); }}
        />
      )}

      {/* ── LOI-to-Purchase term-list builder (dynamic, replaces the overlay editor) ── */}
      {loiDoc && active && (() => {
        const agent = profiles.find(p => p.id === active.listing_agent_id);
        const deal = deals.find(d => d.id === formDealId);
        const landlord = listingContacts.find(c => (c.role || '').toLowerCase() === 'landlord')?.crm_clients;
        const propertyAddress = [active.address, active.city, active.state].filter(Boolean).join(', ') || active.name || '';
        return (
          <LoiBuilder
            formId={loiDoc.formId}
            name={loiDoc.name}
            spec={loiDoc.spec}
            submissionId={loiDoc.submissionId}
            listingId={active.id}
            dealId={formDealId ?? undefined}
            businessUnit={businessUnit}
            authToken={authToken}
            prefill={{
              agentName: agent ? `${agent.first_name} ${agent.last_name}`.trim() : '',
              propertyAddress,
              purchaser: deal?.client || '',
              sellerName: landlord ? (landlord.business_name || `${landlord.first_name} ${landlord.last_name}`.trim()) : '',
            }}
            onToast={onToast}
            onClose={() => { setLoiDoc(null); setFormDealId(null); resumeSend(); }}
            onSaved={() => { if (formDealId) loadDealForms(formDealId); if (active) loadListingForms(active.id); onToast(formDealId ? 'Saved to deal ✓' : 'Saved to property ✓'); }}
          />
        );
      })()}
    </div>
  );
}
