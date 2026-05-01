'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import type { Session } from '@supabase/supabase-js';

type Tab = 'listings' | 'sold' | 'agents' | 'neighborhoods' | 'testimonials' | 'leads' | 'settings';

// ─── Image Upload Button ──────────────────────────────────────────────────────
function ImageUpload({
  value,
  onChange,
  label = 'Image',
}: {
  value: string | null;
  onChange: (url: string) => void;
  label?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFile(file: File) {
    setUploading(true);
    const ext = file.name.split('.').pop();
    const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await supabase.storage.from('images').upload(path, file, { upsert: true });
    if (error) { alert('Upload failed: ' + error.message); setUploading(false); return; }
    const { data } = supabase.storage.from('images').getPublicUrl(path);
    onChange(data.publicUrl);
    setUploading(false);
  }

  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-gray-600">{label}</label>
      <div className="flex items-center gap-3">
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt="preview" className="h-16 w-16 rounded-lg object-cover border border-gray-200" />
        ) : (
          <div className="h-16 w-16 rounded-lg bg-gray-100 flex items-center justify-center text-gray-400 border border-dashed border-gray-300 text-xs">
            No img
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium hover:bg-gray-50 disabled:opacity-60"
          >
            {uploading ? 'Uploading…' : value ? 'Change Photo' : 'Upload Photo'}
          </button>
          {value && (
            <button type="button" onClick={() => onChange('')}
              className="text-xs text-red-500 hover:underline text-left">
              Remove
            </button>
          )}
        </div>
        <input ref={inputRef} type="file" accept="image/*" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
      </div>
    </div>
  );
}

// ─── Tag Editor ───────────────────────────────────────────────────────────────
function TagEditor({ label = 'Specialties', value, onChange }: { label?: string; value: string[]; onChange: (tags: string[]) => void }) {
  const [input, setInput] = useState('');

  function addTag() {
    const tag = input.trim();
    if (tag && !value.includes(tag)) onChange([...value, tag]);
    setInput('');
  }

  return (
    <div className="sm:col-span-2">
      <label className="mb-1 block text-xs font-medium text-gray-600">{label}</label>
      <div className="flex flex-wrap gap-2 mb-2">
        {value.map(tag => (
          <span key={tag} className="flex items-center gap-1 rounded-full bg-yellow-100 border border-yellow-300 px-3 py-1 text-xs font-medium text-yellow-800">
            {tag}
            <button type="button" onClick={() => onChange(value.filter(t => t !== tag))} className="ml-1 text-yellow-600 hover:text-red-500 font-bold leading-none">×</button>
          </span>
        ))}
        {value.length === 0 && <span className="text-xs text-gray-400 italic">No tags yet</span>}
      </div>
      <div className="flex gap-2">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
          placeholder="Type a specialty and press Enter or Add"
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500"
        />
        <button type="button" onClick={addTag} className="rounded-lg bg-yellow-600 px-3 py-2 text-sm font-semibold text-white hover:bg-yellow-700">Add</button>
      </div>
    </div>
  );
}

// ─── Login Form ───────────────────────────────────────────────────────────────
function LoginForm({ onLogin }: { onLogin: (s: Session) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { setError(error.message); setLoading(false); return; }
    if (data.session) onLogin(data.session);
    setLoading(false);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-lg">
        <div className="mb-6 text-center">
          <p className="text-2xl font-bold text-gray-900">Fair Oaks <span className="text-yellow-600">Realty Group</span></p>
          <p className="mt-1 text-sm text-gray-500">Admin Portal</p>
        </div>
        {error && <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</p>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Email</label>
            <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Password</label>
            <input type="password" required value={password} onChange={e => setPassword(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500" />
          </div>
          <button type="submit" disabled={loading}
            className="w-full rounded-lg bg-yellow-600 py-2 text-sm font-semibold text-white hover:bg-yellow-700 disabled:opacity-60">
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── Site Settings Tab ────────────────────────────────────────────────────────
function SettingsTab() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [settings, setSettings] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    supabase.from('site_settings').select('*').eq('id', 1).single()
      .then(({ data }) => { if (data) setSettings(data); });
  }, []);

  async function handleSave() {
    setSaving(true);
    const { updated_at, ...fields } = settings;
    await supabase.from('site_settings').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', 1);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  if (!settings) return <div className="py-20 text-center text-gray-400">Loading…</div>;

  const sections = [
    {
      title: '🖼️ Hero Section',
      fields: [
        { key: 'hero_headline', label: 'Main Headline', type: 'text' },
        { key: 'hero_subheadline', label: 'Sub-headline', type: 'textarea' },
        { key: 'hero_image_url', label: 'Hero Background Photo', type: 'image' },
      ],
    },
    {
      title: '📊 Stats Bar',
      fields: [
        { key: 'stat_homes_sold', label: 'Homes Sold', type: 'number' },
        { key: 'stat_years_experience', label: 'Years Experience', type: 'number' },
        { key: 'stat_satisfaction', label: 'Client Satisfaction (e.g. 98%)', type: 'text' },
        { key: 'stat_avg_days', label: 'Avg Days on Market', type: 'number' },
      ],
    },
    {
      title: '💬 About / Why Us Section',
      fields: [
        { key: 'about_headline', label: 'Section Headline', type: 'text' },
        { key: 'about_text', label: 'Section Text', type: 'textarea' },
      ],
    },
    {
      title: '📣 Quiz CTA Banner',
      fields: [
        { key: 'cta_headline', label: 'CTA Headline', type: 'text' },
        { key: 'cta_subheadline', label: 'CTA Sub-headline', type: 'text' },
      ],
    },
    {
      title: '📞 Contact Info',
      fields: [
        { key: 'phone', label: 'Phone Number', type: 'text' },
        { key: 'email', label: 'Email Address', type: 'text' },
        { key: 'address', label: 'Office Address', type: 'text' },
        { key: 'office_hours', label: 'Office Hours', type: 'text' },
      ],
    },
  ];

  return (
    <div className="max-w-3xl space-y-8">
      {sections.map(section => (
        <div key={section.title} className="rounded-xl border border-gray-200 bg-white p-6">
          <h2 className="mb-5 text-base font-semibold text-gray-800">{section.title}</h2>
          <div className="space-y-5">
            {section.fields.map(field => (
              <div key={field.key}>
                {field.type === 'image' ? (
                  <ImageUpload
                    label={field.label}
                    value={settings[field.key] ?? ''}
                    onChange={url => setSettings({ ...settings, [field.key]: url })}
                  />
                ) : field.type === 'textarea' ? (
                  <>
                    <label className="mb-1 block text-xs font-medium text-gray-600">{field.label}</label>
                    <textarea rows={3} value={settings[field.key] ?? ''}
                      onChange={e => setSettings({ ...settings, [field.key]: e.target.value })}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500" />
                  </>
                ) : (
                  <>
                    <label className="mb-1 block text-xs font-medium text-gray-600">{field.label}</label>
                    <input type={field.type} value={settings[field.key] ?? ''}
                      onChange={e => setSettings({ ...settings, [field.key]: field.type === 'number' ? Number(e.target.value) : e.target.value })}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500" />
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      <div className="flex items-center gap-4 pb-8">
        <button onClick={handleSave} disabled={saving}
          className="rounded-lg bg-yellow-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-yellow-700 disabled:opacity-60">
          {saving ? 'Saving…' : 'Save All Changes'}
        </button>
        {saved && <span className="text-sm font-medium text-green-600">✓ Saved! Changes live on the website.</span>}
      </div>
    </div>
  );
}

// ─── Data Table ───────────────────────────────────────────────────────────────
function DataTable({ tab }: { tab: Exclude<Tab, 'settings'> }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [editing, setEditing] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const tableMap: Record<string, string> = {
    listings: 'listings', sold: 'listings', agents: 'agents', neighborhoods: 'neighborhoods',
    testimonials: 'testimonials', leads: 'leads',
  };
  const table = tableMap[tab];

  // Blank templates so "Add" forms always show the right fields
  const blankTemplates: Record<string, object> = {
    agents: { name: '', title: '', email: '', phone: '', bio: '', image_url: '', license_number: '', years_experience: 0, featured: false, order: 0, specialties: [] },
    listings: { title: '', slug: '', price: 0, address: '', city: '', state: 'TX', zip: '', bedrooms: 0, bathrooms: 0, sqft: 0, lot_size: '', year_built: new Date().getFullYear(), property_type: 'Single Family', status: 'active', description: '', mls_number: '', image_url: '' },
    sold: { title: '', slug: '', price: 0, sold_date: new Date().toISOString().slice(0, 10), address: '', city: '', state: 'TX', zip: '', bedrooms: 0, bathrooms: 0, sqft: 0, lot_size: '', year_built: new Date().getFullYear(), property_type: 'Single Family', status: 'sold', description: '', mls_number: '', image_url: '' },
    neighborhoods: { name: '', slug: '', city: '', description: '', image_url: '', avg_price: 0, avg_sqft: 0, school_district: '', featured: false },
    testimonials: { client_name: '', client_location: '', quote: '', rating: 5, image_url: '', featured: false },
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    let query = supabase.from(table).select('*').order('created_at', { ascending: false });
    // Sold tab only shows sold listings; listings tab excludes sold
    if (tab === 'sold') query = query.eq('status', 'sold');
    if (tab === 'listings') query = query.in('status', ['active', 'pending', 'withdrawn']);
    const { data, error } = await query;
    if (error) setError(error.message);
    else setRows(data ?? []);
    setLoading(false);
  }, [table, tab]);

  useEffect(() => { load(); }, [load]);

  // Image fields per table
  const imageFields: Record<string, string> = {
    agents: 'image_url',
    neighborhoods: 'image_url',
    listings: 'image_url',
    sold: 'image_url',
    testimonials: 'image_url',
  };
  const imageField = imageFields[tab];

  async function handleSave() {
    setSaving(true);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id, created_at, updated_at, search_vector, ...fields } = editing;
    const tablesWithUpdatedAt = new Set(['listings', 'agents', 'neighborhoods', 'leads']);
    if (id && rows.find(r => r.id === id)) {
      const payload = tablesWithUpdatedAt.has(table) ? { ...fields, updated_at: new Date().toISOString() } : fields;
      const { error } = await supabase.from(table).update(payload).eq('id', id);
      if (error) alert(error.message);
    } else {
      const { error } = await supabase.from(table).insert([fields]);
      if (error) alert(error.message);
    }
    setSaving(false);
    setEditing(null);
    load();
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this record?')) return;
    setDeleting(id);
    await supabase.from(table).delete().eq('id', id);
    setDeleting(null);
    load();
  }

  const columnOrder: Record<string, string[]> = {
    listings: ['title', 'price', 'address', 'city', 'status', 'bedrooms', 'bathrooms', 'sqft'],
    sold: ['title', 'price', 'sold_date', 'address', 'city', 'bedrooms', 'bathrooms', 'sqft'],
    agents: ['name', 'title', 'email', 'phone', 'featured'],
    neighborhoods: ['name', 'city', 'avg_price', 'school_district', 'featured'],
    testimonials: ['client_name', 'rating', 'quote', 'featured'],
    leads: ['name', 'email', 'phone', 'source', 'created_at'],
  };
  const cols = columnOrder[tab] ?? [];

  // Fields to hide from the edit modal
  const hiddenFields = new Set(['id', 'created_at', 'updated_at', 'search_vector']);
  const textareaFields = new Set(['description', 'bio', 'quote', 'message']);
  const booleanFields = new Set(['featured']);
  const statusField = 'status';

  if (loading) return <div className="py-20 text-center text-gray-400">Loading…</div>;
  if (error) return <div className="py-20 text-center text-red-500">{error}</div>;

  return (
    <div>
      {tab !== 'leads' && (
        <div className="mb-4 flex justify-end">
          <button onClick={() => setEditing(blankTemplates[tab] ?? {})}
            className="rounded-lg bg-yellow-600 px-4 py-2 text-sm font-semibold text-white hover:bg-yellow-700">
            + Add {tab.slice(0, -1)}
          </button>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-gray-200">
        <table className="min-w-full divide-y divide-gray-100 text-sm">
          <thead className="bg-gray-50">
            <tr>
              {cols.map(c => (
                <th key={c} className="px-4 py-3 text-left font-semibold text-gray-600 capitalize">
                  {c.replace(/_/g, ' ')}
                </th>
              ))}
              <th className="px-4 py-3 text-right font-semibold text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {rows.length === 0 && (
              <tr><td colSpan={cols.length + 1} className="py-12 text-center text-gray-400">No records yet</td></tr>
            )}
            {rows.map(row => (
              <tr key={row.id} className="hover:bg-gray-50">
                {cols.map(c => (
                  <td key={c} className="max-w-[200px] truncate px-4 py-3 text-gray-700">
                    {c === 'featured' ? (row[c] ? '✅' : '—') :
                      c === 'rating' ? '⭐'.repeat(row[c] ?? 0) :
                      c === 'price' || c === 'avg_price' ? (row[c] ? `$${Number(row[c]).toLocaleString()}` : '—') :
                      String(row[c] ?? '—')}
                  </td>
                ))}
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end gap-2">
                    {tab !== 'leads' && (
                      <button onClick={() => setEditing({ ...row })}
                        className="rounded-md bg-gray-100 px-3 py-1 text-xs font-medium hover:bg-gray-200">
                        Edit
                      </button>
                    )}
                    <button onClick={() => handleDelete(row.id)} disabled={deleting === row.id}
                      className="rounded-md bg-red-50 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-100 disabled:opacity-50">
                      {deleting === row.id ? '…' : 'Delete'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Edit Modal */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
            <h2 className="mb-4 text-lg font-bold text-gray-900 capitalize">
              {editing.id ? `Edit ${tab.slice(0, -1)}` : `New ${tab.slice(0, -1)}`}
            </h2>

            <div className="space-y-4">
              {/* Image upload — always first if applicable */}
              {imageField && (
                <ImageUpload
                  label="Profile / Cover Photo"
                  value={editing[imageField] ?? ''}
                  onChange={url => setEditing({ ...editing, [imageField]: url })}
                />
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {/* Tag editors for array fields */}
                {tab === 'agents' && (
                  <TagEditor
                    label="Specialties"
                    value={Array.isArray(editing.specialties) ? editing.specialties : []}
                    onChange={tags => setEditing({ ...editing, specialties: tags })}
                  />
                )}
                {(tab === 'listings' || tab === 'sold') && (
                  <TagEditor
                    label="Features"
                    value={Array.isArray(editing.features) ? editing.features : []}
                    onChange={tags => setEditing({ ...editing, features: tags })}
                  />
                )}
                {tab === 'neighborhoods' && (
                  <TagEditor
                    label="Highlights"
                    value={Array.isArray(editing.highlights) ? editing.highlights : []}
                    onChange={tags => setEditing({ ...editing, highlights: tags })}
                  />
                )}

                {Object.keys(editing)
                  .filter(k => !hiddenFields.has(k) && k !== imageField && k !== 'images' && k !== 'features' && k !== 'highlights' && k !== 'specialties')
                  .map(field => (
                    <div key={field} className={textareaFields.has(field) ? 'sm:col-span-2' : ''}>
                      <label className="mb-1 block text-xs font-medium text-gray-600 capitalize">
                        {field.replace(/_/g, ' ')}
                      </label>
                      {textareaFields.has(field) ? (
                        <textarea rows={4} value={editing[field] ?? ''}
                          onChange={e => setEditing({ ...editing, [field]: e.target.value })}
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500" />
                      ) : booleanFields.has(field) ? (
                        <select value={editing[field] ? 'true' : 'false'}
                          onChange={e => setEditing({ ...editing, [field]: e.target.value === 'true' })}
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500">
                          <option value="false">No</option>
                          <option value="true">Yes</option>
                        </select>
                      ) : field === statusField ? (
                        <select value={editing[field] ?? 'active'}
                          onChange={e => setEditing({ ...editing, [field]: e.target.value })}
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500">
                          <option value="active">Active</option>
                          <option value="pending">Pending</option>
                          <option value="sold">Sold</option>
                          <option value="withdrawn">Withdrawn</option>
                        </select>
                      ) : (
                        <input
                          type={typeof editing[field] === 'number' ? 'number' : 'text'}
                          value={editing[field] ?? ''}
                          onChange={e => {
                            const val = typeof editing[field] === 'number' ? Number(e.target.value) : e.target.value;
                            const updates: Record<string, unknown> = { [field]: val };
                            // Auto-generate slug from title or name
                            if ((field === 'title' || field === 'name') && !editing.id) {
                              updates.slug = String(val).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
                            }
                            setEditing({ ...editing, ...updates });
                          }}
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500" />
                      )}
                    </div>
                  ))}
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button onClick={() => setEditing(null)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50">Cancel</button>
              <button onClick={handleSave} disabled={saving}
                className="rounded-lg bg-yellow-600 px-4 py-2 text-sm font-semibold text-white hover:bg-yellow-700 disabled:opacity-60">
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Admin Page ──────────────────────────────────────────────────────────
const VALID_TABS = new Set<Tab>(['settings', 'listings', 'sold', 'agents', 'neighborhoods', 'testimonials', 'leads']);

export default function AdminPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  const rawTab = searchParams.get('tab') as Tab | null;
  const tab: Tab = rawTab && VALID_TABS.has(rawTab) ? rawTab : 'settings';

  function setTab(t: Tab) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', t);
    router.replace(`/admin?${params.toString()}`);
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  async function handleSignOut() {
    await supabase.auth.signOut();
    setSession(null);
  }

  if (loading) return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-yellow-500 border-t-transparent" />
    </div>
  );

  if (!session) return <LoginForm onLogin={setSession} />;

  const tabs: { key: Tab; label: string }[] = [
    { key: 'settings', label: '⚙️ Homepage' },
    { key: 'listings', label: '🏠 Listings' },
    { key: 'sold', label: '✅ Sold' },
    { key: 'agents', label: '👥 Agents' },
    { key: 'neighborhoods', label: '🏘️ Neighborhoods' },
    { key: 'testimonials', label: '⭐ Testimonials' },
    { key: 'leads', label: '📬 Leads' },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white px-6 py-4">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div>
            <span className="text-xl font-bold text-gray-900">Fair Oaks <span className="text-yellow-600">Realty Group</span></span>
            <span className="ml-2 text-sm text-gray-400">Admin</span>
          </div>
          <div className="flex items-center gap-4">
            <a href="/" target="_blank" className="text-sm text-gray-500 hover:text-gray-700">← View Site</a>
            <button onClick={handleSignOut}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50">Sign Out</button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-8">
        {/* Tab bar */}
        <div className="mb-6 flex flex-wrap gap-1 rounded-xl bg-white p-1 shadow-sm border border-gray-200 w-fit">
          {tabs.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                tab === t.key ? 'bg-yellow-600 text-white' : 'text-gray-600 hover:text-gray-900'
              }`}>
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'settings'
          ? <SettingsTab />
          : <DataTable key={tab} tab={tab as Exclude<Tab, 'settings'>} />
        }
      </div>
    </div>
  );
}
