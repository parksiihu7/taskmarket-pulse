#!/usr/bin/env python3
"""
Build the share cards (1200x630) for the page and each view.

Uses only the Taskmarket brand kit's own assets and fonts: ground/maroon background,
Instrument Serif headline with one magenta italic word, the mark, and the address in
Departure Mono. No stock imagery, no invented numbers on the card.

    python3 scripts/make_og.py            # writes site/og/*.png
"""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BRAND = os.path.expanduser(os.environ.get("TM_BRAND_DIR", "brand"))
OUT = os.path.join(ROOT, "site", "og")

W, H = 1200, 630
GROUND = (18, 16, 14)
MAROON = (58, 20, 32)
CREAM = (239, 233, 226)
PAPER = (255, 246, 232)
MUTED = (176, 167, 157)
MAGENTA = (231, 64, 121)

CARDS = [
    ("og-overview", "Where the {money} goes.", "Taskmarket, live: escrowed rewards, agent swarms and the wallets that post the work."),
    ("og-flow", "Money in, money {out}.", "Every escrowed reward, traced to paid, locked or returned."),
    ("og-posters", "A few wallets post the {work}.", "Poster concentration, and the distinct posters each week."),
    ("og-swarm", "The swarm {converges}.", "How many agents pile onto a single task."),
    ("og-rhythm", "When the market {wakes}.", "Activity by hour of the week, in UTC."),
    ("og-feed", "Live from the {market}.", "What agents are posting, submitting and rating right now."),
    ("og-methods", "Every number, {reproducible}.", "The endpoints, the units and how each figure is made."),
]


def font(name, size):
    path = os.path.join(BRAND, name)
    f = ImageFont.truetype(path, size)
    return f


def fit_headline(text_parts, size=84, max_width=W - 200):
    """Lay out ['Where the ', ('money', italic), ' goes.'] into at most two lines."""
    serif = font("InstrumentSerif-Regular.ttf", size)
    italic = font("InstrumentSerif-Italic.ttf", size)
    words = []
    for part, style in text_parts:
        for w in part.split(" "):
            if w:
                words.append((w, style))
    probe = Image.new("RGB", (10, 10))
    d = ImageDraw.Draw(probe)

    lines, line, line_w = [], [], 0
    space = d.textlength(" ", font=serif)
    for word, style in words:
        f = italic if style else serif
        wl = d.textlength(word, font=f)
        add = wl if not line else space + wl
        if line_w + add > max_width and line:
            lines.append(line)
            line, line_w = [(word, style)], wl
        else:
            line.append((word, style))
            line_w += add
    if line:
        lines.append(line)
    return lines, serif, italic, space


def draw_headline(d, lines, x, y, serif, italic, space, size):
    lh = int(size * 1.06)
    for i, line in enumerate(lines):
        cx = x
        for word, style in line:
            f = italic if style else serif
            d.text((cx, y + i * lh), word, font=f, fill=MAGENTA if style else PAPER)
            cx += d.textlength(word, font=f) + space


def build(name, headline, blurb):
    img = Image.new("RGB", (W, H), GROUND)

    # the kit's plate, very quiet, over the whole card
    plate_path = os.path.join(BRAND, "plate-converge-landscape.jpg")
    if os.path.exists(plate_path):
        plate = Image.open(plate_path).convert("RGB").resize((W, H))
        img = Image.blend(img, plate, 0.14)

    # maroon glow in the top-right corner, soft enough to read as light
    glow = Image.new("L", (W, H), 0)
    gd = ImageDraw.Draw(glow)
    cx, cy, radius = W - 170, -210, 820
    steps = 90
    for i in range(steps, 0, -1):
        r = int(radius * i / steps)
        a = int(150 * (1 - i / steps) ** 1.5 + 8)
        gd.ellipse([cx - r, cy - r, cx + r, cy + r], fill=a)
    from PIL import ImageFilter
    glow = glow.filter(ImageFilter.GaussianBlur(60))
    img = Image.composite(Image.new("RGB", (W, H), MAROON), img, glow)

    # a dark floor under the text so the type stays crisp
    floor = Image.new("L", (W, H), 0)
    fd = ImageDraw.Draw(floor)
    for y in range(H):
        fd.line([(0, y), (W, y)], fill=int(150 * max(0, (y - H * 0.35) / (H * 0.65)) ** 1.3))
    img = Image.composite(Image.new("RGB", (W, H), GROUND), img, floor)

    d = ImageDraw.Draw(img)

    # mark, top-left, with clear space
    mark_path = os.path.join(BRAND, "taskmarket-mark.png")
    if os.path.exists(mark_path):
        mark = Image.open(mark_path).convert("RGB").resize((56, 56), Image.NEAREST)
        img.paste(mark, (64, 56))

    # headline, at most two lines
    parts = []
    for token in headline.split(" "):
        if token.startswith("{") and token.endswith("}."):
            parts.append((token[1:-2], True))
            parts.append((".", False))
        elif token.startswith("{"):
            parts.append((token[1:-1], True))
        else:
            parts.append((token, False))
    size = 88
    for s in (88, 80, 72, 64):
        lines, serif, italic, space = fit_headline(parts, size=s)
        if len(lines) <= 2:
            size = s
            break
    draw_headline(d, lines, 84, 250, serif, italic, space, size)

    body = font("InterTight-Variable.ttf", 26)
    d.text((86, 250 + int(size * 1.06) * len(lines) + 26), blurb, font=body, fill=MUTED)

    mono = font("DepartureMono-Regular.otf", 22)
    d.line([(86, H - 118), (W - 86, H - 118)], fill=(69, 62, 55), width=1)
    d.text((86, H - 96), "taskmarket.dev", font=mono, fill=CREAM)
    small = font("DepartureMono-Regular.otf", 16)
    d.text((86, H - 58), "MADE FOR A PAID TASKMARKET BOUNTY · NOT AN OFFICIAL PRODUCT", font=small, fill=(122, 114, 105))

    img.save(os.path.join(OUT, name + ".png"), optimize=True)
    print("wrote", name + ".png")


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, headline, blurb in CARDS:
        build(name, headline, blurb)
    # the plain og-image.png the brief asks for
    src = os.path.join(OUT, "og-overview.png")
    dst = os.path.join(ROOT, "site", "og-image.png")
    Image.open(src).save(dst, optimize=True)
    print("wrote og-image.png")


if __name__ == "__main__":
    main()
