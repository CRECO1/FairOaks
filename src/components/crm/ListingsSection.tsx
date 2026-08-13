'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import TransactionDocEditor from '@/components/crm/TransactionDocEditor';

// ── Types ────────────────────────────────────────────────────────────────────

interface Listing {
  id: string;
  business_unit: string;
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
  Prospect: { bg: '#f1f5f9', color: '#475569' }, Active: { bg: '#dbeafe', color: '#1d4ed8' },
  LOI: { bg: '#fef3c7', color: '#b45309' }, 'In Contract': { bg: '#e0e7ff', color: '#4338ca' },
  Closed: { bg: '#dcfce7', color: '#15803d' }, Lost: { bg: '#fee2e2', color: '#dc2626' },
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
}

// ── Constants ────────────────────────────────────────────────────────────────

const TYPES = ['Retail', 'Office', 'Industrial', 'Land', 'Multifamily', 'Mixed-Use', 'Medical', 'Flex'];
const STATUSES = ['active', 'pending', 'leased', 'sold', 'off_market'];

const STATUS_CFG: Record<string, { label: string; bg: string; color: string }> = {
  active:     { label: 'Active',     bg: '#dcfce7', color: '#15803d' },
  pending:    { label: 'Pending',    bg: '#fef3c7', color: '#b45309' },
  leased:     { label: 'Leased',     bg: '#dbeafe', color: '#1d4ed8' },
  sold:       { label: 'Sold',       bg: '#f3e8ff', color: '#7e22ce' },
  off_market: { label: 'Off Market', bg: '#f1f5f9', color: '#64748b' },
};

const CATEGORIES = [
  { key: 'floor_plan', label: '📐 Floor Plans' },
  { key: 'photo',      label: '📷 Photos' },
  { key: 'brochure',   label: '📄 Brochures' },
  { key: 'document',   label: '📎 Documents' },
];

const TYPE_COLORS: Record<string, { bg: string; color: string }> = {
  Retail:      { bg: '#fef3c7', color: '#b45309' },
  Office:      { bg: '#dbeafe', color: '#1d4ed8' },
  Industrial:  { bg: '#f1f5f9', color: '#475569' },
  Land:        { bg: '#dcfce7', color: '#15803d' },
  Multifamily: { bg: '#f3e8ff', color: '#7e22ce' },
  'Mixed-Use': { bg: '#fce7f3', color: '#be185d' },
  Medical:     { bg: '#cffafe', color: '#0e7490' },
  Flex:        { bg: '#fff7ed', color: '#c2410c' },
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
  lot_size: '', year_built: '', description: '', notes: '', listing_agent_id: '',
};

// ── Main component ────────────────────────────────────────────────────────────

export default function ListingsSection({ businessUnit, isAdmin, authToken, profiles, clients, onToast }: Props) {
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState('');
  const [typeFilter, setTypeFilter]     = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Detail panel
  const [active, setActive]     = useState<Listing | null>(null);
  const [activeTab, setActiveTab] = useState<'info' | 'documents' | 'deals' | 'photos' | 'contacts' | 'team'>('info');
  const [editForm, setEditForm] = useState<typeof BLANK_FORM>(BLANK_FORM);
  const [dirty, setDirty]       = useState(false);

  // Files
  const [files, setFiles]           = useState<ListingFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [uploading, setUploading]   = useState(false);
  const [uploadCat, setUploadCat]   = useState('floor_plan');
  const fileInputRef                = useRef<HTMLInputElement>(null);

  // New listing modal
  const [showNew, setShowNew] = useState(false);
  const [newForm, setNewForm] = useState<typeof BLANK_FORM>(BLANK_FORM);
  const [creating, setCreating] = useState(false);

  // Transaction-doc forms in the open listing's folder.
  interface FormTemplate { id: string; name: string; form_code?: string; category?: string; pinned?: boolean }
  interface FormSubmission { id: string; form_id?: string; title?: string; url?: string | null; updated_at?: string; crm_forms?: { name?: string; form_code?: string } | null }
  const [crmForms, setCrmForms] = useState<FormTemplate[]>([]);
  const [listingForms, setListingForms] = useState<FormSubmission[]>([]);
  const [formPicker, setFormPicker] = useState(false);
  const [editorDoc, setEditorDoc] = useState<{ id: string; name: string; url: string; submissionId?: string } | null>(null);

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
  const [sendModal, setSendModal] = useState<{ submissionId: string; dealId: string; title: string; formId?: string } | null>(null);
  const [sendSigFields, setSendSigFields] = useState<number | null>(null);
  const [sendSigners, setSendSigners] = useState<{ role: string; name: string; email: string; include: boolean }[]>([]);
  const [sendMsg, setSendMsg] = useState('');
  const [sendBusy, setSendBusy] = useState(false);
  const [showMoreForms, setShowMoreForms] = useState(false);

  const authHeaders: Record<string, string> = authToken ? { Authorization: `Bearer ${authToken}` } : {};

  // ── Load ────────────────────────────────────────────────────────────────────

  const loadListings = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/crm/listings?business_unit=${businessUnit}`, { headers: authHeaders });
    const json = await res.json();
    setListings(json.listings ?? []);
    setLoading(false);
  }, [businessUnit, authToken]); // eslint-disable-line

  useEffect(() => { loadListings(); }, [loadListings]);

  const loadFiles = useCallback(async (listingId: string) => {
    setFilesLoading(true);
    const res = await fetch(`/api/crm/listing-files?listing_id=${listingId}`, { headers: authHeaders });
    const json = await res.json();
    setFiles(json.files ?? []);
    setFilesLoading(false);
  }, [authToken]); // eslint-disable-line

  const loadListingForms = useCallback(async (listingId: string) => {
    const res = await fetch(`/api/crm/form-submissions?listing_id=${listingId}`, { headers: authHeaders });
    const json = await res.json().catch(() => ({}));
    setListingForms(json.submissions ?? []);
  }, [authToken]); // eslint-disable-line

  const loadCrmForms = useCallback(async () => {
    const res = await fetch(`/api/crm/forms?business_unit=${businessUnit}`, { headers: authHeaders });
    const json = await res.json().catch(() => ({}));
    setCrmForms(json.forms ?? []);
  }, [businessUnit, authToken]); // eslint-disable-line

  const loadListingContacts = useCallback(async (listingId: string) => {
    const res = await fetch(`/api/crm/listing-contacts?listing_id=${listingId}`, { headers: authHeaders });
    const json = await res.json().catch(() => ({}));
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
    const map: Record<string, Envelope> = {};
    for (const e of (json.envelopes ?? [])) if (e.submission_id && !map[e.submission_id]) map[e.submission_id] = e; // GET is newest-first; keep the latest
    setEnvMap(map);
  }, [authToken]); // eslint-disable-line

  // Fetch the blank template's signed URL, then open the fillable editor bound to this property.
  const openFormEditor = useCallback(async (form: { id: string; name: string }, submissionId?: string) => {
    setFormPicker(false);
    try {
      const res = await fetch(`/api/crm/forms/${form.id}/url`, { headers: authHeaders });
      const json = await res.json();
      if (!json.url) { onToast('Could not open form'); return; }
      setEditorDoc({ id: form.id, name: form.name, url: json.url, submissionId });
    } catch { onToast('Could not open form'); }
  }, [authToken, onToast]); // eslint-disable-line

  // ── Open / close listing ────────────────────────────────────────────────────

  function openListing(l: Listing) {
    setActive(l);
    setActiveTab('info');
    setEditForm({
      name: l.name ?? '', address: l.address ?? '', city: l.city ?? '',
      state: l.state ?? 'TX', zip: l.zip ?? '', type: l.type ?? 'Retail',
      status: l.status ?? 'active', asking_price: l.asking_price != null ? String(l.asking_price) : '',
      sq_ft: l.sq_ft != null ? String(l.sq_ft) : '',
      lot_size: l.lot_size ?? '', year_built: l.year_built ?? '',
      description: l.description ?? '', notes: l.notes ?? '',
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

  function closePanel() { setActive(null); setFiles([]); setListingForms([]); setDirty(false); }

  // ── Save listing ────────────────────────────────────────────────────────────

  async function saveListing() {
    if (!active) return;
    const body: Record<string, unknown> = { ...editForm };
    body.asking_price = editForm.asking_price !== '' ? Number(editForm.asking_price) : null;
    body.sq_ft        = editForm.sq_ft !== '' ? Number(editForm.sq_ft) : null;
    const res = await fetch(`/api/crm/listings/${active.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify(body),
    });
    if (!res.ok) { onToast('Error saving listing'); return; }
    const { listing } = await res.json();
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

  async function removeContact(id: string) {
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

  function fillFormForDeal(dealId: string) { setFormDealId(dealId); loadCrmForms(); setFormPicker(true); }
  function editDealForm(dealId: string, form: { id: string; name: string }, submissionId: string) { setFormDealId(dealId); openFormEditor(form, submissionId); }

  function openSendModal(d: Deal, f: FormSubmission) {
    const landlord = listingContacts.find(c => (c.role || '').toLowerCase() === 'landlord')?.crm_clients;
    const agent = profiles.find(p => p.id === (active?.listing_agent_id || d.agent_id));
    setSendSigners([
      { role: 'client', name: d.client || '', email: d.client_email || '', include: true },
      { role: 'landlord', name: landlord ? (landlord.business_name || `${landlord.first_name} ${landlord.last_name}`.trim()) : '', email: landlord?.email || '', include: !!landlord?.email },
      { role: 'agent', name: agent ? `${agent.first_name} ${agent.last_name}`.trim() : '', email: '', include: false },
    ]);
    setSendMsg('');
    setSendSigFields(null);
    setSendModal({ submissionId: f.id, dealId: d.id, title: f.title || f.crm_forms?.name || 'Document', formId: f.form_id });
    // how many signature/initial/date fields the agent placed on this doc
    fetch(`/api/crm/form-submissions/${f.id}`, { headers: authHeaders })
      .then(r => r.json())
      .then(j => { const vals = Array.isArray(j.submission?.values) ? j.submission.values : []; setSendSigFields(vals.filter((x: { type?: string }) => ['signature', 'initial', 'date'].includes(String(x.type))).length); })
      .catch(() => setSendSigFields(0));
  }

  async function sendForSignature() {
    if (!sendModal) return;
    const signers = sendSigners.filter(s => s.include && s.email.includes('@') && s.name.trim())
      .map((s, i) => ({ signer_role: s.role, name: s.name.trim(), email: s.email.trim(), signing_order: i + 1 }));
    if (signers.length === 0) { onToast('Add at least one signer with a valid email'); return; }
    setSendBusy(true);
    const res = await fetch('/api/crm/envelopes', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ submission_id: sendModal.submissionId, deal_id: sendModal.dealId, listing_id: active?.id, title: sendModal.title, message: sendMsg, signers }),
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
    if (env && env.status !== 'completed') { onToast('This document is out for signature — it can’t be deleted while signing is in progress.'); return; }
    if (!window.confirm('Delete this document? This cannot be undone.')) return;
    const res = await fetch(`/api/crm/form-submissions?id=${id}`, { method: 'DELETE', headers: authHeaders });
    if (!res.ok) { onToast('Could not delete the document'); return; }
    if (opts?.dealId) loadDealForms(opts.dealId);
    if (active) loadListingForms(active.id);
    onToast('Document deleted');
  }

  async function togglePin(fm: FormTemplate) {
    const next = !fm.pinned;
    setCrmForms(prev => prev.map(x => x.id === fm.id ? { ...x, pinned: next } : x)); // optimistic
    const res = await fetch(`/api/crm/forms/${fm.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authHeaders }, body: JSON.stringify({ pinned: next }) });
    if (!res.ok) { setCrmForms(prev => prev.map(x => x.id === fm.id ? { ...x, pinned: !next } : x)); onToast('Could not update'); }
  }

  async function copySubmission(id: string, opts?: { dealId?: string }) {
    const res = await fetch('/api/crm/form-submissions', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders }, body: JSON.stringify({ copy_from: id }) });
    if (!res.ok) { onToast('Could not copy the document'); return; }
    if (opts?.dealId) loadDealForms(opts.dealId);
    if (active) loadListingForms(active.id);
    onToast('Copy created ✓');
  }

  // Generate a branded one-page PDF flyer from this property's data + photos.
  async function generateFlyer() {
    if (!active) return;
    setFlyerBusy(true);
    try {
      const res = await fetch(`/api/crm/listings/${active.id}/flyer`, { headers: authHeaders });
      if (!res.ok) { onToast('Could not generate flyer'); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch { onToast('Could not generate flyer'); }
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
    const res = await fetch('/api/crm/listings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify(body),
    });
    setCreating(false);
    if (!res.ok) { onToast('Error creating listing'); return; }
    const { listing } = await res.json();
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

      setFiles(prev => [confirmJson.file, ...prev]);
      onToast('File uploaded ✓');
    } catch (err) {
      console.error('[uploadFile] error:', err);
      onToast('Upload failed — check console for details');
    } finally {
      setUploading(false);
    }
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
    padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 16,
    color: '#374151', fontFamily: "'DM Sans',sans-serif", width: '100%',
    boxSizing: 'border-box', background: '#fafafa', minHeight: 44,
  };
  const LBL = (s: string) => (
    <div style={{ fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase', color: '#6b7280', fontWeight: 700, marginBottom: 5, fontFamily: "'DM Sans',sans-serif" }}>{s}</div>
  );

  // ── Form fields (shared by new + edit) ─────────────────────────────────────

  // Rendered by CALLING it inline — {renderForm(...)} — never as <FormFields/>.
  // As a nested COMPONENT it got a new identity every render, so React remounted
  // its inputs on each keystroke and stole focus. Called as a plain function, the
  // returned elements reconcile in place and the field keeps focus.
  function renderForm({ form, onChange }: { form: typeof BLANK_FORM; onChange: (f: typeof BLANK_FORM) => void }) {
    const set = (k: keyof typeof BLANK_FORM, v: string) => onChange({ ...form, [k]: v });
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          {LBL('Property Name *')}
          <input style={INP} value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Fair Oaks Commerce Center" />
        </div>
        <div>
          {LBL('Address')}
          <input style={INP} value={form.address} onChange={e => set('address', e.target.value)} placeholder="Street address" />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr) minmax(0,1fr)', gap: 10 }}>
          <div>{LBL('City')}<input style={INP} value={form.city} onChange={e => set('city', e.target.value)} placeholder="San Antonio" /></div>
          <div>{LBL('State')}<input style={INP} value={form.state} onChange={e => set('state', e.target.value)} placeholder="TX" /></div>
          <div>{LBL('ZIP')}<input style={INP} value={form.zip} onChange={e => set('zip', e.target.value)} placeholder="78258" /></div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(180px,100%), 1fr))', gap: 10 }}>
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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(180px,100%), 1fr))', gap: 10 }}>
          <div>{LBL('Asking Price / Rate ($)')}<input style={INP} type="number" value={form.asking_price} onChange={e => set('asking_price', e.target.value)} placeholder="e.g. 28.00 /SF/yr" /></div>
          <div>{LBL('Sq Ft')}<input style={INP} type="number" value={form.sq_ft} onChange={e => set('sq_ft', e.target.value)} placeholder="e.g. 4200" /></div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(180px,100%), 1fr))', gap: 10 }}>
          <div>{LBL('Lot Size')}<input style={INP} value={form.lot_size} onChange={e => set('lot_size', e.target.value)} placeholder="e.g. 0.85 acres" /></div>
          <div>{LBL('Year Built')}<input style={INP} value={form.year_built} onChange={e => set('year_built', e.target.value)} placeholder="e.g. 2005" /></div>
        </div>
        <div>
          {LBL('Listing Agent')}
          <select style={INP} value={form.listing_agent_id} onChange={e => set('listing_agent_id', e.target.value)}>
            <option value="">— Unassigned —</option>
            {profiles.map(p => <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>)}
          </select>
        </div>
        <div>
          {LBL('Description')}
          <textarea style={{ ...INP, minHeight: 80, resize: 'vertical' }} value={form.description} onChange={e => set('description', e.target.value)} placeholder="Property highlights, features, zoning…" />
        </div>
        <div>
          {LBL('Internal Notes')}
          <textarea style={{ ...INP, minHeight: 60, resize: 'vertical' }} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Showing instructions, landlord contact, commission notes…" />
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
          style={{ ...INP, width: 'auto', flex: 'none', color: typeFilter ? '#111' : '#9ca3af', fontSize: 16 }}>
          <option value="">All Types</option>
          {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          style={{ ...INP, width: 'auto', flex: 'none', color: statusFilter ? '#111' : '#9ca3af', fontSize: 16 }}>
          <option value="">All Statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{STATUS_CFG[s]?.label}</option>)}
        </select>
        <div style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontSize: 12, color: '#9ca3af' }}>{filtered.length} listing{filtered.length !== 1 ? 's' : ''}</span>
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
        <div style={{ textAlign: 'center', padding: 60, color: '#9ca3af' }}>
          <div style={{ fontSize: 28, marginBottom: 10 }}>🏢</div>Loading listings…
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#9ca3af' }}>
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
            const tc = TYPE_COLORS[l.type ?? ''] ?? { bg: '#f1f5f9', color: '#475569' };
            const agent = profiles.find(p => p.id === l.listing_agent_id);
            return (
              <div key={l.id} onClick={() => openListing(l)}
                style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, overflow: 'hidden', cursor: 'pointer', boxShadow: '0 1px 4px rgba(0,0,0,.05)', transition: 'box-shadow .15s, transform .1s' }}
                onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 6px 20px rgba(0,0,0,.1)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
                onMouseLeave={e => { e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,.05)'; e.currentTarget.style.transform = 'none'; }}>

                {/* Color bar */}
                <div style={{ height: 4, background: tc.color, opacity: 0.7 }} />

                <div style={{ padding: '16px 18px' }}>
                  {/* Header row */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 17, fontWeight: 700, color: '#111', lineHeight: 1.25, marginBottom: 3 }}>{l.name}</div>
                      {(l.address || l.city) && (
                        <div style={{ fontSize: 12, color: '#6b7280' }}>
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
                    {l.sq_ft && <span style={{ fontSize: 12, color: '#6b7280' }}>{fmtSqFt(l.sq_ft)}</span>}
                    {l.asking_price && (
                      <span style={{ marginLeft: 'auto', fontSize: 14, fontWeight: 700, color: '#c9922c' }}>{fmt$(l.asking_price)}</span>
                    )}
                  </div>

                  {/* Description snippet */}
                  {l.description && (
                    <div style={{ fontSize: 12, color: '#6b7280', lineHeight: 1.5, marginBottom: 12, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' } as React.CSSProperties}>
                      {l.description}
                    </div>
                  )}

                  {/* Footer */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 10, borderTop: '1px solid #f3f4f6' }}>
                    {agent ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ width: 22, height: 22, borderRadius: '50%', background: '#c9922c', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, flexShrink: 0 }}>
                          {agent.first_name[0]}{agent.last_name[0]}
                        </div>
                        <span style={{ fontSize: 11, color: '#6b7280' }}>{agent.first_name} {agent.last_name}</span>
                      </div>
                    ) : <span />}
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: '#9ca3af' }}>
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
              <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 18, fontWeight: 700, color: '#111' }}>{title}</div>
              <span style={{ fontSize: 12, color: '#9ca3af', background: '#f3f4f6', borderRadius: 10, padding: '1px 8px', fontWeight: 600 }}>{items.length}</span>
            </div>
            {items.length === 0
              ? <div style={{ fontSize: 13, color: '#9ca3af', fontStyle: 'italic', padding: '4px 0' }}>{hint}</div>
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
          <div style={{ width: Math.min(560, window.innerWidth), background: '#fff', boxShadow: '-4px 0 40px rgba(0,0,0,.16)', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>

            {/* Panel header */}
            <div style={{ padding: '20px 24px 0', borderBottom: '1px solid #f0f0f0', paddingBottom: 0 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 22, fontWeight: 700, color: '#111', lineHeight: 1.2 }}>{active.name}</div>
                  {(active.address || active.city) && (
                    <div style={{ fontSize: 13, color: '#6b7280', marginTop: 3 }}>
                      {[active.address, active.city, active.state, active.zip].filter(Boolean).join(', ')}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <button onClick={generateFlyer} disabled={flyerBusy} title="Generate a branded PDF flyer"
                    style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #f0e2c4', background: '#fdf6e9', color: '#a06a12', fontSize: 12.5, fontWeight: 700, cursor: flyerBusy ? 'default' : 'pointer', opacity: flyerBusy ? 0.6 : 1, whiteSpace: 'nowrap', fontFamily: "'DM Sans',sans-serif" }}>
                    {flyerBusy ? '…' : '📄 Flyer'}
                  </button>
                  <button onClick={closePanel} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: 20, lineHeight: 1 }}>✕</button>
                </div>
              </div>
              {/* Tabs */}
              <div style={{ display: 'flex', gap: 0 }}>
                {[{ k: 'info', label: '📋 Details' }, { k: 'documents', label: '📄 Documents' }, { k: 'deals', label: '💼 Deals' }, { k: 'photos', label: '🖼 Photos' }, { k: 'contacts', label: '👥 Contacts' }, { k: 'team', label: '🔗 Team' }].map(t => (
                  <button key={t.k} onClick={() => setActiveTab(t.k as 'info' | 'documents' | 'deals' | 'photos' | 'contacts' | 'team')}
                    style={{ padding: '10px 18px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: "'DM Sans',sans-serif", color: activeTab === t.k ? '#c9922c' : '#6b7280', borderBottom: `2px solid ${activeTab === t.k ? '#c9922c' : 'transparent'}`, transition: 'all .15s' }}>
                    {t.label}
                  </button>
                ))}
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
                      <div style={{ fontSize: 12, letterSpacing: .8, textTransform: 'uppercase', color: '#c9922c', fontWeight: 700 }}>Transaction Docs</div>
                      <button onClick={() => { setFormDealId(null); loadCrmForms(); setFormPicker(true); }} style={{ padding: '6px 12px', fontSize: 12.5, fontWeight: 700, background: '#c9922c', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>✍️ Fill a form</button>
                    </div>
                    {listingForms.length === 0 ? (
                      <div style={{ fontSize: 13, color: '#9ca3af', padding: '4px 0 6px' }}>No forms yet. Fill a lease, LOI, or any commercial/TREC form and it saves to this property.</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {listingForms.map(f => (
                          <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#fffdf6', border: '1px solid #f0e2c4', borderRadius: 8, padding: '10px 14px' }}>
                            <span style={{ fontSize: 20, flexShrink: 0 }}>📄</span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 14, fontWeight: 600, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.title || f.crm_forms?.name || 'Form'}</div>
                              <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 1 }}>{f.crm_forms?.form_code ? `${f.crm_forms.form_code} · ` : ''}{f.updated_at ? `updated ${new Date(f.updated_at).toLocaleDateString()}` : ''}</div>
                            </div>
                            {f.url && <a href={f.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12.5, fontWeight: 600, color: '#6b7280', textDecoration: 'none', border: '1px solid #e5e7eb', borderRadius: 7, padding: '6px 10px', flexShrink: 0 }}>PDF ↗</a>}
                            <button onClick={() => { setFormDealId(null); openFormEditor({ id: f.form_id || '', name: f.crm_forms?.name || f.title || 'Form' }, f.id); }} disabled={!f.form_id} style={{ fontSize: 12.5, fontWeight: 700, color: '#a06a12', background: '#fff', border: '1px solid #f0e2c4', borderRadius: 7, padding: '6px 12px', cursor: f.form_id ? 'pointer' : 'default', flexShrink: 0 }}>Edit</button>
                            <button onClick={() => copySubmission(f.id)} title="Make a copy" style={{ fontSize: 13, fontWeight: 700, color: '#6b7280', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 7, padding: '6px 9px', cursor: 'pointer', flexShrink: 0 }}>⧉</button>
                            <button onClick={() => deleteSubmission(f.id)} title="Delete document" style={{ fontSize: 13, fontWeight: 700, color: '#dc2626', background: '#fff', border: '1px solid #fecaca', borderRadius: 7, padding: '6px 9px', cursor: 'pointer', flexShrink: 0 }}>✕</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div style={{ fontSize: 12, letterSpacing: .8, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 700, marginBottom: 10 }}>Uploaded Files</div>
                  {/* Upload row */}
                  {isAdmin && (
                    <div style={{ background: '#f8fafc', border: '1px dashed #d1d5db', borderRadius: 10, padding: '14px 16px', marginBottom: 20 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 10 }}>Upload File</div>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                        <select value={uploadCat} onChange={e => setUploadCat(e.target.value)}
                          style={{ ...INP, width: 'auto', flex: '1', minWidth: 140, fontSize: 16 }}>
                          {CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                        </select>
                        <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
                          style={{ padding: '10px 20px', background: '#c9922c', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: uploading ? 'not-allowed' : 'pointer', opacity: uploading ? 0.6 : 1, whiteSpace: 'nowrap', minHeight: 44, flex: 'none' }}>
                          {uploading ? 'Uploading…' : '+ Upload'}
                        </button>
                        <input ref={fileInputRef} type="file" style={{ display: 'none' }} onChange={uploadFile}
                          accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.gif,.webp,.ppt,.pptx,.zip,.txt,.csv" />
                      </div>
                      <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 8 }}>PDF, Word, Excel, PowerPoint, images, ZIP — up to 50 MB</div>
                    </div>
                  )}

                  {/* Files by category */}
                  {filesLoading ? (
                    <div style={{ textAlign: 'center', padding: 40, color: '#9ca3af', fontSize: 14 }}>Loading files…</div>
                  ) : files.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: 40, color: '#9ca3af' }}>
                      <div style={{ fontSize: 32, marginBottom: 8 }}>📁</div>
                      <div style={{ fontSize: 13 }}>No files uploaded yet</div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                      {CATEGORIES.map(cat => {
                        const catFiles = files.filter(f => f.category === cat.key);
                        if (catFiles.length === 0) return null;
                        return (
                          <div key={cat.key}>
                            <div style={{ fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 700, marginBottom: 10 }}>{cat.label} ({catFiles.length})</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                              {catFiles.map(f => (
                                <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: '10px 14px' }}>
                                  <span style={{ fontSize: 22, flexShrink: 0 }}>{fileIcon(f.file_type, f.category)}</span>
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 13, fontWeight: 600, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</div>
                                    <div style={{ fontSize: 11, color: '#9ca3af' }}>{fmtBytes(f.file_size)} · {new Date(f.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
                                  </div>
                                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                                    {f.url && (
                                      <a href={f.url} target="_blank" rel="noopener noreferrer"
                                        style={{ padding: '5px 10px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 12, color: '#374151', textDecoration: 'none', fontWeight: 600, cursor: 'pointer' }}>
                                        ↓ View
                                      </a>
                                    )}
                                    {isAdmin && (
                                      <button onClick={() => deleteFile(f.id, f.name)}
                                        style={{ padding: '5px 8px', background: 'none', border: '1px solid #fecaca', borderRadius: 6, fontSize: 12, color: '#dc2626', cursor: 'pointer' }}>✕</button>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                      {/* Uncategorised fallback */}
                      {(() => {
                        const knownCats = new Set(CATEGORIES.map(c => c.key));
                        const other = files.filter(f => !knownCats.has(f.category));
                        if (!other.length) return null;
                        return (
                          <div>
                            <div style={{ fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', color: '#9ca3af', fontWeight: 700, marginBottom: 10 }}>📎 Other ({other.length})</div>
                            {other.map(f => (
                              <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: '10px 14px', marginBottom: 6 }}>
                                <span style={{ fontSize: 20 }}>{fileIcon(f.file_type)}</span>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: 13, fontWeight: 600, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</div>
                                  <div style={{ fontSize: 11, color: '#9ca3af' }}>{fmtBytes(f.file_size)}</div>
                                </div>
                                {f.url && <a href={f.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: '#2563eb', textDecoration: 'none', fontWeight: 600 }}>↓ View</a>}
                                {isAdmin && <button onClick={() => deleteFile(f.id, f.name)} style={{ padding: '5px 8px', background: 'none', border: '1px solid #fecaca', borderRadius: 6, fontSize: 12, color: '#dc2626', cursor: 'pointer' }}>✕</button>}
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
              )}

              {/* ── Deals tab (deals at this property + their documents) ── */}
              {activeTab === 'deals' && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
                    <div style={{ fontSize: 12, letterSpacing: .8, textTransform: 'uppercase', color: '#c9922c', fontWeight: 700 }}>Deals at this Property</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => { loadAllDeals(); setShowLinkDeal(true); }} style={{ padding: '6px 12px', fontSize: 12.5, fontWeight: 700, background: '#fff', color: '#a06a12', border: '1px solid #f0e2c4', borderRadius: 8, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>🔗 Link deal</button>
                      <button onClick={() => setShowNewDeal(true)} style={{ padding: '6px 12px', fontSize: 12.5, fontWeight: 700, background: '#c9922c', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>＋ New deal</button>
                    </div>
                  </div>
                  {deals.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '40px 20px', color: '#9ca3af' }}>
                      <div style={{ fontSize: 34, marginBottom: 8 }}>💼</div>
                      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 3, color: '#6b7280' }}>No deals at this property yet</div>
                      <div style={{ fontSize: 13 }}>Start a deal to draft LOIs, leases &amp; condition reports here — then send them for signature.</div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {deals.map(d => {
                        const agent = profiles.find(p => p.id === d.agent_id);
                        const chip = STAGE_CHIP[d.stage || 'Prospect'] || STAGE_CHIP.Prospect;
                        const docs = dealForms[d.id] ?? [];
                        return (
                          <div key={d.id} style={{ border: '1px solid #eef0f2', borderRadius: 12, background: '#fff', overflow: 'hidden' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', background: '#fbfbfa', borderBottom: docs.length ? '1px solid #f3f4f6' : 'none' }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                  <span style={{ fontSize: 15, fontWeight: 700, color: '#1a1a1a' }}>{d.client || 'Unnamed'}</span>
                                  <span style={{ fontSize: 11, fontWeight: 700, background: chip.bg, color: chip.color, padding: '2px 9px', borderRadius: 20 }}>{d.stage || 'Prospect'}</span>
                                </div>
                                <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>
                                  {d.type || '—'}{d.value ? ` · ${fmt$(d.value)}` : ''}{agent ? ` · ${agent.first_name} ${agent.last_name}` : ''}
                                </div>
                              </div>
                              <button onClick={() => fillFormForDeal(d.id)} style={{ padding: '6px 12px', fontSize: 12.5, fontWeight: 700, background: '#c9922c', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', flexShrink: 0, fontFamily: "'DM Sans',sans-serif" }}>✍️ Fill a form</button>
                              <button onClick={() => unlinkDeal(d.id)} title="Remove from property" style={{ background: 'none', border: '1px solid #e5e7eb', borderRadius: 7, color: '#9ca3af', fontSize: 13, cursor: 'pointer', padding: '5px 8px', flexShrink: 0 }}>✕</button>
                            </div>
                            {docs.length > 0 && (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 14px' }}>
                                {docs.map(f => (
                                  <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#fffdf6', border: '1px solid #f0e2c4', borderRadius: 8, padding: '8px 12px' }}>
                                    <span style={{ fontSize: 17, flexShrink: 0 }}>📄</span>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                      <div style={{ fontSize: 13.5, fontWeight: 600, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.title || f.crm_forms?.name || 'Form'}</div>
                                      <div style={{ fontSize: 11.5, color: '#9ca3af' }}>{f.updated_at ? `updated ${new Date(f.updated_at).toLocaleDateString()}` : ''}</div>
                                    </div>
                                    {f.url && <a href={f.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', textDecoration: 'none', border: '1px solid #e5e7eb', borderRadius: 7, padding: '5px 9px', flexShrink: 0 }}>PDF ↗</a>}
                                    {(() => {
                                      const env = envMap[f.id];
                                      if (env) {
                                        const sg = env.crm_envelope_signers || [];
                                        const done = sg.filter(s => s.status === 'signed' || s.signed_at).length;
                                        return (
                                          <>
                                            {env.status === 'completed' && env.executed_url
                                              ? <a href={env.executed_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11.5, fontWeight: 700, color: '#15803d', background: '#dcfce7', borderRadius: 7, padding: '5px 10px', textDecoration: 'none', flexShrink: 0, whiteSpace: 'nowrap' }}>✓ Signed ↗</a>
                                              : <span title="Out for signature" style={{ fontSize: 11.5, fontWeight: 700, color: '#1d4ed8', background: '#dbeafe', borderRadius: 7, padding: '5px 10px', flexShrink: 0, whiteSpace: 'nowrap' }}>📤 Sent · {done}/{sg.length}</span>}
                                            <button onClick={() => openSendModal(d, f)} disabled={!f.form_id} title="Resend for signature (e.g. after making edits)" style={{ fontSize: 13, fontWeight: 700, color: '#a06a12', background: '#fff', border: '1px solid #f0e2c4', borderRadius: 7, padding: '5px 8px', cursor: f.form_id ? 'pointer' : 'default', flexShrink: 0 }}>↻</button>
                                          </>
                                        );
                                      }
                                      return <button onClick={() => openSendModal(d, f)} disabled={!f.form_id} title="Send for signature" style={{ fontSize: 12, fontWeight: 700, color: '#fff', background: '#c9922c', border: 'none', borderRadius: 7, padding: '5px 10px', cursor: f.form_id ? 'pointer' : 'default', flexShrink: 0, whiteSpace: 'nowrap' }}>📤 Send</button>;
                                    })()}
                                    <button onClick={() => editDealForm(d.id, { id: f.form_id || '', name: f.crm_forms?.name || f.title || 'Form' }, f.id)} disabled={!f.form_id} style={{ fontSize: 12, fontWeight: 700, color: '#a06a12', background: '#fff', border: '1px solid #f0e2c4', borderRadius: 7, padding: '5px 10px', cursor: f.form_id ? 'pointer' : 'default', flexShrink: 0 }}>Edit</button>
                                    <button onClick={() => copySubmission(f.id, { dealId: d.id })} title="Make a copy" style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 7, padding: '5px 8px', cursor: 'pointer', flexShrink: 0 }}>⧉</button>
                                    <button onClick={() => deleteSubmission(f.id, { dealId: d.id })} title="Delete document" style={{ fontSize: 12, fontWeight: 700, color: '#dc2626', background: '#fff', border: '1px solid #fecaca', borderRadius: 7, padding: '5px 8px', cursor: 'pointer', flexShrink: 0 }}>✕</button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div style={{ fontSize: 11.5, color: '#c0c4cc', marginTop: 14, textAlign: 'center' }}>Forms filled here attach to the deal and show on this property. “Send for signature” lights up once e-signing is enabled.</div>
                </div>
              )}

              {/* ── Photos tab ── */}
              {activeTab === 'photos' && (
                <div>
                  {(() => {
                    const photos = files.filter(f => f.category === 'photo');
                    if (filesLoading) return <div style={{ textAlign: 'center', padding: 40, color: '#9ca3af', fontSize: 14 }}>Loading…</div>;
                    if (photos.length === 0) return (
                      <div style={{ textAlign: 'center', padding: 40, color: '#9ca3af' }}>
                        <div style={{ fontSize: 32, marginBottom: 8 }}>🖼</div>
                        <div style={{ fontSize: 13 }}>No photos yet. Upload images in the Documents tab with category “Photos”.</div>
                      </div>
                    );
                    return (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
                        {photos.map(f => (
                          <a key={f.id} href={f.url || '#'} target="_blank" rel="noopener noreferrer"
                            style={{ display: 'block', borderRadius: 10, overflow: 'hidden', border: '1px solid #eef0f2', aspectRatio: '4 / 3', background: '#f3f4f6' }}>
                            {f.url ? <img src={f.url} alt={f.name} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
                          </a>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* ── Contacts tab ── */}
              {activeTab === 'contacts' && (
                <div>
                  {/* Add a contact */}
                  <div style={{ background: '#f8fafc', border: '1px solid #eef0f2', borderRadius: 10, padding: '14px 16px', marginBottom: 18 }}>
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
                        <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid #eef0f2', borderRadius: 8, background: '#fff' }}>
                          {matches.length === 0 ? (
                            <div style={{ padding: 12, fontSize: 13, color: '#9ca3af' }}>No matches.</div>
                          ) : matches.map(c => (
                            <button key={c.id} onClick={() => addContact(c.id)} disabled={addingContact}
                              style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '9px 12px', border: 'none', borderBottom: '1px solid #f3f4f6', background: '#fff', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
                              <span style={{ fontSize: 14, fontWeight: 600, color: '#111' }}>{c.first_name} {c.last_name}</span>
                              {c.business_name && <span style={{ fontSize: 12, color: '#9ca3af' }}>· {c.business_name}</span>}
                              {c.type && <span style={{ marginLeft: 'auto', fontSize: 11, color: '#9ca3af' }}>{c.type}</span>}
                            </button>
                          ))}
                        </div>
                      );
                    })()}
                  </div>

                  {/* Linked contacts */}
                  {listingContacts.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: 40, color: '#9ca3af' }}>
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
                          <div key={lc.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#fff', border: '1px solid #eef0f2', borderRadius: 10, padding: '11px 14px' }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                <span style={{ fontSize: 14, fontWeight: 600, color: '#111' }}>{name}</span>
                                {lc.role && <span style={{ fontSize: 10.5, fontWeight: 700, color: '#a06a12', background: '#fdf6e9', border: '1px solid #f0e2c4', borderRadius: 20, padding: '1px 8px' }}>{lc.role}</span>}
                              </div>
                              {(c?.business_name || phone || c?.email) && <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{[c?.business_name, phone, c?.email].filter(Boolean).join(' · ')}</div>}
                            </div>
                            {phone && <a href={`tel:${phone}`} title="Call" style={{ fontSize: 13, color: '#16a34a', textDecoration: 'none', border: '1px solid #bbf7d0', borderRadius: 7, padding: '5px 9px', flexShrink: 0 }}>📞</a>}
                            {c?.email && <a href={`mailto:${c.email}`} title="Email" style={{ fontSize: 13, color: '#2563eb', textDecoration: 'none', border: '1px solid #bfdbfe', borderRadius: 7, padding: '5px 9px', flexShrink: 0 }}>✉️</a>}
                            {isAdmin && <button onClick={() => removeContact(lc.id)} title="Remove" style={{ background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer', fontSize: 15, flexShrink: 0 }}>🗑</button>}
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
                        <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 8, border: `1px solid ${on ? '#c9922c' : '#eef0f2'}`, background: on ? '#fdf6e9' : '#fff', cursor: 'pointer' }}>
                          <input type="checkbox" checked={on} onChange={() => setTeamAssigned(a => on ? a.filter(x => x !== p.id) : [...a, p.id])} style={{ accentColor: '#c9922c' }} />
                          <span style={{ fontSize: 14, color: '#374151', fontWeight: 500 }}>{p.first_name} {p.last_name}</span>
                        </label>
                      );
                    })}
                    {profiles.filter(p => p.id !== teamOwner).length === 0 && <div style={{ fontSize: 13, color: '#9ca3af' }}>No other teammates in this workspace.</div>}
                  </div>

                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 14px', borderRadius: 10, border: '1px solid #eef0f2', background: '#f8fafc', cursor: 'pointer', marginBottom: 20 }}>
                    <input type="checkbox" checked={teamRestricted} onChange={e => setTeamRestricted(e.target.checked)} style={{ accentColor: '#c9922c', marginTop: 2 }} />
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#111' }}>🔒 Restricted folder</div>
                      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>When on, only the owner, the teammates above, and admins can see and open this property. Off = visible to the whole team.</div>
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
              <div style={{ padding: '14px 24px', borderTop: '1px solid #f0f0f0', display: 'flex', gap: 10 }}>
                <button onClick={deleteListing}
                  style={{ padding: '9px 14px', borderRadius: 8, border: '1px solid #fecaca', background: '#fff', color: '#dc2626', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
                  Delete
                </button>
                <button onClick={closePanel}
                  style={{ padding: '9px 18px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', color: '#6b7280', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
                  Cancel
                </button>
                <button onClick={saveListing} disabled={!dirty}
                  style={{ flex: 1, padding: '9px 18px', borderRadius: 8, border: 'none', background: dirty ? '#c9922c' : '#e5e7eb', color: dirty ? '#fff' : '#9ca3af', fontSize: 13, fontWeight: 700, cursor: dirty ? 'pointer' : 'default', fontFamily: "'DM Sans',sans-serif", transition: 'all .15s' }}>
                  Save Changes
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── New Listing Modal ─────────────────────────────────────────────────── */}
      {showNew && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px', overflowY: 'auto' }}
          onClick={e => { if (e.target === e.currentTarget) setShowNew(false); }}>
          <div style={{ background: '#fff', borderRadius: 16, padding: 28, width: '100%', maxWidth: 540, boxShadow: '0 24px 64px rgba(0,0,0,.2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <h3 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 22, fontWeight: 700, margin: 0, color: '#111' }}>New Listing</h3>
              <button onClick={() => setShowNew(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: 20, lineHeight: 1 }}>✕</button>
            </div>
            {renderForm({ form: newForm, onChange: setNewForm })}
            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
              <button onClick={() => setShowNew(false)}
                style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', color: '#6b7280', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>Cancel</button>
              <button onClick={createListing} disabled={!newForm.name.trim() || creating}
                style={{ flex: 2, padding: '10px 0', borderRadius: 8, border: 'none', background: newForm.name.trim() ? '#c9922c' : '#e5e7eb', color: newForm.name.trim() ? '#fff' : '#9ca3af', fontSize: 13, fontWeight: 700, cursor: newForm.name.trim() ? 'pointer' : 'default', fontFamily: "'DM Sans',sans-serif" }}>
                {creating ? 'Creating…' : 'Create Listing'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Form picker: choose a transaction-doc template for this property ── */}
      {/* New Deal at this property */}
      {showNewDeal && active && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 600, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px', overflowY: 'auto' }}
          onClick={e => { if (e.target === e.currentTarget) setShowNewDeal(false); }}>
          <div style={{ background: '#fff', borderRadius: 16, padding: 24, width: '100%', maxWidth: 540, boxShadow: '0 24px 64px rgba(0,0,0,.2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 20, fontWeight: 700, margin: 0, color: '#111' }}>New Deal — {active.name}</h3>
              <button onClick={() => setShowNewDeal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: 20, lineHeight: 1 }}>✕</button>
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
                            style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', border: 'none', borderBottom: '1px solid #f3f4f6', background: '#fff', cursor: 'pointer', fontSize: 13, fontFamily: "'DM Sans',sans-serif" }}>
                            <span style={{ fontWeight: 600, color: '#1a1a1a' }}>{nm}</span>{c.email ? <span style={{ color: '#9ca3af' }}> · {c.email}</span> : null}
                          </button>
                        );
                      })}
                    </div>
                  ) : null;
                })()}
                {newDeal.client_id ? <div style={{ fontSize: 11.5, color: '#15803d', marginTop: 4 }}>✓ Linked to contact{newDeal.client_email ? ` · ${newDeal.client_email}` : ''}</div> : null}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>{LBL('Type')}<select style={INP} value={newDeal.type} onChange={e => setNewDeal({ ...newDeal, type: e.target.value })}>{DEAL_TYPES.map(t => <option key={t}>{t}</option>)}</select></div>
                <div>{LBL('Stage')}<select style={INP} value={newDeal.stage} onChange={e => setNewDeal({ ...newDeal, stage: e.target.value })}>{DEAL_STAGES.map(s => <option key={s}>{s}</option>)}</select></div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
              <button onClick={() => setShowNewDeal(false)} style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', color: '#6b7280', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>Cancel</button>
              <button onClick={createDeal} disabled={dealBusy || !newDeal.client.trim()} style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: 'none', background: '#c9922c', color: '#fff', fontSize: 13, fontWeight: 700, cursor: dealBusy ? 'default' : 'pointer', opacity: dealBusy || !newDeal.client.trim() ? 0.6 : 1, fontFamily: "'DM Sans',sans-serif" }}>{dealBusy ? 'Creating…' : 'Create deal'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Link an existing deal to this property */}
      {showLinkDeal && active && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 600, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px', overflowY: 'auto' }}
          onClick={e => { if (e.target === e.currentTarget) setShowLinkDeal(false); }}>
          <div style={{ background: '#fff', borderRadius: 16, padding: 24, width: '100%', maxWidth: 540, boxShadow: '0 24px 64px rgba(0,0,0,.2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 20, fontWeight: 700, margin: 0, color: '#111' }}>Link an existing deal</h3>
              <button onClick={() => setShowLinkDeal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: 20, lineHeight: 1 }}>✕</button>
            </div>
            <input style={INP} value={linkSearch} onChange={e => setLinkSearch(e.target.value)} placeholder="🔍  Search deals by client or property…" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: '55vh', overflowY: 'auto', marginTop: 12 }}>
              {(() => {
                const q = linkSearch.toLowerCase();
                const list = allDeals.filter(d => d.listing_id !== active.id && `${d.client} ${d.property ?? ''}`.toLowerCase().includes(q)).slice(0, 40);
                if (list.length === 0) return <div style={{ fontSize: 13, color: '#9ca3af', padding: '8px 0' }}>No other deals found.</div>;
                return list.map(d => {
                  const chip = STAGE_CHIP[d.stage || 'Prospect'] || STAGE_CHIP.Prospect;
                  return (
                    <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, border: '1px solid #eef0f2', borderRadius: 8, padding: '8px 12px' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 600, color: '#1a1a1a' }}>{d.client}<span style={{ fontSize: 11, fontWeight: 700, background: chip.bg, color: chip.color, padding: '1px 8px', borderRadius: 20, marginLeft: 8 }}>{d.stage}</span></div>
                        <div style={{ fontSize: 11.5, color: '#9ca3af' }}>{d.type || '—'}{d.property ? ` · ${d.property}` : ''}{d.listing_id ? ' · (linked elsewhere)' : ''}</div>
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
        const pinnedForms = crmForms.filter(fm => fm.pinned);
        const restForms = crmForms.filter(fm => !fm.pinned);
        const primary = pinnedForms.length ? pinnedForms : crmForms;
        const hasCurated = pinnedForms.length > 0;
        const formRow = (fm: FormTemplate) => (
          <div key={fm.id} style={{ display: 'flex', alignItems: 'stretch', gap: 4 }}>
            <button onClick={() => openFormEditor({ id: fm.id, name: fm.name })}
              style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', padding: '10px 12px', borderRadius: 8, border: '1px solid #eef0f2', background: '#fff', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", minWidth: 0 }}
              onMouseEnter={e => (e.currentTarget.style.background = '#fafafa')} onMouseLeave={e => (e.currentTarget.style.background = '#fff')}>
              <span style={{ fontSize: 18 }}>📄</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fm.name}</div>
                {(fm.form_code || fm.category) && <div style={{ fontSize: 12, color: '#9ca3af' }}>{[fm.category, fm.form_code].filter(Boolean).join(' · ')}</div>}
              </div>
            </button>
            {isAdmin && (
              <button onClick={() => togglePin(fm)} title={fm.pinned ? 'Unpin from top' : 'Pin to top'}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: fm.pinned ? '#c9922c' : '#d1d5db', flexShrink: 0, padding: '0 4px' }}>{fm.pinned ? '★' : '☆'}</button>
            )}
          </div>
        );
        return (
        <div style={{ position: 'fixed', inset: 0, zIndex: 600, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px', overflowY: 'auto' }}
          onClick={e => { if (e.target === e.currentTarget) setFormPicker(false); }}>
          <div style={{ background: '#fff', borderRadius: 16, padding: 24, width: '100%', maxWidth: 560, boxShadow: '0 24px 64px rgba(0,0,0,.2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 20, fontWeight: 700, margin: 0, color: '#111' }}>Fill a form — {active.name}</h3>
              <button onClick={() => setFormPicker(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: 20, lineHeight: 1 }}>✕</button>
            </div>
            {crmForms.length === 0 ? (
              <div style={{ fontSize: 13, color: '#9ca3af', padding: '8px 0' }}>No form templates found for this workspace.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: '62vh', overflowY: 'auto' }}>
                {hasCurated && <div style={{ fontSize: 11, letterSpacing: .8, textTransform: 'uppercase', color: '#c9922c', fontWeight: 700, padding: '0 2px 2px' }}>Your forms</div>}
                {primary.map(formRow)}
                {hasCurated && restForms.length > 0 && (
                  <>
                    <button onClick={() => setShowMoreForms(s => !s)}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: 13, fontWeight: 700, padding: '10px 2px 4px', fontFamily: "'DM Sans',sans-serif" }}>
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

      {/* Send for signature */}
      {sendModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 650, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px', overflowY: 'auto' }}
          onClick={e => { if (e.target === e.currentTarget) setSendModal(null); }}>
          <div style={{ background: '#fff', borderRadius: 16, padding: 24, width: '100%', maxWidth: 540, boxShadow: '0 24px 64px rgba(0,0,0,.2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <h3 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 20, fontWeight: 700, margin: 0, color: '#111' }}>Send for signature</h3>
              <button onClick={() => setSendModal(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: 20, lineHeight: 1 }}>✕</button>
            </div>
            <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 12 }}><strong>{sendModal.title}</strong> — signers are emailed in order; each signs, then the next is notified. The executed copy is emailed to everyone.</div>
            {sendSigFields !== null && (sendSigFields > 0 ? (
              <div style={{ fontSize: 12.5, color: '#15803d', background: '#ecfdf5', border: '1px solid #bbf7d0', borderRadius: 8, padding: '8px 12px', marginBottom: 14 }}>✒ {sendSigFields} signature field{sendSigFields === 1 ? '' : 's'} placed — signers will sign on the document itself.</div>
            ) : (
              <div style={{ fontSize: 12.5, color: '#b45309', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 12px', marginBottom: 14, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ flex: 1, minWidth: 180 }}>No signature fields placed — signers will sign on an added Signatures page. To sign on the document’s own lines, place fields first.</span>
                <button onClick={() => { const m = sendModal; setSendModal(null); if (m) editDealForm(m.dealId, { id: m.formId || '', name: m.title }, m.submissionId); }}
                  style={{ fontSize: 12, fontWeight: 700, color: '#a06a12', background: '#fff', border: '1px solid #f0e2c4', borderRadius: 7, padding: '6px 11px', cursor: 'pointer', whiteSpace: 'nowrap' }}>✒ Place fields</button>
              </div>
            ))}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {sendSigners.map((s, i) => (
                <div key={s.role} style={{ border: '1px solid #eef0f2', borderRadius: 10, padding: '10px 12px', background: s.include ? '#fff' : '#fafafa' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: s.include ? 8 : 0, cursor: 'pointer' }}>
                    <input type="checkbox" checked={s.include} onChange={e => setSendSigners(prev => prev.map((x, j) => j === i ? { ...x, include: e.target.checked } : x))} style={{ accentColor: '#c9922c', width: 15, height: 15 }} />
                    <span style={{ fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .5, color: '#6b7280' }}>{i + 1}. {s.role}</span>
                  </label>
                  {s.include && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <input value={s.name} onChange={e => setSendSigners(prev => prev.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} placeholder="Name" style={{ ...INP, fontSize: 14 }} />
                      <input value={s.email} onChange={e => setSendSigners(prev => prev.map((x, j) => j === i ? { ...x, email: e.target.value } : x))} placeholder="Email" style={{ ...INP, fontSize: 14 }} />
                    </div>
                  )}
                </div>
              ))}
              <textarea value={sendMsg} onChange={e => setSendMsg(e.target.value)} placeholder="Optional message to the signers…" style={{ ...INP, minHeight: 54, resize: 'vertical', fontSize: 14 }} />
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
              <button onClick={() => setSendModal(null)} style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', color: '#6b7280', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>Cancel</button>
              <button onClick={sendForSignature} disabled={sendBusy} style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: 'none', background: '#c9922c', color: '#fff', fontSize: 13, fontWeight: 700, cursor: sendBusy ? 'default' : 'pointer', opacity: sendBusy ? 0.6 : 1, fontFamily: "'DM Sans',sans-serif" }}>{sendBusy ? 'Sending…' : '📤 Send for signature'}</button>
            </div>
          </div>
        </div>
      )}

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
          onClose={() => { setEditorDoc(null); setFormDealId(null); }}
          onSaved={() => { if (formDealId) loadDealForms(formDealId); if (active) loadListingForms(active.id); onToast(formDealId ? 'Saved to deal ✓' : 'Saved to property ✓'); }}
        />
      )}
    </div>
  );
}
