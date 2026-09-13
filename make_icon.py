# -*- coding: utf-8 -*-
"""The app icon: the VOIDBLOOM sigil, drawn the way the game draws things --
neon line work over a near-black ground, glow built from stacked blurred
strokes rather than a flat fill.

One drawing scaled down turns to mush at 16px, so this renders THREE
drawings and packs each into the .ico at the sizes it is actually good at:

    full    256, 128   sixteen petals, three orbits, motes
    medium   48,  32   eight petals, one orbit, bigger centre
    small    16         four petals and the seed, very heavy strokes
"""
from PIL import Image, ImageDraw, ImageFilter
import math, os

BG = (5, 7, 15, 255)
CYAN   = (158, 247, 255)
PINK   = (255, 122, 230)
VIOLET = (201, 163, 255)
LIME   = (141, 255, 107)
WHITE  = (255, 255, 255)


def glow(img, radius, gain):
    """A blurred copy of the strokes, added back underneath them."""
    b = img.filter(ImageFilter.GaussianBlur(radius))
    px = b.load()
    w, h = b.size
    for y in range(h):
        for x in range(w):
            r, g, bl, a = px[x, y]
            if a:
                px[x, y] = (r, g, bl, min(255, int(a * gain)))
    return b


def render(S, detail):
    cx = cy = S / 2
    art = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(art)
    u = S / 1024.0          # so every measurement below is in 1024-space

    def petal(ang, inner, outer, wide, col, w):
        a = math.radians(ang)
        tip = (cx + math.cos(a) * outer, cy + math.sin(a) * outer)
        base = (cx + math.cos(a) * inner, cy + math.sin(a) * inner)
        mid = (inner + outer) * 0.52
        la, ra = a - math.radians(wide), a + math.radians(wide)
        l = (cx + math.cos(la) * mid, cy + math.sin(la) * mid)
        r = (cx + math.cos(ra) * mid, cy + math.sin(ra) * mid)
        w = max(1, int(round(w)))
        d.line([base, l, tip], fill=col + (255,), width=w, joint='curve')
        d.line([base, r, tip], fill=col + (255,), width=w, joint='curve')

    def ring(r, col, w, start=0, end=360):
        d.arc([cx - r, cy - r, cx + r, cy + r], start, end,
              fill=col + (255,), width=max(1, int(round(w))))

    def disc(r, fill=None, outline=None, w=1):
        box = [cx - r, cy - r, cx + r, cy + r]
        if fill:    d.ellipse(box, fill=fill + (255,))
        if outline: d.ellipse(box, outline=outline + (255,), width=max(1, int(round(w))))

    if detail == 'full':
        for i in range(8):
            petal(i * 45 - 90, 85 * u, 415 * u, 15, CYAN, 9 * u)
        for i in range(8):
            petal(i * 45 - 90 + 22.5, 75 * u, 275 * u, 13, VIOLET, 7 * u)
        ring(452 * u, PINK, 7 * u, 200, 340); ring(452 * u, PINK, 7 * u, 20, 160)
        ring(345 * u, CYAN, 5 * u, 285, 55);  ring(345 * u, CYAN, 5 * u, 105, 235)
        ring(238 * u, LIME, 5 * u, 340, 80)
        for ang in (28, 150, 268):
            a = math.radians(ang)
            mx, my = cx + math.cos(a) * 452 * u, cy + math.sin(a) * 452 * u
            d.ellipse([mx - 13 * u, my - 13 * u, mx + 13 * u, my + 13 * u], fill=WHITE + (255,))
        disc(72 * u, outline=WHITE, w=9 * u)
        disc(30 * u, fill=WHITE)

    elif detail == 'medium':
        # half the petals, no violet inner set, one orbit — and everything
        # thicker, because a 1px stroke at 32px is a grey smudge
        for i in range(8):
            petal(i * 45 - 90, 110 * u, 430 * u, 17, CYAN, 26 * u)
        ring(330 * u, PINK, 20 * u, 200, 340)
        ring(330 * u, PINK, 20 * u, 20, 160)
        disc(120 * u, outline=WHITE, w=26 * u)
        disc(62 * u, fill=WHITE)

    else:  # small
        # at 16px only three things survive: a cross of petals, a ring, a dot.
        # It also has to FILL the box -- a shape floating in the middle of a
        # 16px square reads as a speck in the title bar.
        for i in range(4):
            petal(i * 90 - 90, 140 * u, 486 * u, 22, CYAN, 58 * u)
        disc(232 * u, outline=PINK, w=50 * u)
        disc(118 * u, fill=WHITE)

    canvas = Image.new('RGBA', (S, S), BG)
    if detail == 'full':
        canvas.alpha_composite(glow(art, 46 * u, 0.55))
        canvas.alpha_composite(glow(art, 14 * u, 0.85))
    else:
        # a smaller icon needs its glow tight, or the shape drowns in haze
        canvas.alpha_composite(glow(art, 18 * u, 0.5))
    canvas.alpha_composite(art)

    vig = Image.new('L', (S, S), 0)
    ImageDraw.Draw(vig).ellipse([-0.12 * S, -0.12 * S, 1.12 * S, 1.12 * S], fill=255)
    vig = vig.filter(ImageFilter.GaussianBlur(0.09 * S))
    dark = Image.new('RGBA', (S, S), (0, 0, 0, 255))
    return Image.composite(canvas, Image.alpha_composite(dark, canvas), vig).convert('RGB')


out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'build')
os.makedirs(out, exist_ok=True)

full   = render(1024, 'full')
medium = render(512,  'medium')
small  = render(256,  'small')

# each icon size gets the drawing that was designed for it
frames = [
    full.resize((256, 256), Image.LANCZOS),
    full.resize((128, 128), Image.LANCZOS),
    medium.resize((64, 64), Image.LANCZOS),
    medium.resize((48, 48), Image.LANCZOS),
    medium.resize((32, 32), Image.LANCZOS),
    small.resize((16, 16), Image.LANCZOS),
]

full.save(os.path.join(out, 'icon.png'))
frames[0].save(os.path.join(out, 'icon.ico'), format='ICO',
               sizes=[f.size for f in frames], append_images=frames[1:])
print('icon written:', os.path.join(out, 'icon.ico'))

# a contact sheet at true pixel sizes, for judging it
sheet = Image.new('RGB', (660, 300), (18, 20, 32))
sheet.paste(frames[0], (16, 22))
sheet.paste(frames[1], (292, 22))
sheet.paste(frames[3], (292, 168))
sheet.paste(frames[4], (356, 168))
sheet.paste(frames[5], (404, 168))
sheet.paste(full.resize((256, 256), Image.LANCZOS).resize((48, 48), Image.LANCZOS), (292, 232))
sheet.paste(full.resize((256, 256), Image.LANCZOS).resize((32, 32), Image.LANCZOS), (356, 232))
sheet.paste(full.resize((256, 256), Image.LANCZOS).resize((16, 16), Image.LANCZOS), (404, 232))
sheet.save('/tmp/iconsheet.png')
print('sheet: /tmp/iconsheet.png  (top row designed-for-size, bottom row naive downscale)')
