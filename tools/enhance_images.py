#!/usr/bin/env python3
"""
Batch-correct EVERYTINROOM product photos.

The catalogue was shot on a phone inside the shop. Measured across a 70-photo
sample: median luminance 140 against a comfortable band of 150-205, half the
photos below that, a median 18-point warm colour cast, and only 6 in 70 on a
clean backdrop. On a white product grid they read as murky and uneven.

WHAT THIS DOES NOT DO
    It does not invent detail, restyle, or cut products out of their
    background. Those need a real camera or a segmentation model, and both can
    ruin a photo with nobody looking.

THE GUARD RAIL
    Every correction is checked before it is accepted. A first attempt at this
    used grey-world balance and a gamma lift with no verification and pushed
    photos from 5% clipped highlights to 80% — detail burned to flat white. So
    each image is now measured after processing, and if the result clips more
    highlights than it started with, or drifts too dark, the correction is
    re-tried gentler and then abandoned. A photo is only ever replaced by a
    measurably better one; otherwise the original passes through untouched.

Originals are never overwritten. Output is a separate object, so reverting is
a matter of pointing the column back.
"""

import io
import math
import sys
from PIL import Image, ImageEnhance, ImageStat, ImageOps

TARGET = 172           # middle of the readable band
CLIP_TOLERANCE = 1.0   # extra % of blown highlights on the PRODUCT we accept


# ---------------------------------------------------------------- measurement
def _rgb(im):
    return im if im.mode == "RGB" else im.convert("RGB")

def _subject(im):
    """The centre 60% — where the product is.

    Measuring the whole frame hides the failure that matters: a bright product
    on a dark shelf keeps the frame average low while the product itself burns
    out. The first batch was accepted on whole-frame numbers and put 23 of 45
    photos from 0.1% to 11% blown highlights ON THE PRODUCT. Every decision is
    now made on this region.
    """
    im = _rgb(im)
    w, h = im.size
    return im.crop((int(w * .2), int(h * .2), int(w * .8), int(h * .8)))

def _mean(im):
    return sum(ImageStat.Stat(_subject(im)).mean[:3]) / 3.0

def _clipped(im):
    """Percentage of the PRODUCT at or near pure white — burnt-out detail."""
    g = _subject(im).convert("L")
    h = g.histogram()
    return 100.0 * sum(h[250:]) / max(1, sum(h))

def _frame_mean(im):
    return sum(ImageStat.Stat(_rgb(im)).mean[:3]) / 3.0

def _cast(im):
    m = ImageStat.Stat(_subject(im)).mean[:3]
    return max(m) - min(m)


# ---------------------------------------------------------------- corrections
def _white_balance(im, strength):
    """Grey-world, damped, and clamped so no channel is scaled past white."""
    r, g, b = ImageStat.Stat(_subject(im)).mean[:3]
    if min(r, g, b) < 1:
        return im
    grey = (r + g + b) / 3.0
    out = []
    for chan, m in zip(im.split()[:3], (r, g, b)):
        f = 1.0 + (grey / m - 1.0) * strength
        f = max(0.75, min(1.25, f))          # a cast correction, not a recolour
        out.append(chan.point(lambda v, f=f: min(255, int(v * f))))
    return Image.merge("RGB", out)


def _gamma_to(im, target, max_lift):
    """Map the image mean toward `target`.

    To move mean m onto t you apply v -> (v/255)**k with k = ln(t/255)/ln(m/255).
    An exponent BELOW 1 brightens and above 1 darkens. The first version of this
    applied 1/k instead of k, so every dark photo — the ones that most needed
    lifting — was pushed darker still. `max_lift` caps how far a single pass may
    travel in either direction.
    """
    m = _mean(im)
    if m <= 1:
        return im
    k = math.log(target / 255.0) / math.log(m / 255.0)
    k = max(1.0 / max_lift, min(max_lift, k))
    if abs(k - 1.0) < 0.02:
        return im
    lut = [min(255, max(0, int(((v / 255.0) ** k) * 255))) for v in range(256)]
    return im.point(lut * 3)


def _correct(im, strength):
    """One pass at `strength` in 0..1. Gentler settings clip less."""
    out = im
    if _cast(out) > 10:
        out = _white_balance(out, 0.65 * strength)
    # autocontrast with a cutoff spreads the histogram without hunting for
    # absolute black/white in a photo that has neither.
    out = ImageOps.autocontrast(out, cutoff=(0.4, 0.2), preserve_tone=True)
    out = _gamma_to(out, TARGET, 1.0 + 1.6 * strength)
    if strength > 0.5:
        out = ImageEnhance.Color(out).enhance(1.0 + 0.05 * strength)
    out = ImageEnhance.Sharpness(out).enhance(1.0 + 0.15 * strength)
    return out


# No resizing, no canvas. An earlier version pasted every photo onto a 1200px
# square, which threw away most of the resolution on a 4032px original and
# padded the frame with white — the padding then skewed every measurement taken
# of the result. The app already presents these as squares in CSS, and the
# Supabase transform serves whatever width a screen actually needs, so the
# stored file should stay full size and full quality.


# ---------------------------------------------------------------------- entry
def enhance(data: bytes, report=False):
    src = ImageOps.exif_transpose(Image.open(io.BytesIO(data)))
    src = _rgb(src)

    before_clip = _clipped(src)
    before_mean = _mean(src)

    chosen, note = src, "unchanged"

    # Only touch a photo that is actually off. Re-encoding one that is already
    # close to target costs a little JPEG quality and gains nothing visible —
    # a 166 lifted to 168 is not worth a rewrite.
    needs_work = abs(before_mean - TARGET) > 12 or _cast(src) > 22

    # Try full strength, then back off. Accept the first result that is
    # genuinely better; if none is, keep the original.
    for strength in (1.0, 0.6, 0.35) if needs_work else ():
        cand = _correct(src, strength)
        clip = _clipped(cand)
        mean = _mean(cand)
        if clip > before_clip + CLIP_TOLERANCE:
            continue                      # burning out highlights
        if mean < before_mean - 6:
            continue                      # darker than we started
        if abs(mean - TARGET) > abs(before_mean - TARGET) - 2:
            continue                      # not meaningfully closer to target
        chosen, note = cand, f"corrected @{strength:g}"
        break

    buf = io.BytesIO()
    chosen.save(buf, "JPEG", quality=94, optimize=True, progressive=True,
                subsampling=0)   # 4:4:4 — no chroma loss on fabric and print
    if report:
        return buf.getvalue(), {
            "note": note,
            "before_mean": round(before_mean), "after_mean": round(_mean(chosen)),
            "before_clip": round(before_clip, 1), "after_clip": round(_clipped(chosen), 1),
        }
    return buf.getvalue()


if __name__ == "__main__":
    data = open(sys.argv[1], "rb").read()
    out, info = enhance(data, report=True)
    open(sys.argv[2], "wb").write(out)
    print(sys.argv[1], "->", sys.argv[2], info)
