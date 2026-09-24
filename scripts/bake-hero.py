#!/usr/bin/env python3
"""
Bake the Elkhorn Point headline into the hero image.

Email clients can't put live text over an image reliably — Gmail strips
background-image on a <td>, which is why the first hero attempt rendered as a
black box. Drawing the type into the JPEG sidesteps that: it matches the
landing page exactly and renders anywhere an <img> renders.

One image per line-of-business variant, since each carries its own headline.

    python3 scripts/bake-hero.py --source rendering.jpg --out out/ --all
    python3 scripts/bake-hero.py --source rendering.jpg --out out/ \
        --eyebrow "CRECO Commercial Real Estate" \
        --headline "A rare opportunity for your practice|in the heart of Fair Oaks Ranch!" \
        --name medical-a1

A "|" in the headline forces a line break; otherwise it wraps to the text box.
Without --source it draws on a flat placeholder so the type can be reviewed
before the rendering is in hand.

Fonts: DM Sans (brand face). Point --fonts at a directory holding
DMSans-Bold.ttf and DMSans-ExtraBold.ttf.
"""

import argparse
import os
from PIL import Image, ImageDraw, ImageFont

# 2x the 600px email width, so the hero stays sharp on retina.
W, DEFAULT_H = 1200, 630
GOLD = (201, 146, 44)
GOLD_BRIGHT = (227, 180, 90)
WHITE = (255, 255, 255)
INK = (26, 26, 26)

MARGIN_X = 80
TEXT_MAX_W = 760          # keep the type clear of the right side of the frame
EYEBROW_SIZE = 26
EYEBROW_TRACKING = 4
HEADLINE_SIZE = 50
HEADLINE_MIN_SIZE = 36    # auto-fit floor
HEADLINE_LEADING = 1.28

# The 15 line-of-business variants, keyed by the slug used in the CRM.
VARIANTS = [
    ("medical-a1", "CRECO Commercial Real Estate",
     "A rare opportunity for your practice|in the heart of Fair Oaks Ranch!"),
    ("fb-b3", "CRECO Commercial Real Estate",
     "First pick — and then there|is no site behind this one"),
    ("back-pad", "CRECO Commercial Real Estate",
     "A build-to-suit pad of your own|in the heart of Fair Oaks Ranch"),
]


def fit_headline(draw, text, font_dir, max_w):
    """
    Step the headline down until every hand-written line (split on |) fits on one
    line. A phrase broken mid-thought reads worse than a point smaller.
    """
    for size in range(HEADLINE_SIZE, HEADLINE_MIN_SIZE - 1, -2):
        font = ImageFont.truetype(os.path.join(font_dir, "DMSans-Bold.ttf"), size)
        if all(draw.textlength(part.strip(), font=font) <= max_w for part in text.split("|")):
            return font, size
    return ImageFont.truetype(os.path.join(font_dir, "DMSans-Bold.ttf"), HEADLINE_MIN_SIZE), HEADLINE_MIN_SIZE


def load_fonts(font_dir):
    def pick(*names, size):
        for n in names:
            p = os.path.join(font_dir, n)
            if os.path.exists(p):
                return ImageFont.truetype(p, size)
        raise SystemExit(f"None of {names} found in {font_dir}")
    return (
        pick("DMSans-Bold.ttf", "DMSans-ExtraBold.ttf", size=EYEBROW_SIZE),
        pick("DMSans-Bold.ttf", size=HEADLINE_SIZE),
    )


def scrim_bottom(img, W, H, strength=0.86, reach=0.52):
    """
    Darken bottom-up. Used when the picture is a site plan: a left-hand scrim
    would sit over the plan itself, while the bottom strip is context.
    """
    overlay = Image.new("L", (1, H))
    span = max(1, int(H * reach))
    for y in range(H):
        d = (y - (H - span)) / span
        overlay.putpixel((0, y), int(255 * strength * max(0.0, d) ** 1.25) if d > 0 else 0)
    mask = overlay.resize((W, H))
    return Image.composite(Image.new("RGB", (W, H), (8, 8, 10)), img, mask)


def cover(img, W, H):
    """Crop-to-fill the hero frame, keeping the centre of the image."""
    src_ratio, dst_ratio = img.width / img.height, W / H
    if src_ratio > dst_ratio:
        new_w = int(img.height * dst_ratio)
        box = ((img.width - new_w) // 2, 0, (img.width + new_w) // 2, img.height)
    else:
        new_h = int(img.width / dst_ratio)
        box = (0, (img.height - new_h) // 2, img.width, (img.height + new_h) // 2)
    return img.crop(box).resize((W, H), Image.LANCZOS)


def scrim(img, W, H, strength=0.80, reach=0.68):
    """
    Darken left-to-right so white type holds over any rendering. `reach` is the
    fraction of the width the shading spans; `strength` its opacity at x=0.
    """
    overlay = Image.new("L", (W, 1))
    span = max(1, int(W * reach))
    for x in range(W):
        overlay.putpixel((x, 0), int(255 * strength * max(0.0, 1 - x / span) ** 1.35) if x < span else 0)
    mask = overlay.resize((W, H))
    return Image.composite(Image.new("RGB", (W, H), (8, 8, 10)), img, mask)


def draw_tracked(draw, xy, text, font, fill, tracking):
    """PIL has no letter-spacing, so step the pen manually."""
    x, y = xy
    for ch in text:
        draw.text((x, y), ch, font=font, fill=fill)
        x += draw.textlength(ch, font=font) + tracking
    return x


def wrap(draw, text, font, max_w):
    """Split on explicit | breaks first, then wrap what is left."""
    lines = []
    for part in text.split("|"):
        words, line = part.split(), ""
        for w in words:
            probe = f"{line} {w}".strip()
            if draw.textlength(probe, font=font) <= max_w or not line:
                line = probe
            else:
                lines.append(line)
                line = w
        if line:
            lines.append(line)
    return lines


def bake(source, eyebrow, headline, out_path, font_dir, quality=86, H=DEFAULT_H, position="left"):
    f_eyebrow, f_headline = load_fonts(font_dir)

    if source:
        base = cover(Image.open(source).convert("RGB"), W, H)
    else:
        base = Image.new("RGB", (W, H), (44, 48, 54))  # placeholder for review

    canvas = scrim_bottom(base, W, H) if position == "bottom" else scrim(base, W, H)
    draw = ImageDraw.Draw(canvas)

    f_headline, h_size = fit_headline(draw, headline, font_dir, TEXT_MAX_W)
    lines = wrap(draw, headline, f_headline, TEXT_MAX_W)
    line_h = int(h_size * HEADLINE_LEADING)
    block_h = EYEBROW_SIZE + 22 + line_h * len(lines)
    y = H - block_h - 56 if position == "bottom" else (H - block_h) // 2

    draw_tracked(draw, (MARGIN_X, y), eyebrow.upper(), f_eyebrow, GOLD_BRIGHT, EYEBROW_TRACKING)
    y += EYEBROW_SIZE + 22
    for line in lines:
        draw.text((MARGIN_X, y), line, font=f_headline, fill=WHITE)
        y += line_h

    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    canvas.save(out_path, "JPEG", quality=quality, optimize=True, progressive=True)
    return out_path, os.path.getsize(out_path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", help="the property rendering to bake onto")
    ap.add_argument("--out", default="hero-out", help="output directory")
    ap.add_argument("--fonts", default="fonts", help="directory holding the DM Sans TTFs")
    ap.add_argument("--all", action="store_true", help="render every variant in VARIANTS")
    ap.add_argument("--name", default="hero")
    ap.add_argument("--height", type=int, default=DEFAULT_H,
                    help="hero height at 1200 wide; 800 keeps a 3:2 site plan whole")
    ap.add_argument("--position", choices=("left", "bottom"), default="left",
                    help="where the type sits: over the left of the frame, or in a bottom band")
    ap.add_argument("--eyebrow", default="CRECO Commercial Real Estate")
    ap.add_argument("--headline", default="A rare opportunity for your practice|in the heart of Fair Oaks Ranch!")
    args = ap.parse_args()

    jobs = VARIANTS if args.all else [(args.name, args.eyebrow, args.headline)]
    for name, eyebrow, headline in jobs:
        path, size = bake(args.source, eyebrow, headline,
                          os.path.join(args.out, f"hero-{name}.jpg"), args.fonts,
                          H=args.height, position=args.position)
        print(f"{path}  {size // 1024} KB")
    if not args.source:
        print("\nNo --source given: drawn on a flat placeholder, type only.")


if __name__ == "__main__":
    main()
