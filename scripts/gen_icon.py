"""Generate a real app icon for ClawAgents Desktop.

Produces a 1024x1024 source PNG with:
  - a dark rounded-square base in the indigo/blue range,
  - three light "claw" slashes across the lower-right corner,
  - a centered uppercase "C" for ClawAgents.

The .icns + multi-size .png set is then produced by `npm run tauri icon`,
which expects a single high-res source.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


SIZE = 1024
RADIUS = 200
BG = (45, 55, 130, 255)      # deep indigo
BG_HI = (90, 110, 200, 255)  # lighter top-left for a subtle gradient
FG = (245, 245, 250, 255)    # near-white
ACCENT = (255, 200, 120, 220)  # warm claw-mark accent


def make_icon(out_path: Path) -> None:
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Rounded-square base — simulated as a solid fill clipped by a rounded mask.
    base = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    bd = ImageDraw.Draw(base)
    bd.rounded_rectangle((0, 0, SIZE, SIZE), radius=RADIUS, fill=BG)

    # Diagonal "highlight" sheen from top-left corner, just a translucent
    # overlay restricted to the rounded square shape via the same mask.
    sheen = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    sd = ImageDraw.Draw(sheen)
    sd.polygon([(0, 0), (SIZE, 0), (0, SIZE)], fill=(BG_HI[0], BG_HI[1], BG_HI[2], 90))
    mask = Image.new("L", (SIZE, SIZE), 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle((0, 0, SIZE, SIZE), radius=RADIUS, fill=255)
    base = Image.composite(Image.alpha_composite(base, sheen), base, mask)

    # Three diagonal "claw" slashes in the lower-right quadrant.
    claws = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    cd = ImageDraw.Draw(claws)
    for i, off in enumerate((0, 130, 260)):
        # Slight thickness variation so they read as claw marks, not just bars.
        thick = 70 - i * 8
        cd.line(
            [(620 + off // 2, 520 + off), (1080 + off // 2, 280 + off)],
            fill=ACCENT,
            width=thick,
        )
    # Mask the claws to the rounded base so they don't bleed past the corner.
    claws = Image.composite(claws, Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0)), mask)
    base = Image.alpha_composite(base, claws)

    # Big centered uppercase "C".
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Avenir Next.ttc", 720)
    except OSError:
        try:
            font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 720)
        except OSError:
            font = ImageFont.load_default()
    glyph = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glyph)
    text = "C"
    bbox = gd.textbbox((0, 0), text, font=font)
    w = bbox[2] - bbox[0]
    h = bbox[3] - bbox[1]
    gd.text(
        ((SIZE - w) / 2 - bbox[0], (SIZE - h) / 2 - bbox[1] - 30),
        text,
        font=font,
        fill=FG,
    )
    base = Image.alpha_composite(base, glyph)

    img = Image.alpha_composite(img, base)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(out_path)
    print(f"wrote {out_path} ({out_path.stat().st_size:,} bytes)")


if __name__ == "__main__":
    import sys

    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("scripts/icon-source.png")
    make_icon(out)
