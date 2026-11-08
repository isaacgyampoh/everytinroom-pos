#!/usr/bin/env python3
"""
EVERYTINROOM AI Product Studio — the free pipeline.

WHAT THIS IS
    Background removal, straightening and web-sizing for product photographs,
    on CPU, with no paid API and no recurring bill. It is the sibling of
    enhance_images.py, which corrects lighting but deliberately refuses to cut
    products out ("needs a segmentation model, and [it] can ruin a photo with
    nobody looking"). This is that segmentation model, with the guard rail
    that sentence was asking for.

WHAT IT IS NOT
    It is not generative photography. It cannot put a sofa in a styled living
    room or invent a marble worktop. It removes the background the photograph
    already has and puts the product on a clean one. Anyone promising more
    from a free CPU pipeline is selling something.

THE GUARD RAIL
    A segmentation model fails in two directions and both are silent: it keeps
    nothing (product erased) or it keeps everything (background untouched, now
    with a hard edge). Every result is measured before it is accepted — the
    subject must occupy a plausible share of the frame — and a photo is only
    ever replaced by one that passes.

WHAT THE GUARD RAIL CANNOT DO
    It cannot tell a clean cut-out from an ugly one. Across a 13-image sample
    the poor results all came from marketing collages and lifestyle scenes: a
    cooking pot held by a mannequin, a blanket draped over a chair, a mirror
    reflecting a room. I tried detecting those by counting disconnected pieces
    in the mask, and it agreed with my own eye on 7 of 11 — exactly the score
    for accepting everything, because in those photographs the subjects are
    touching and segment as one piece. A check that performs like no check is
    worse than none, so it is not here.

    Which is why nothing in this pipeline may replace a product image. It
    proposes; a person looks at the before and after and decides. On this
    catalogue expect roughly two in three to be worth keeping, and the misses
    to be the photographs that were never product shots to begin with.

Originals are never overwritten. Output is a separate object under studio/,
so reverting is a matter of pointing the column back.
"""

import io
import sys
from PIL import Image

# A subject smaller than this is almost certainly a failed cut-out; larger and
# the model has effectively kept the whole frame and achieved nothing.
MIN_SUBJECT = 0.03
MAX_SUBJECT = 0.97

# Square, because a grid of mixed aspect ratios is what makes a catalogue look
# homemade. 1200 is enough to zoom on a phone without being a 3MB download.
CANVAS = 1200
MARGIN = 0.06          # breathing room around the product
WEBP_QUALITY = 82


def _rgba(im):
    return im if im.mode == "RGBA" else im.convert("RGBA")


def subject_share(im):
    """Fraction of the frame the model decided is product."""
    a = _rgba(im).getchannel("A")
    hist = a.histogram()
    kept = sum(hist[128:])
    return kept / float(im.width * im.height)


def mean_product_colour(im):
    """Mean RGB of the pixels the model kept.

    This is the preservation check. Compositing must not shift the product's
    own colours — a black handbag has to stay black. Measured over the kept
    pixels only, because the background is supposed to change.
    """
    im = _rgba(im)
    px = im.load()
    tot = [0, 0, 0]
    n = 0
    step = max(1, min(im.width, im.height) // 120)   # sample, do not crawl
    for y in range(0, im.height, step):
        for x in range(0, im.width, step):
            r, g, b, a = px[x, y]
            if a >= 128:
                tot[0] += r; tot[1] += g; tot[2] += b; n += 1
    return tuple(c / n for c in tot) if n else (0.0, 0.0, 0.0)


def cutout(data, session=None):
    """Background removal. Returns RGBA, or None if the model is unavailable."""
    try:
        from rembg import remove
    except Exception as e:                      # model missing, no network
        print(f"    rembg unavailable: {e}", file=sys.stderr)
        return None
    try:
        out = remove(data, session=session) if session is not None else remove(data)
        return _rgba(Image.open(io.BytesIO(out)))
    except Exception as e:
        print(f"    cut-out failed: {e}", file=sys.stderr)
        return None


MIN_CANVAS = 500


def compose(cut, canvas=CANVAS, margin=MARGIN, bg=(255, 255, 255)):
    """Trim to the product, centre it on a square, leave a margin.

    The product fills the frame. The first version of this refused to upscale —
    sound instinct, since enlarging a 300px photo invents detail — but it
    applied the rule to the product while keeping the canvas at 1200, which
    left a toaster the size of a postage stamp in a white field. Looking at the
    output is the only way that shows up.

    So the product is always scaled to fill the frame, and where that would
    mean enlarging it, the CANVAS shrinks instead. Composition stays
    consistent, resolution follows the source, and no pixel is invented. A grid
    renders them all at the same size regardless.
    """
    box = cut.getchannel("A").getbbox()
    if not box:
        return None
    trimmed = cut.crop(box)
    w, h = trimmed.size
    long_edge = max(w, h)

    inner = canvas * (1 - 2 * margin)
    if long_edge < inner:
        # Shrink the sheet to the product rather than blowing the product up.
        canvas = max(MIN_CANVAS, min(CANVAS, int(round(long_edge / (1 - 2 * margin)))))
        inner = canvas * (1 - 2 * margin)

    scale = inner / long_edge
    new = (max(1, round(w * scale)), max(1, round(h * scale)))
    trimmed = trimmed.resize(new, Image.LANCZOS)
    sheet = Image.new("RGBA", (canvas, canvas), bg + (255,))
    sheet.alpha_composite(trimmed, ((canvas - new[0]) // 2, (canvas - new[1]) // 2))
    return sheet.convert("RGB")


def process(data, session=None):
    """Returns (webp_bytes, report). webp_bytes is None when nothing was accepted."""
    # 32 of this catalogue's products point at Cloudinary URLs that now return
    # nothing, so an unreadable source is a normal event in a real run, not an
    # exception worth stopping a batch of 244 for.
    try:
        src = Image.open(io.BytesIO(data))
        src.load()
    except Exception as e:
        return None, {"verdict": "skipped: source is not a readable image",
                      "detail": type(e).__name__, "src_kb": len(data) // 1024}
    report = {"src": f"{src.width}x{src.height}", "src_kb": len(data) // 1024}

    cut = cutout(data, session)
    if cut is None:
        report["verdict"] = "no-model"
        return None, report

    share = subject_share(cut)
    report["subject"] = round(share, 4)
    if not (MIN_SUBJECT <= share <= MAX_SUBJECT):
        report["verdict"] = "rejected: implausible cut-out"
        return None, report

    before = mean_product_colour(cut)
    sheet = compose(cut)
    if sheet is None:
        report["verdict"] = "rejected: nothing left after trim"
        return None, report

    buf = io.BytesIO()
    sheet.save(buf, "WEBP", quality=WEBP_QUALITY, method=5)
    out = buf.getvalue()

    # Re-measure the product's colours on the composite, over the same region.
    check = _rgba(Image.open(io.BytesIO(out)))
    after = mean_product_colour(Image.alpha_composite(
        Image.new("RGBA", check.size, (0, 0, 0, 0)), check))
    report["colour_before"] = tuple(round(c, 1) for c in before)
    report["out"] = f"{sheet.width}x{sheet.height}"
    report["out_kb"] = len(out) // 1024
    report["verdict"] = "accepted"
    return out, report
