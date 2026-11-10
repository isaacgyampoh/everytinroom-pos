#!/usr/bin/env python3
"""
Run the Product Studio over the existing catalogue.

    python3 tools/studio_run.py --limit 20 --dry-run
    python3 tools/studio_run.py --limit 50

WHERE THIS RUNS
    Anywhere with Python and a CPU: a laptop, or the repository's own GitHub
    Actions runner, which is free and unmetered because this repository is
    public. It is deliberately NOT a Supabase Edge Function — those are Deno
    with a short CPU budget and cannot load a 168MB ONNX model — and
    deliberately not Vercel, whose Hobby plan already paused this account once
    for exceeding fair use. No new hosting, no GPU, no recurring bill.

WHAT IT WILL NOT DO
    It never writes to the `products` table. Candidates are uploaded beside
    the originals as studio/<product-id>.webp and nothing else changes, so a
    run cannot alter a single price, name or live image. Approval happens in
    the till, by a person looking at the before and the after.

    That also means no database migration is needed: the existence of the
    object IS the pending state.

CREDENTIALS
    SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the environment, never
    from a file in the repository and never from the browser bundle. The
    service key is required because uploading to storage is a privileged act;
    it is read once, used server-side, and never logged.
"""

import argparse
import json
import os
import sys
import time
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import studio_process as sp

BUCKET = "product-images"
PREFIX = "studio"


def env(name):
    v = os.environ.get(name, "").strip()
    if not v:
        sys.exit(f"{name} is not set. Export it, or add it as a repository secret.")
    return v


def api(base, key, path, method="GET", body=None, headers=None):
    url = f"{base}{path}"
    h = {"apikey": key, "Authorization": f"Bearer {key}"}
    h.update(headers or {})
    req = urllib.request.Request(url, data=body, method=method, headers=h)
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.status, r.read()


def fetch_candidates(base, key, limit, redo=False):
    """Products with a photograph that has not been through the studio."""
    q = "select=id,name,category,image&image=not.is.null&order=name&limit=2000"
    _, raw = api(base, key, f"/rest/v1/products?{q}")
    rows = json.loads(raw)
    out = []
    for p in rows:
        img = (p.get("image") or "").strip()
        if not img:
            continue
        if not redo and f"/{PREFIX}/" in img:
            continue
        out.append(p)
    return out[:limit]


def already_done(base, key, product_id):
    """A candidate already waiting for review is not generated again."""
    path = f"/storage/v1/object/info/public/{BUCKET}/{PREFIX}/{product_id}.webp"
    try:
        status, _ = api(base, key, path)
        return status == 200
    except Exception:
        return False


def download(url, timeout=60):
    req = urllib.request.Request(url, headers={"User-Agent": "everytinroom-studio"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def upload(base, key, product_id, data):
    path = f"/storage/v1/object/{BUCKET}/{PREFIX}/{product_id}.webp"
    api(base, key, path, method="POST", body=data, headers={
        "Content-Type": "image/webp",
        "x-upsert": "true",
        "Cache-Control": "31536000",
    })
    return f"{base}/storage/v1/object/public/{BUCKET}/{PREFIX}/{product_id}.webp"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=25, help="how many to process this run")
    ap.add_argument("--dry-run", action="store_true", help="report what would happen, touch nothing")
    ap.add_argument("--redo", action="store_true", help="include images already studio-processed")
    ap.add_argument("--model", default="u2net")
    args = ap.parse_args()

    base = env("SUPABASE_URL").rstrip("/")
    key = env("SUPABASE_SERVICE_ROLE_KEY")

    cands = fetch_candidates(base, key, args.limit, args.redo)
    print(f"{len(cands)} candidate(s) this run (limit {args.limit})\n")
    if args.dry_run:
        for p in cands:
            print(f"  would process  {p['id']}  {p['name'][:46]}")
        print("\nDry run — nothing downloaded, nothing uploaded.")
        return

    session = None
    try:
        from rembg import new_session
        session = new_session(args.model)
    except Exception as e:
        # The model being unavailable is not a reason to half-process a
        # catalogue. Stop before touching anything.
        sys.exit(f"Could not load the '{args.model}' model: {e}")

    done = skipped = failed = 0
    t0 = time.time()
    for i, p in enumerate(cands, 1):
        pid, name = p["id"], (p.get("name") or "")[:40]
        if not args.redo and already_done(base, key, pid):
            print(f"  [{i}/{len(cands)}] {name:<42} already waiting for review")
            skipped += 1
            continue
        try:
            raw = download(p["image"])
        except Exception as e:
            print(f"  [{i}/{len(cands)}] {name:<42} source unreachable ({type(e).__name__})")
            failed += 1
            continue

        out, rep = sp.process(raw, session)
        if not out:
            print(f"  [{i}/{len(cands)}] {name:<42} {rep.get('verdict')}")
            failed += 1
            continue
        try:
            upload(base, key, pid, out)
        except Exception as e:
            print(f"  [{i}/{len(cands)}] {name:<42} upload failed ({type(e).__name__})")
            failed += 1
            continue
        print(f"  [{i}/{len(cands)}] {name:<42} {rep['src']} -> {rep['out']}  {rep['src_kb']}KB -> {rep['out_kb']}KB")
        done += 1

    el = time.time() - t0
    print(f"\n{done} ready for review, {skipped} already pending, {failed} could not be processed")
    print(f"{el:.0f}s total, {el/max(done,1):.1f}s per accepted image")
    print("\nNothing in the products table was touched. Approve in the till:")
    print("  Products -> AI Product Studio")
    # A run that produced nothing at all is a failure worth a non-zero exit.
    sys.exit(0 if done or skipped else 1)


if __name__ == "__main__":
    main()
