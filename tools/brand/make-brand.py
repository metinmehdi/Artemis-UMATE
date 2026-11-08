"""Builds the UMATE brand assets from the two open-source (OFL) fonts named on the brand sheet.

    python tools/brand/make-brand.py --fraunces Fraunces[SOFT,WONK,opsz,wght].ttf --lexend Lexend[wght].ttf

Source fonts (not kept in the repo, only the outputs are):
    https://github.com/google/fonts/raw/main/ofl/fraunces/Fraunces%5BSOFT,WONK,opsz,wght%5D.ttf
    https://github.com/google/fonts/raw/main/ofl/lexend/Lexend%5Bwght%5D.ttf

Outputs:
    client/assets/fonts/fraunces-soft.woff2  headings: Fraunces, Soft, Bold, optical size still variable
    client/assets/fonts/lexend.woff2         interface text: Lexend, weights 300-700
    client/assets/brand/umate-logo.svg       mint u + night-purple "mate" (for light backgrounds)
    client/assets/brand/umate-logo-dark.svg  mint u + ivory "mate" (for dark backgrounds)
    client/assets/brand/um-mark.svg          monogram, light background
    client/assets/brand/favicon.svg          monogram on a night-purple tile
    client/assets/brand/icon-*.png, apple-touch-icon.png  app icons (rendered with Edge)

Brand rules used here: the u is 30% larger than the other letters; no dot; mint is only the u.
The logo instance (opsz 36, SOFT 100, wght 700) was matched by eye against the brand sheet.
Needs: fonttools + brotli (pip install fonttools brotli), Microsoft Edge for the PNG icons.
"""
import argparse
import io
import os
import subprocess
import tempfile
from pathlib import Path

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.subset import Options, Subsetter
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = Path(__file__).resolve().parents[2]
FONTS = ROOT / 'client' / 'assets' / 'fonts'
BRAND = ROOT / 'client' / 'assets' / 'brand'

INK = '#230D37'
IVORY = '#FAF6E9'
MINT = '#7EE0C3'
U_SCALE = 1.3
LOGO_AXES = dict(opsz=36, wght=700, SOFT=100, WONK=0)

# Latin + Latin Extended (all Azerbaijani letters incl. ə), punctuation, manat sign, arrows, check marks.
UNICODES = (
    list(range(0x20, 0x7F)) + list(range(0xA0, 0x250)) + [0x259, 0x18F, 0x2BB, 0x2BC, 0x2C6, 0x2DA, 0x2DC]
    + list(range(0x2000, 0x2070)) + [0x20AC, 0x20BC, 0x2122, 0x2212, 0x2215, 0x2713, 0x2715]
    + list(range(0x2190, 0x219A))
)
EDGE = r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'


def web_font(src, out, axes):
    font = instancer.instantiateVariableFont(TTFont(src, lazy=False), axes)
    buf = io.BytesIO()  # round-trip so the subsetter sees a fully compiled font
    font.save(buf)
    buf.seek(0)
    font = TTFont(buf, lazy=False)
    opts = Options()
    opts.flavor = 'woff2'
    opts.layout_features = ['kern', 'liga', 'calt', 'ccmp', 'locl', 'mark', 'mkmk', 'tnum', 'lnum', 'case']
    opts.name_IDs = ['*']
    opts.notdef_outline = True
    sub = Subsetter(opts)
    sub.populate(unicodes=UNICODES)
    sub.subset(font)
    font.flavor = 'woff2'
    font.save(out)
    print(f'{out.relative_to(ROOT)}  {out.stat().st_size // 1024} KB')


def kern_pairs(font):
    """x-advance pair kerning from GPOS (PairPos formats 1 and 2, extension lookups included)."""
    pairs = {}
    for lk in font['GPOS'].table.LookupList.Lookup:
        if lk.LookupType not in (2, 9):
            continue
        for st in lk.SubTable:
            if lk.LookupType == 9:
                st = st.ExtSubTable
            if getattr(st, 'LookupType', 2) != 2:
                continue
            cov = st.Coverage.glyphs
            if st.Format == 1:
                for i, first in enumerate(cov):
                    for pvr in st.PairSet[i].PairValueRecord:
                        v = getattr(pvr.Value1, 'XAdvance', 0) if pvr.Value1 else 0
                        pairs.setdefault((first, pvr.SecondGlyph), v)
            elif st.Format == 2:
                c1, c2 = st.ClassDef1.classDefs, st.ClassDef2.classDefs
                for first in cov:
                    rec = st.Class1Record[c1.get(first, 0)]
                    for second, k2 in c2.items():
                        v1 = rec.Class2Record[k2].Value1
                        v = getattr(v1, 'XAdvance', 0) if v1 else 0
                        if v:
                            pairs.setdefault((first, second), v)
    return pairs


def wordmark(font, text):
    """Paths for the u (scaled) and the rest, in SVG coordinates (y down), plus the ink bounds."""
    cmap, gs = font.getBestCmap(), font.getGlyphSet()
    kern = kern_pairs(font)
    names = [cmap[ord(c)] for c in text]
    x, u_d, rest_d, boxes = 0.0, '', [], []
    for i, n in enumerate(names):
        s = U_SCALE if i == 0 else 1.0
        t = (s, 0, 0, -s, x, 0)
        pen, bp = SVGPathPen(gs), BoundsPen(gs)
        gs[n].draw(TransformPen(pen, t))
        gs[n].draw(TransformPen(bp, t))
        boxes.append(bp.bounds)
        if i == 0:
            u_d = pen.getCommands()
        else:
            rest_d.append(pen.getCommands())
        if i + 1 < len(names):
            x += gs[n].width * s + kern.get((n, names[i + 1]), 0)
    box = (min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes))
    return u_d, ' '.join(rest_d), box


def svg_doc(u_d, rest_d, box, rest_color, pad=0.0, tile=None, size=None, label='umate'):
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    if tile:  # square tile, mark centred, `pad` = share of the side left empty on each side
        side = max(w, h) / (1 - 2 * pad)
        cx, cy = x0 + w / 2, y0 + h / 2
        vx, vy, vw, vh = cx - side / 2, cy - side / 2, side, side
        rx = side * tile['radius']
        bg = f'<rect x="{vx:.1f}" y="{vy:.1f}" width="{vw:.1f}" height="{vh:.1f}" rx="{rx:.1f}" fill="{tile["fill"]}"/>'
    else:
        p = h * pad
        vx, vy, vw, vh = x0 - p, y0 - p, w + 2 * p, h + 2 * p
        bg = ''
    dims = f' width="{size}" height="{size}"' if size else ''
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vx:.1f} {vy:.1f} {vw:.1f} {vh:.1f}"{dims} role="img" aria-label="{label}">'
        f'<title>{label}</title>{bg}<path fill="{MINT}" d="{u_d}"/><path fill="{rest_color}" d="{rest_d}"/></svg>\n'
    )


def render_png(svg_path, out, px):
    """Screenshot the SVG with headless Edge at exactly px x px."""
    with tempfile.TemporaryDirectory() as tmp:
        page = Path(tmp) / 'icon.html'
        page.write_text(
            f'<html><body style="margin:0;overflow:hidden"><img src="{svg_path.as_uri()}" style="display:block;width:{px}px;height:{px}px"></body></html>',
            encoding='utf-8',
        )
        subprocess.run(
            [EDGE, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
             f'--window-size={px},{px}', f'--screenshot={out}', f'--user-data-dir={tmp}\\edge', page.as_uri()],
            check=True, capture_output=True, timeout=60,
        )
    print(f'{out.relative_to(ROOT)}  {px}px')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--fraunces', required=True)
    ap.add_argument('--lexend', required=True)
    a = ap.parse_args()
    FONTS.mkdir(parents=True, exist_ok=True)
    BRAND.mkdir(parents=True, exist_ok=True)

    web_font(a.fraunces, FONTS / 'fraunces-soft.woff2', dict(wght=700, SOFT=100, WONK=0))
    web_font(a.lexend, FONTS / 'lexend.woff2', dict(wght=(300, 700)))

    logo_font = instancer.instantiateVariableFont(TTFont(a.fraunces), LOGO_AXES)
    word = wordmark(logo_font, 'umate')
    mono = wordmark(logo_font, 'um')
    files = {
        'umate-logo.svg': svg_doc(*word, INK),
        'umate-logo-dark.svg': svg_doc(*word, IVORY),
        'um-mark.svg': svg_doc(*mono, INK, label='um'),
        'favicon.svg': svg_doc(*mono, IVORY, pad=0.16, tile={'fill': INK, 'radius': 0.22}, label='UMATE'),
        # app icons: full-bleed tile (the phone rounds or masks it); maskable keeps the mark in the safe zone
        '_icon.svg': svg_doc(*mono, IVORY, pad=0.2, tile={'fill': INK, 'radius': 0}, label='UMATE'),
        '_icon-maskable.svg': svg_doc(*mono, IVORY, pad=0.27, tile={'fill': INK, 'radius': 0}, label='UMATE'),
    }
    for name, doc in files.items():
        (BRAND / name).write_text(doc, encoding='utf-8')
        if not name.startswith('_'):
            print(f'client/assets/brand/{name}')

    for svg_name, png, px in (
        ('_icon.svg', 'icon-192.png', 192),
        ('_icon.svg', 'icon-512.png', 512),
        ('_icon.svg', 'apple-touch-icon.png', 180),
        ('_icon-maskable.svg', 'icon-maskable-512.png', 512),
    ):
        render_png(BRAND / svg_name, BRAND / png, px)
    for name in ('_icon.svg', '_icon-maskable.svg'):
        os.remove(BRAND / name)


if __name__ == '__main__':
    main()
