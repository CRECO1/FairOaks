'use client';

import { useEffect, useState } from 'react';

/**
 * PropertiesFloorPlan — interactive, click-to-edit office floor plans for the
 * CRM "Properties" tab (8000 Fair Oaks Pkwy, Bldg 1).
 *
 * The plan GEOMETRY (walls, doors, room shapes) is fixed and lives here. The
 * editable per-suite fields (tenant, suite #, status, color, sq ft, notes) are
 * loaded from /api/crm/suites and overlaid on top of the per-suite defaults
 * below. Admins can click a suite and save changes; everyone else sees it
 * read-only. The "Download PDF" button prints both floors with current data.
 */

type SuiteStatus = 'occupied' | 'vacant' | 'reserved';

interface SuiteRow {
  floor: number;
  suite_key: string;
  suite_number: string | null;
  tenant_name: string | null;
  status: SuiteStatus | null;
  color: string | null;
  sq_ft: number | null;
  notes: string | null;
}

type Shape =
  | { type: 'rect'; x: number; y: number; w: number; h: number }
  | { type: 'poly'; points: string };

interface SuiteDef {
  key: string;
  floor: 1 | 2;
  shape: Shape;
  name: { x: number; y: number; lines: string[]; size: number };
  num: { x: number; y: number };
  defNumber: string;
  defColor: string;
}

const PALETTE: Record<string, { label: string; fill: string; accent: string }> = {
  teal: { label: 'Teal', fill: '#d9ede7', accent: '#2f8f7f' },
  green: { label: 'Green', fill: '#e3eed9', accent: '#5a8f3c' },
  amber: { label: 'Amber', fill: '#f6e9d4', accent: '#c08a2e' },
  purple: { label: 'Purple', fill: '#e7e0f0', accent: '#6b4e9e' },
  blue: { label: 'Blue', fill: '#cfe0f3', accent: '#2f6fb0' },
  rose: { label: 'Rose', fill: '#f6dde2', accent: '#c0506e' },
  cyan: { label: 'Cyan', fill: '#d8ecf0', accent: '#2f8fa0' },
  gray: { label: 'Gray', fill: '#eef1f4', accent: '#5b6776' },
};
const VACANT_FILL = '#f4f4f5';
const WALL = '#243140';

const SUITES: SuiteDef[] = [
  // ── Floor 1 ──
  { key: 'therapy', floor: 1, shape: { type: 'rect', x: 110, y: 170, w: 270, h: 202 }, name: { x: 245, y: 258, lines: ['Therapy'], size: 25 }, num: { x: 245, y: 297 }, defNumber: '101', defColor: 'teal' },
  { key: 'massage', floor: 1, shape: { type: 'rect', x: 380, y: 170, w: 445, h: 202 }, name: { x: 602, y: 258, lines: ['Fair Oaks Massage'], size: 25 }, num: { x: 602, y: 297 }, defNumber: '105', defColor: 'green' },
  { key: 'am_massage', floor: 1, shape: { type: 'rect', x: 825, y: 170, w: 315, h: 270 }, name: { x: 982, y: 290, lines: ['AM Massage'], size: 25 }, num: { x: 982, y: 329 }, defNumber: '106', defColor: 'purple' },
  { key: 'creco', floor: 1, shape: { type: 'rect', x: 110, y: 690, w: 270, h: 220 }, name: { x: 245, y: 808, lines: ['CRECO'], size: 25 }, num: { x: 245, y: 847 }, defNumber: '100', defColor: 'amber' },
  { key: 'forg', floor: 1, shape: { type: 'rect', x: 380, y: 690, w: 445, h: 220 }, name: { x: 602, y: 808, lines: ['Fair Oaks Realty Group'], size: 25 }, num: { x: 602, y: 847 }, defNumber: '102', defColor: 'blue' },
  { key: 'genesis', floor: 1, shape: { type: 'rect', x: 825, y: 690, w: 315, h: 220 }, name: { x: 982, y: 808, lines: ['Genesis Wealth Mgmt'], size: 25 }, num: { x: 982, y: 847 }, defNumber: '104', defColor: 'rose' },
  // ── Floor 2 ──
  { key: 'seamark', floor: 2, shape: { type: 'poly', points: '110,170 420,170 420,340 265,340 265,405 110,405' }, name: { x: 265, y: 232, lines: ['Seamark', 'Counselling'], size: 24 }, num: { x: 187, y: 377 }, defNumber: '205', defColor: 'teal' },
  { key: 'windflower', floor: 2, shape: { type: 'rect', x: 420, y: 170, w: 200, h: 170 }, name: { x: 520, y: 245, lines: ['Windflower'], size: 23 }, num: { x: 520, y: 293 }, defNumber: '206', defColor: 'green' },
  { key: 'marshall', floor: 2, shape: { type: 'rect', x: 620, y: 170, w: 205, h: 170 }, name: { x: 722, y: 232, lines: ['Marshall', 'Friday'], size: 22 }, num: { x: 722, y: 300 }, defNumber: '103', defColor: 'amber' },
  { key: 'pay_possible', floor: 2, shape: { type: 'rect', x: 825, y: 170, w: 315, h: 170 }, name: { x: 982, y: 245, lines: ['Pay Possible'], size: 23 }, num: { x: 982, y: 293 }, defNumber: '204', defColor: 'purple' },
  { key: 'priority_power', floor: 2, shape: { type: 'poly', points: '110,630 265,630 265,690 375,690 375,910 110,910' }, name: { x: 242, y: 806, lines: ['Priority Power'], size: 24 }, num: { x: 242, y: 845 }, defNumber: '201', defColor: 'blue' },
  { key: 'home_lending', floor: 2, shape: { type: 'rect', x: 375, y: 690, w: 370, h: 220 }, name: { x: 560, y: 806, lines: ['Home Lending'], size: 24 }, num: { x: 560, y: 845 }, defNumber: '208', defColor: 'rose' },
  { key: 'lg_construction', floor: 2, shape: { type: 'rect', x: 745, y: 690, w: 395, h: 220 }, name: { x: 942, y: 806, lines: ['L&G Construction'], size: 24 }, num: { x: 942, y: 845 }, defNumber: '202', defColor: 'cyan' },
];

// ── Static geometry (walls / doors / core) per floor ──
type Line = [number, number, number, number];
type Door = { d: string; leaf: Line };

const GEO: Record<1 | 2, {
  ext: Line[]; extRect?: [number, number, number, number];
  int: Line[]; coreRect: [number, number, number, number]; coreLines: Line[];
  doorErase: Line[]; doors: Door[];
  coreLabels: { x: number; y: number; t: string; size: number }[];
  extraText?: { x: number; y: number; t: string; anchor: 'start' | 'end' }[];
}> = {
  1: {
    ext: [[110, 170, 1140, 170], [110, 910, 1140, 910], [110, 170, 110, 470], [110, 540, 110, 910], [1140, 170, 1140, 490], [1140, 560, 1140, 910]],
    int: [[380, 170, 380, 372], [380, 690, 380, 910], [825, 170, 825, 440], [825, 690, 825, 910], [110, 372, 825, 372], [825, 440, 1140, 440], [110, 690, 1140, 690], [630, 440, 630, 648], [865, 440, 865, 648], [630, 544, 930, 544]],
    coreRect: [440, 440, 490, 208],
    coreLines: [],
    doorErase: [[320, 372, 365, 372], [395, 372, 440, 372], [840, 440, 885, 440], [1085, 440, 1130, 440], [315, 690, 360, 690], [395, 690, 440, 690], [1075, 690, 1120, 690]],
    doors: [
      { d: 'M 110 540 A 70 70 0 0 1 110 470', leaf: [110, 470, 110, 540] },
      { d: 'M 1140 490 A 70 70 0 0 1 1140 560', leaf: [1140, 490, 1140, 560] },
      { d: 'M 320 372 A 45 45 0 0 1 365 327', leaf: [365, 372, 365, 327] },
      { d: 'M 395 327 A 45 45 0 0 1 440 372', leaf: [395, 372, 395, 327] },
      { d: 'M 885 440 A 45 45 0 0 1 840 485', leaf: [840, 440, 840, 485] },
      { d: 'M 1130 395 A 45 45 0 0 0 1085 440', leaf: [1130, 440, 1130, 395] },
      { d: 'M 315 690 A 45 45 0 0 0 360 735', leaf: [360, 690, 360, 735] },
      { d: 'M 440 690 A 45 45 0 0 1 395 735', leaf: [395, 690, 395, 735] },
      { d: 'M 1075 690 A 45 45 0 0 0 1120 735', leaf: [1120, 690, 1120, 735] },
    ],
    coreLabels: [
      { x: 535, y: 550, t: 'Conference', size: 18 },
      { x: 747, y: 498, t: 'Bth', size: 16 }, { x: 747, y: 602, t: 'Bth', size: 16 },
      { x: 897, y: 498, t: 'IT', size: 14 }, { x: 897, y: 602, t: 'IT', size: 14 },
    ],
    extraText: [
      { x: 98, y: 500, t: 'FRONT', anchor: 'end' }, { x: 98, y: 520, t: 'DOOR', anchor: 'end' },
      { x: 1152, y: 520, t: 'BACK', anchor: 'start' }, { x: 1152, y: 540, t: 'DOOR', anchor: 'start' },
    ],
  },
  2: {
    ext: [],
    extRect: [110, 170, 1030, 740],
    int: [[420, 170, 420, 340], [620, 170, 620, 340], [825, 170, 825, 340], [265, 340, 1140, 340], [265, 340, 265, 405], [110, 405, 265, 405], [110, 630, 265, 630], [265, 630, 265, 690], [265, 690, 1140, 690], [375, 690, 375, 910], [745, 690, 745, 910]],
    coreRect: [565, 440, 315, 208],
    coreLines: [[565, 544, 880, 544], [800, 440, 800, 544], [770, 544, 770, 648]],
    doorErase: [[430, 340, 475, 340], [635, 340, 680, 340], [1085, 340, 1130, 340], [265, 345, 265, 390], [265, 635, 265, 680], [430, 690, 475, 690], [1085, 690, 1130, 690]],
    doors: [
      { d: 'M 430 295 A 45 45 0 0 1 475 340', leaf: [430, 340, 430, 295] },
      { d: 'M 635 295 A 45 45 0 0 1 680 340', leaf: [635, 340, 635, 295] },
      { d: 'M 1130 295 A 45 45 0 0 0 1085 340', leaf: [1130, 340, 1130, 295] },
      { d: 'M 310 345 A 45 45 0 0 1 265 390', leaf: [265, 345, 310, 345] },
      { d: 'M 310 635 A 45 45 0 0 1 265 680', leaf: [265, 635, 310, 635] },
      { d: 'M 475 690 A 45 45 0 0 1 430 735', leaf: [430, 690, 430, 735] },
      { d: 'M 1085 690 A 45 45 0 0 1 1130 735', leaf: [1130, 690, 1130, 735] },
    ],
    coreLabels: [
      { x: 682, y: 498, t: 'Bth', size: 16 }, { x: 667, y: 602, t: 'Bth', size: 16 },
      { x: 825, y: 602, t: 'IT', size: 14 },
    ],
  },
};

function wrapName(name: string): string[] {
  if (name.length <= 15 || !name.includes(' ')) return [name];
  const words = name.split(' ');
  let best = name.length, split = 1;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ').length;
    const b = words.slice(i).join(' ').length;
    if (Math.abs(a - b) < best) { best = Math.abs(a - b); split = i; }
  }
  return [words.slice(0, split).join(' '), words.slice(split).join(' ')];
}

interface Props {
  businessUnit: string;
  isAdmin: boolean;
  authToken?: string;
  onToast?: (msg: string) => void;
}

export default function PropertiesFloorPlan({ businessUnit, isAdmin, authToken, onToast }: Props) {
  const [rows, setRows] = useState<Record<string, SuiteRow>>({});
  const [floor, setFloor] = useState<1 | 2>(1);
  const [selKey, setSelKey] = useState<string | null>(null);
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<{ suite_number: string; tenant_name: string; status: SuiteStatus; color: string; sq_ft: string; notes: string }>(
    { suite_number: '', tenant_name: '', status: 'occupied', color: 'teal', sq_ft: '', notes: '' }
  );

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [businessUnit]);

  async function load() {
    try {
      const res = await fetch(`/api/crm/suites?unit=${businessUnit}&building=bldg1`, {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      });
      const data = await res.json();
      const map: Record<string, SuiteRow> = {};
      (data.suites ?? []).forEach((s: SuiteRow) => { map[`${s.floor}:${s.suite_key}`] = s; });
      setRows(map);
    } catch { /* ignore */ }
  }

  function current(def: SuiteDef) {
    const r = rows[`${def.floor}:${def.key}`];
    return {
      suite_number: r?.suite_number ?? def.defNumber,
      tenant_name: r?.tenant_name ?? def.name.lines.join(' '),
      status: (r?.status ?? 'occupied') as SuiteStatus,
      color: r?.color && PALETTE[r.color] ? r.color : def.defColor,
      sq_ft: r?.sq_ft ?? null,
      notes: r?.notes ?? '',
    };
  }

  function selectSuite(def: SuiteDef) {
    const c = current(def);
    setSelKey(def.key);
    setForm({
      suite_number: c.suite_number,
      tenant_name: c.tenant_name,
      status: c.status,
      color: c.color,
      sq_ft: c.sq_ft == null ? '' : String(c.sq_ft),
      notes: c.notes,
    });
  }

  async function save() {
    const def = SUITES.find(s => s.key === selKey);
    if (!def) return;
    setSaving(true);
    try {
      const res = await fetch('/api/crm/suites', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) },
        body: JSON.stringify({
          building: 'bldg1', business_unit: businessUnit, floor: def.floor, suite_key: def.key,
          suite_number: form.suite_number, tenant_name: form.tenant_name, status: form.status,
          color: form.color, sq_ft: form.sq_ft, notes: form.notes,
        }),
      });
      const data = await res.json();
      if (!res.ok) { onToast?.(data.error || 'Save failed'); return; }
      setRows(prev => ({ ...prev, [`${def.floor}:${def.key}`]: data.suite }));
      onToast?.('✅ Suite updated');
      setSelKey(null);
    } catch { onToast?.('Save error — check connection'); }
    finally { setSaving(false); }
  }

  function shapeProps(shape: Shape) {
    return shape.type === 'rect'
      ? { x: shape.x, y: shape.y, width: shape.w, height: shape.h }
      : { points: shape.points };
  }

  // Render one floor as an <svg>. interactive=true adds click targets (admin).
  function renderFloor(f: 1 | 2, interactive: boolean, id?: string) {
    const gg = GEO[f];
    const suitesF = SUITES.filter(s => s.floor === f);
    return (
      <svg id={id} viewBox="0 150 1250 790" style={{ width: '100%', height: 'auto', display: 'block', fontFamily: 'Helvetica, Arial, sans-serif' }}>
        {/* fills */}
        {suitesF.map(def => {
          const c = current(def);
          const fill = c.status === 'vacant' ? VACANT_FILL : (PALETTE[c.color]?.fill ?? '#eef1f4');
          const p = shapeProps(def.shape);
          return def.shape.type === 'rect'
            ? <rect key={`f-${def.key}`} {...p} fill={fill} />
            : <polygon key={`f-${def.key}`} {...p} fill={fill} />;
        })}

        {/* walls */}
        <g stroke={WALL} fill="none" strokeLinecap="square">
          {gg.extRect && <rect x={gg.extRect[0]} y={gg.extRect[1]} width={gg.extRect[2]} height={gg.extRect[3]} strokeWidth={9} />}
          {gg.ext.map((l, i) => <line key={`e${i}`} x1={l[0]} y1={l[1]} x2={l[2]} y2={l[3]} strokeWidth={9} />)}
          {gg.int.map((l, i) => <line key={`i${i}`} x1={l[0]} y1={l[1]} x2={l[2]} y2={l[3]} strokeWidth={5} />)}
          <rect x={gg.coreRect[0]} y={gg.coreRect[1]} width={gg.coreRect[2]} height={gg.coreRect[3]} strokeWidth={5} />
          {gg.coreLines.map((l, i) => <line key={`c${i}`} x1={l[0]} y1={l[1]} x2={l[2]} y2={l[3]} strokeWidth={5} />)}
        </g>

        {/* doors: erase gaps then arcs */}
        <g stroke="#ffffff" strokeWidth={8} strokeLinecap="butt">
          {gg.doorErase.map((l, i) => <line key={`de${i}`} x1={l[0]} y1={l[1]} x2={l[2]} y2={l[3]} />)}
        </g>
        <g stroke={WALL} fill="none" strokeWidth={3}>
          {gg.doors.map((d, i) => (
            <g key={`dr${i}`}>
              <path d={d.d} />
              <line x1={d.leaf[0]} y1={d.leaf[1]} x2={d.leaf[2]} y2={d.leaf[3]} strokeWidth={4} />
            </g>
          ))}
        </g>

        {/* core + door labels */}
        {gg.coreLabels.map((t, i) => <text key={`cl${i}`} x={t.x} y={t.y} fontSize={t.size} fontWeight={700} fill="#5b6776" textAnchor="middle">{t.t}</text>)}
        {gg.extraText?.map((t, i) => <text key={`et${i}`} x={t.x} y={t.y} fontSize={16} fontWeight={700} fill={WALL} textAnchor={t.anchor} letterSpacing={1}>{t.t}</text>)}

        {/* suite labels */}
        {suitesF.map(def => {
          const c = current(def);
          const accent = c.status === 'vacant' ? '#9aa0a8' : (PALETTE[c.color]?.accent ?? '#5b6776');
          const lines = c.tenant_name && c.tenant_name !== def.name.lines.join(' ') ? wrapName(c.tenant_name) : def.name.lines;
          const startY = def.name.y - (lines.length - 1) * 14;
          const extras: string[] = [];
          if (c.sq_ft != null) extras.push(`${Number(c.sq_ft).toLocaleString()} SF`);
          if (c.status !== 'occupied') extras.push(c.status.toUpperCase());
          return (
            <g key={`l-${def.key}`} pointerEvents="none">
              {lines.map((ln, i) => (
                <text key={i} x={def.name.x} y={startY + i * 28} fontSize={def.name.size} fontWeight={700} fill={WALL} textAnchor="middle">{ln}</text>
              ))}
              <rect x={def.num.x - 38} y={def.num.y - 21} width={76} height={30} rx={15} fill="#ffffff" stroke={accent} strokeWidth={2} />
              <text x={def.num.x} y={def.num.y} fontSize={17} fontWeight={700} fill={accent} textAnchor="middle">{c.suite_number}</text>
              {extras.map((ex, i) => (
                <text key={`x${i}`} x={def.num.x} y={def.num.y + 25 + i * 19} fontSize={13} fontWeight={600} fill={accent} textAnchor="middle" letterSpacing={0.5}>{ex}</text>
              ))}
            </g>
          );
        })}

        {/* click targets */}
        {interactive && isAdmin && suitesF.map(def => {
          const p = shapeProps(def.shape);
          const common = {
            fill: (selKey === def.key || hoverKey === def.key) ? 'rgba(201,146,44,0.12)' : 'transparent',
            stroke: selKey === def.key ? '#c9922c' : 'transparent',
            strokeWidth: 4,
            style: { cursor: 'pointer' as const },
            onClick: () => selectSuite(def),
            onMouseEnter: () => setHoverKey(def.key),
            onMouseLeave: () => setHoverKey(null),
          };
          return def.shape.type === 'rect'
            ? <rect key={`t-${def.key}`} {...p} {...common} />
            : <polygon key={`t-${def.key}`} {...p} {...common} />;
        })}
      </svg>
    );
  }

  function downloadPdf() {
    const svg1 = document.getElementById('fp-print-1')?.outerHTML ?? '';
    const svg2 = document.getElementById('fp-print-2')?.outerHTML ?? '';
    const w = window.open('', '_blank');
    if (!w) { onToast?.('Pop-up blocked — allow pop-ups to export.'); return; }
    w.document.write(
      `<!doctype html><html><head><meta charset="utf-8"><title>8000 Fair Oaks Pkwy — Bldg 1 Floorplans</title>` +
      `<style>@page{size:landscape;margin:0}html,body{margin:0;padding:0}` +
      `.sheet{padding:24px;box-sizing:border-box;page-break-after:always}` +
      `.sheet:last-child{page-break-after:auto}` +
      `.hd{font-family:Helvetica,Arial,sans-serif;font-weight:700;font-size:20px;color:#243140;margin:0 0 8px}` +
      `.sub{font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#8a8f98;margin:0 0 12px}` +
      `svg{width:100%;height:auto;display:block}</style></head><body>` +
      `<div class="sheet"><p class="hd">8000 Fair Oaks Pkwy — Building 1</p><p class="sub">First Floor</p>${svg1}</div>` +
      `<div class="sheet"><p class="hd">8000 Fair Oaks Pkwy — Building 1</p><p class="sub">Second Floor</p>${svg2}</div>` +
      `</body></html>`
    );
    w.document.close();
    w.focus();
    setTimeout(() => { w.print(); }, 350);
  }

  const selectedDef = SUITES.find(s => s.key === selKey && s.floor === floor) || null;

  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap', padding: '4px 4px 24px' }}>
      <div style={{ flex: '1 1 560px', minWidth: 320 }}>
        {/* Header / floor toggle / export */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#243140' }}>8000 Fair Oaks Pkwy — Building 1</div>
            <div style={{ fontSize: 13, color: '#8a8f98' }}>{isAdmin ? 'Click any suite to edit tenant, status, color & details.' : 'Floor plan (view only).'}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ display: 'inline-flex', background: '#eceef1', borderRadius: 8, padding: 3 }}>
              {[1, 2].map(f => (
                <button key={f} onClick={() => { setFloor(f as 1 | 2); setSelKey(null); }}
                  style={{ border: 'none', cursor: 'pointer', padding: '7px 16px', borderRadius: 6, fontSize: 14, fontWeight: 600, fontFamily: 'inherit', background: floor === f ? '#243140' : 'transparent', color: floor === f ? '#fff' : '#5b6776' }}>
                  Floor {f}
                </button>
              ))}
            </div>
            <button onClick={downloadPdf} title="Download both floors as PDF"
              style={{ border: '1px solid #d7dadf', background: '#fff', cursor: 'pointer', padding: '8px 14px', borderRadius: 8, fontSize: 14, fontWeight: 600, fontFamily: 'inherit', color: '#243140' }}>
              ⬇ PDF
            </button>
          </div>
        </div>

        <div style={{ background: '#fff', border: '1px solid #e6e8eb', borderRadius: 12, padding: 8 }}>
          {renderFloor(floor, true)}
        </div>
      </div>

      {/* Editor panel */}
      {isAdmin && selectedDef && (
        <div style={{ flex: '0 0 320px', width: 320, background: '#fff', border: '1px solid #e6e8eb', borderRadius: 12, padding: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#243140' }}>Edit Suite</div>
            <button onClick={() => setSelKey(null)} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 18, color: '#9aa0a8' }}>✕</button>
          </div>

          <label style={lbl}>Suite #</label>
          <input value={form.suite_number} onChange={e => setForm({ ...form, suite_number: e.target.value })} style={inp} />

          <label style={lbl}>Tenant name</label>
          <input value={form.tenant_name} onChange={e => setForm({ ...form, tenant_name: e.target.value })} style={inp} />

          <label style={lbl}>Status</label>
          <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value as SuiteStatus })} style={inp}>
            <option value="occupied">Occupied</option>
            <option value="vacant">Vacant</option>
            <option value="reserved">Reserved</option>
          </select>

          <label style={lbl}>Square footage</label>
          <input value={form.sq_ft} onChange={e => setForm({ ...form, sq_ft: e.target.value.replace(/[^0-9]/g, '') })} inputMode="numeric" placeholder="e.g. 1200" style={inp} />

          <label style={lbl}>Color</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
            {Object.entries(PALETTE).map(([k, v]) => (
              <button key={k} title={v.label} onClick={() => setForm({ ...form, color: k })}
                style={{ width: 30, height: 30, borderRadius: 6, cursor: 'pointer', background: v.fill, border: form.color === k ? `2px solid ${v.accent}` : '1px solid #d7dadf' }} />
            ))}
          </div>

          <label style={lbl}>Notes</label>
          <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={3} style={{ ...inp, resize: 'vertical' }} />

          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button onClick={save} disabled={saving} style={{ flex: 1, padding: '10px', borderRadius: 7, border: 'none', cursor: saving ? 'default' : 'pointer', background: '#c9922c', color: '#111', fontWeight: 700, fontFamily: 'inherit', opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button onClick={() => setSelKey(null)} style={{ padding: '10px 14px', borderRadius: 7, border: '1px solid #d7dadf', cursor: 'pointer', background: '#fff', color: '#5b6776', fontFamily: 'inherit' }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Hidden, full render of both floors for PDF export */}
      <div aria-hidden style={{ position: 'absolute', width: 1100, left: -10000, top: 0, pointerEvents: 'none' }}>
        {renderFloor(1, false, 'fp-print-1')}
        {renderFloor(2, false, 'fp-print-2')}
      </div>
    </div>
  );
}

const lbl: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: '#5b6776', margin: '10px 0 4px', textTransform: 'uppercase', letterSpacing: 0.5 };
const inp: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 6, border: '1px solid #d7dadf', fontSize: 14, fontFamily: 'inherit', color: '#243140' };
