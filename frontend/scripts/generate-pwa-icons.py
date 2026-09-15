#!/usr/bin/env python3
"""Composite the exact logo A PNG onto forest-green iOS rounded-square icons.

Run from repo root:
    python3 frontend/scripts/generate-pwa-icons.py
"""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

SCRIPT_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = SCRIPT_DIR.parent
PUBLIC_DIR = FRONTEND_DIR / "public"
SOURCE = SCRIPT_DIR / "logo-a-exact-source.png"

# Theme / iOS home-screen background used by theme-color and the previous icon plate.
FOREST = (8, 36, 33, 255)  # #082421
# iOS app-icon corner radius ≈ 22.37% of the side (squircle approximation).
IOS_CORNER_RATIO = 0.2237
# "any" icons: circular mark inside the rounded square with padding.
ANY_MARK_RATIO = 0.72
# Maskable safe zone is the inner 80%; 74% keeps the ring off the crop.
MASKABLE_MARK_RATIO = 0.74


def _is_paper(px: tuple[int, int, int, int]) -> bool:
    r, g, b, a = px
    if a < 8:
        return True
    return r > 242 and g > 242 and b > 242


def extract_circular_mark(src: Image.Image) -> Image.Image:
    """Crop logo A to its circular disc; keep interior white; punch exterior paper."""
    rgba = src.convert("RGBA")
    pix = rgba.load()
    w, h = rgba.size
    ink: list[tuple[int, int]] = []
    for y in range(h):
        for x in range(w):
            if not _is_paper(pix[x, y]):
                ink.append((x, y))
    if not ink:
        raise SystemExit("logo A source has no visible mark")

    minx = min(x for x, _ in ink)
    maxx = max(x for x, _ in ink)
    miny = min(y for _, y in ink)
    maxy = max(y for _, y in ink)
    cx = (minx + maxx) / 2.0
    cy = (miny + maxy) / 2.0
    radius = 0.0
    for x, y in ink:
        radius = max(radius, math.hypot(x - cx, y - cy))

    side = int(math.ceil(radius * 2)) + 2
    x0 = int(round(cx - side / 2.0))
    y0 = int(round(cy - side / 2.0))
    canvas = Image.new("RGBA", (side, side), (255, 255, 255, 255))
    canvas.paste(rgba, (-x0, -y0))

    mask = Image.new("L", (side, side), 0)
    draw = ImageDraw.Draw(mask)
    local_cx = cx - x0
    local_cy = cy - y0
    # Tight to the outer ring so green, not a white sticker halo, shows outside.
    box = (
        local_cx - radius,
        local_cy - radius,
        local_cx + radius,
        local_cy + radius,
    )
    draw.ellipse(box, fill=255)
    canvas.putalpha(mask)
    return canvas


def rounded_square_mask(size: int, radius: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return mask.filter(ImageFilter.GaussianBlur(0.4))


def compose_icon(
    mark: Image.Image,
    size: int,
    *,
    maskable: bool,
    opaque: bool = False,
) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), FOREST)
    if not maskable and not opaque:
        radius = max(1, round(size * IOS_CORNER_RATIO))
        canvas.putalpha(rounded_square_mask(size, radius))

    ratio = MASKABLE_MARK_RATIO if maskable else ANY_MARK_RATIO
    mark_size = max(1, round(size * ratio))
    mark_resized = mark.resize((mark_size, mark_size), Image.Resampling.LANCZOS)
    ox = (size - mark_size) // 2
    oy = (size - mark_size) // 2
    canvas.alpha_composite(mark_resized, (ox, oy))
    if opaque:
        return canvas.convert("RGB")
    return canvas


def save_png(img: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, format="PNG", optimize=True)
    print(f"wrote {path.relative_to(FRONTEND_DIR)} ({img.size[0]}x{img.size[1]})")


def main() -> None:
    if not SOURCE.exists():
        raise SystemExit(f"missing exact logo A source: {SOURCE}")
    mark = extract_circular_mark(Image.open(SOURCE))

    # Versioned, cache-busted names referenced by index.html + manifest.
    # apple-touch-icon is opaque RGB: iOS applies its own squircle mask.
    specs: list[tuple[str, int, bool, bool]] = [
        ("favicon-32-logo-a.png", 32, False, False),
        ("apple-touch-icon-logo-a.png", 180, False, True),
        ("icon-192-logo-a.png", 192, False, False),
        ("icon-192-maskable-logo-a.png", 192, True, True),
        ("icon-512-logo-a.png", 512, False, False),
        ("icon-512-maskable-logo-a.png", 512, True, True),
    ]
    for name, size, maskable, opaque in specs:
        save_png(
            compose_icon(mark, size, maskable=maskable, opaque=opaque),
            PUBLIC_DIR / name,
        )

    # Overwrite legacy unversioned URLs so they never serve the old arc+dot art.
    legacy = {
        "favicon-32.png": "favicon-32-logo-a.png",
        "apple-touch-icon.png": "apple-touch-icon-logo-a.png",
        "icon-192.png": "icon-192-logo-a.png",
        "icon-512.png": "icon-512-logo-a.png",
    }
    for old, new in legacy.items():
        src = PUBLIC_DIR / new
        dst = PUBLIC_DIR / old
        dst.write_bytes(src.read_bytes())
        print(f"synced legacy {old} <- {new}")


if __name__ == "__main__":
    main()
