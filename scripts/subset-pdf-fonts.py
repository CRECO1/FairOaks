"""
Shrink a PDF's embedded CIDFontType2 programs to only the glyphs it actually uses.

The IABS files embed 12 FULL TrueType faces (~4.5 MB of font data) with sub=no.
The text is Identity-H, i.e. the content stream holds raw GLYPH IDS — so the
subset must keep those IDs stable or every glyph shifts. fontTools' retain_gids
does exactly that: unused glyphs become empty, the glyf/loca tables collapse,
and GID N still means GID N.
"""
import sys, io, collections
import pikepdf
from pikepdf import Pdf, Name, Dictionary
from fontTools.ttLib import TTFont
from fontTools import subset as ftsubset

src, dst = sys.argv[1], sys.argv[2]
pdf = Pdf.open(src)

# ── 1. which GIDs does each font resource actually use? ──────────────────────
used = collections.defaultdict(set)      # objgen -> {gid}
fontobj = {}                             # objgen -> font dict

def collect(resources, page):
    fonts = resources.get('/Font')
    if fonts is None:
        return {}
    return {str(k): v for k, v in fonts.items()}

for page in pdf.pages:
    res = page.get('/Resources', Dictionary())
    name_to_font = collect(res, page)
    cur = None
    for operands, op in pikepdf.parse_content_stream(page):
        o = str(op)
        if o == 'Tf' and len(operands) >= 1:
            cur = str(operands[0])
        elif o in ('Tj', "'", '"') and operands:
            s = operands[-1]
            if cur in name_to_font and isinstance(s, pikepdf.String):
                b = bytes(s)
                f = name_to_font[cur]
                key = f.objgen; fontobj[key] = f
                for i in range(0, len(b) - 1, 2):
                    used[key].add((b[i] << 8) | b[i + 1])
        elif o == 'TJ' and operands:
            arr = operands[0]
            for el in arr:
                if isinstance(el, pikepdf.String) and cur in name_to_font:
                    b = bytes(el)
                    f = name_to_font[cur]
                    key = f.objgen; fontobj[key] = f
                    for i in range(0, len(b) - 1, 2):
                        used[key].add((b[i] << 8) | b[i + 1])

# ── 2. subset each embedded program, keeping GIDs stable ────────────────────
total_before = total_after = 0
report = []
for key, gids in used.items():
    f = fontobj[key]
    desc_list = f.get('/DescendantFonts')
    if desc_list is None:
        continue
    desc = desc_list[0]
    fd = desc.get('/FontDescriptor')
    if fd is None or '/FontFile2' not in fd:
        continue
    stream = fd['/FontFile2']
    data = bytes(stream.read_bytes())
    total_before += len(data)

    tt = TTFont(io.BytesIO(data), fontNumber=0, lazy=False)
    order = tt.getGlyphOrder()
    keep = {order[g] for g in gids if g < len(order)}
    keep.add(order[0])                     # .notdef

    opts = ftsubset.Options()
    opts.retain_gids = True                # <-- the whole point
    opts.drop_tables += ['DSIG', 'EBDT', 'EBLC', 'PCLT', 'VDMX', 'LTSH', 'hdmx', 'meta', 'JSTF']
    opts.notdef_outline = True
    opts.recalc_bounds = False
    opts.layout_features = []
    sub = ftsubset.Subsetter(options=opts)
    sub.populate(glyphs=list(keep))
    sub.subset(tt)

    out = io.BytesIO()
    tt.save(out)
    newdata = out.getvalue()
    total_after += len(newdata)

    stream.write(newdata)
    stream['/Length1'] = len(newdata)

    # A subset MUST be tagged "ABCDEF+Name" (PDF 32000-1 §9.6.4). Without the tag
    # a viewer is entitled to assume the program is the complete face and may
    # consult system fonts; it is also what pdffonts reports in its `sub` column.
    # Derived from the kept glyph set so regeneration is deterministic.
    import hashlib
    base = str(f.get('/BaseFont', '/Unknown')).lstrip('/')
    stem = base.split('+', 1)[-1]
    h = hashlib.sha256((stem + ',' + ','.join(map(str, sorted(gids)))).encode()).digest()
    tag = ''.join(chr(ord('A') + (byte % 26)) for byte in h[:6])
    newbase = Name('/' + tag + '+' + stem)
    f['/BaseFont'] = newbase
    desc['/BaseFont'] = newbase
    fd['/FontName'] = newbase
    report.append((base, len(gids), len(data), len(newdata)))

pdf.save(dst, compress_streams=True, object_stream_mode=pikepdf.ObjectStreamMode.generate)

print(f"{'font':<16}{'glyphs used':>12}{'before':>12}{'after':>12}")
for base, n, b, a in sorted(report):
    print(f"  {base:<14}{n:>12}{b/1024:>11.0f}K{a/1024:>11.0f}K")
print(f"  {'TOTAL':<14}{'':>12}{total_before/1024/1024:>10.2f}MB{total_after/1024/1024:>10.2f}MB")
