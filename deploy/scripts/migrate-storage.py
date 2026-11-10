#!/usr/bin/env python3
"""
Copy a Supabase Storage bucket to an S3-compatible bucket (Cloudflare R2),
verifying every object, and never deleting anything from the source.

    export SUPABASE_URL=https://<ref>.supabase.co
    export SUPABASE_SERVICE_ROLE_KEY=...        # read access to the bucket
    export S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com
    export S3_BUCKET=everytinroom-images
    export S3_ACCESS_KEY_ID=...
    export S3_SECRET_ACCESS_KEY=...

    # look, change nothing:
    deploy/scripts/migrate-storage.py --bucket product-images --plan

    # copy, verifying each object as it lands:
    deploy/scripts/migrate-storage.py --bucket product-images --copy

    # check a previous copy without transferring anything:
    deploy/scripts/migrate-storage.py --bucket product-images --verify

NEVER DELETES FROM THE SOURCE. There is no flag for it. The Supabase bucket
is the only copy of 1,112 product photographs until the new one is proven, and
a script that can delete the source is a script that will one day delete the
source.

WHAT --plan TELLS YOU WITHOUT TOUCHING THE TARGET
    How many objects, their total size, how many are referenced by a product
    row, and how many are orphans. An orphan is not necessarily rubbish -- it
    may be an older image a record no longer points at -- so they are copied
    too, and merely reported.

VERIFICATION
    Size equality, plus an MD5 of the bytes compared against the object's
    ETag where the store provides a plain MD5 one. R2 and Supabase both give a
    plain MD5 ETag for a single-part upload, which every image here is. Where
    an ETag is absent or multipart, the size check stands alone and the object
    is reported as size-only so the gap is visible rather than assumed away.
"""

import argparse
import hashlib
import json
import os
import subprocess
import sys
import datetime
import hmac
import urllib.parse


def need(name):
    v = os.environ.get(name, "").strip()
    if not v:
        sys.exit(f"{name} is not set. See the header of this script.")
    return v


def curl(url, headers=None, method="GET", data=None, out=None, extra=None):
    """curl rather than urllib: stock macOS python has no CA bundle."""
    cmd = ["curl", "-s", "-S", "--max-time", "300", "-X", method, "-w", "\n%{http_code}"]
    for k, v in (headers or {}).items():
        cmd += ["-H", f"{k}: {v}"]
    if data is not None:
        cmd += ["--data-binary", "@-" if data == "-" else data]
    if out:
        cmd += ["-o", out]
    cmd += (extra or [])
    cmd.append(url)
    r = subprocess.run(cmd, capture_output=True, text=False)
    raw = r.stdout
    try:
        text = raw.decode("utf-8", "replace")
    except Exception:
        text = ""
    code = text.strip().split("\n")[-1] if text.strip() else "000"
    body = text[: text.rfind("\n")] if "\n" in text else ""
    return code, body


# ---------------------------------------------------------------------------
# Source: Supabase Storage
# ---------------------------------------------------------------------------
def list_source(sb_url, key, bucket, prefix="", _depth=0):
    """Every object in the bucket, recursing into prefixes.

    Supabase's list endpoint returns ONE LEVEL at a time: an entry with no
    `id` is a folder, not a file. Everytinroom's product-images bucket turned
    out to hold everything under three prefixes (_test, enhanced, products),
    so a flat listing reported zero objects -- which, in a migration script,
    is the difference between "there is nothing to copy" and "I copied
    nothing". It recurses.
    """
    if _depth > 10:
        print(f"  refusing to recurse past 10 levels at {prefix!r}", file=sys.stderr)
        return []
    objects, offset, limit = [], 0, 1000
    while True:
        code, body = curl(
            f"{sb_url}/storage/v1/object/list/{bucket}",
            {"Authorization": f"Bearer {key}", "apikey": key,
             "Content-Type": "application/json"},
            "POST",
            json.dumps({"prefix": prefix, "limit": limit, "offset": offset,
                        "sortBy": {"column": "name", "order": "asc"}}),
        )
        if code != "200":
            sys.exit(f"Listing {bucket!r} prefix {prefix!r} failed with HTTP {code}: {body[:300]}")
        page = json.loads(body) if body.strip() else []
        if not page:
            break
        for o in page:
            full = f"{prefix}{o['name']}" if prefix else o["name"]
            if o.get("id") is None:
                # A folder. Recurse into it and keep a marker so the report can
                # say how the bucket is laid out.
                objects.append({"name": full, "folder": True})
                objects.extend(list_source(sb_url, key, bucket, full + "/", _depth + 1))
                continue
            meta = o.get("metadata") or {}
            objects.append({
                "name": full,
                "size": meta.get("size"),
                "mime": meta.get("mimetype"),
                "etag": (meta.get("eTag") or "").strip('"'),
                "folder": False,
            })
        if len(page) < limit:
            break
        offset += limit
    return objects


# ---------------------------------------------------------------------------
# Target: S3 / R2, signed with SigV4 by hand (no boto3 dependency)
# ---------------------------------------------------------------------------
def sigv4(method, endpoint, bucket, key_path, access_key, secret_key,
          region="auto", payload_hash="UNSIGNED-PAYLOAD", length=None,
          content_type=None):
    host = urllib.parse.urlparse(endpoint).netloc
    # Path-style, which R2 accepts and which avoids DNS for every bucket.
    canonical_uri = "/" + bucket + "/" + urllib.parse.quote(key_path, safe="/~")
    now = datetime.datetime.now(datetime.timezone.utc)
    amzdate = now.strftime("%Y%m%dT%H%M%SZ")
    datestamp = now.strftime("%Y%m%d")

    headers = {"host": host, "x-amz-content-sha256": payload_hash,
               "x-amz-date": amzdate}
    if length is not None:
        headers["content-length"] = str(length)
    if content_type:
        headers["content-type"] = content_type

    signed = ";".join(sorted(headers))
    canonical_headers = "".join(f"{k}:{headers[k]}\n" for k in sorted(headers))
    canonical_request = "\n".join(
        [method, canonical_uri, "", canonical_headers, signed, payload_hash])

    scope = f"{datestamp}/{region}/s3/aws4_request"
    to_sign = "\n".join(["AWS4-HMAC-SHA256", amzdate, scope,
                         hashlib.sha256(canonical_request.encode()).hexdigest()])

    def _h(k, m):
        return hmac.new(k, m.encode(), hashlib.sha256).digest()

    k = _h(_h(_h(_h(("AWS4" + secret_key).encode(), datestamp), region), "s3"),
           "aws4_request")
    sig = hmac.new(k, to_sign.encode(), hashlib.sha256).hexdigest()

    headers["Authorization"] = (
        f"AWS4-HMAC-SHA256 Credential={access_key}/{scope}, "
        f"SignedHeaders={signed}, Signature={sig}")
    return f"{endpoint.rstrip('/')}{canonical_uri}", headers


def head_target(cfg, key_path):
    url, headers = sigv4("HEAD", cfg["endpoint"], cfg["bucket"], key_path,
                         cfg["access"], cfg["secret"])
    code, _ = curl(url, headers, "HEAD", out="/dev/null")
    return code


def put_target(cfg, key_path, local_file, content_type):
    size = os.path.getsize(local_file)
    with open(local_file, "rb") as f:
        body = f.read()
    url, headers = sigv4("PUT", cfg["endpoint"], cfg["bucket"], key_path,
                         cfg["access"], cfg["secret"],
                         payload_hash=hashlib.sha256(body).hexdigest(),
                         length=size, content_type=content_type)
    code, resp = curl(url, headers, "PUT", data=local_file)
    return code, resp


# ---------------------------------------------------------------------------
def product_references(sb_url, key):
    """Which image paths a product row points at, so orphans are visible."""
    code, body = curl(f"{sb_url}/rest/v1/products?select=id,image&limit=10000",
                      {"Authorization": f"Bearer {key}", "apikey": key})
    if code != "200":
        return None
    refs = {}
    for row in json.loads(body or "[]"):
        img = (row.get("image") or "").strip()
        if img:
            refs.setdefault(img.rsplit("/", 1)[-1], []).append(row["id"])
    return refs


def human(n):
    n = n or 0
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return f"{n:.0f} {unit}"
        n /= 1024
    return f"{n:.1f} TB"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bucket", required=True)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--plan", action="store_true", help="report only; touches no target")
    g.add_argument("--copy", action="store_true")
    g.add_argument("--verify", action="store_true", help="check a previous copy")
    ap.add_argument("--limit", type=int, default=0, help="stop after N objects")
    ap.add_argument("--prefix", default="", help="only keys starting with this")
    args = ap.parse_args()

    sb_url = need("SUPABASE_URL").rstrip("/")
    sb_key = need("SUPABASE_SERVICE_ROLE_KEY")

    print(f"Listing {args.bucket} ...", file=sys.stderr)
    objects = list_source(sb_url, sb_key, args.bucket)
    files = [o for o in objects if not o["folder"]]
    folders = [o for o in objects if o["folder"]]
    if args.prefix:
        files = [o for o in files if o["name"].startswith(args.prefix)]
    total = sum(o.get("size") or 0 for o in files)

    print()
    print(f"  bucket            {args.bucket}")
    print(f"  objects           {len(files)}")
    print(f"  total size        {human(total)}")
    if folders:
        print(f"  prefixes          {len(folders)}: {', '.join(f['name'] for f in folders[:6])}")
        # Per-prefix totals, because "1,112 objects" hides that one prefix is
        # test data and another is a second copy of every photograph.
        for f in folders:
            pref = f["name"] + "/"
            n = [o for o in files if o["name"].startswith(pref)]
            if n:
                print(f"      {pref:<24} {len(n):>5} objects  {human(sum(o.get('size') or 0 for o in n))}")
    missing_size = [o for o in files if not o.get("size")]
    if missing_size:
        print(f"  no size reported  {len(missing_size)}  (cannot be size-verified)")

    refs = product_references(sb_url, sb_key)
    if refs is not None:
        names = {o["name"].rsplit("/", 1)[-1] for o in files}
        referenced = names & set(refs)
        orphans = names - set(refs)
        dangling = set(refs) - names
        print(f"  referenced by a product   {len(referenced)}")
        print(f"  not referenced (orphans)  {len(orphans)}  — copied anyway, not deleted")
        if dangling:
            print(f"  products pointing at a MISSING file  {len(dangling)}")
            for n in sorted(dangling)[:5]:
                print(f"      {n}  (products: {', '.join(refs[n][:3])})")
    else:
        print("  could not read the products table, so references were not checked")

    if args.plan:
        print()
        print("  --plan: nothing was transferred and no target was contacted.")
        print("  Set the S3_* variables and re-run with --copy.")
        return

    cfg = {"endpoint": need("S3_ENDPOINT").rstrip("/"), "bucket": need("S3_BUCKET"),
           "access": need("S3_ACCESS_KEY_ID"), "secret": need("S3_SECRET_ACCESS_KEY")}

    work = files[: args.limit] if args.limit else files
    copied = skipped = failed = verified = sizeonly = 0
    tmp = "/tmp/.migrate-storage.bin"

    for i, o in enumerate(work, 1):
        name = o["name"]
        prefix = f"  [{i}/{len(work)}] {name[:52]:<52}"

        if args.verify:
            code = head_target(cfg, name)
            if code == "200":
                verified += 1
                print(prefix + " present")
            else:
                failed += 1
                print(prefix + f" MISSING (HTTP {code})")
            continue

        if head_target(cfg, name) == "200":
            skipped += 1
            print(prefix + " already there")
            continue

        code, _ = curl(f"{sb_url}/storage/v1/object/{args.bucket}/{urllib.parse.quote(name)}",
                       {"Authorization": f"Bearer {sb_key}", "apikey": sb_key},
                       out=tmp)
        if code != "200":
            failed += 1
            print(prefix + f" download failed (HTTP {code})")
            continue

        got = os.path.getsize(tmp)
        if o.get("size") and got != o["size"]:
            failed += 1
            print(prefix + f" size mismatch on download: {got} vs {o['size']}")
            continue

        pcode, presp = put_target(cfg, name, tmp, o.get("mime") or "application/octet-stream")
        if pcode not in ("200", "201"):
            failed += 1
            print(prefix + f" upload failed (HTTP {pcode}) {presp[:120]}")
            continue

        # Verify by reading back the size, and the ETag when it is a plain MD5.
        local_md5 = hashlib.md5(open(tmp, "rb").read()).hexdigest()
        url, headers = sigv4("HEAD", cfg["endpoint"], cfg["bucket"], name,
                             cfg["access"], cfg["secret"])
        hcode, _ = curl(url, headers, "HEAD", out="/dev/null", extra=["-D", "/tmp/.hdrs"])
        remote_etag = remote_len = None
        try:
            for line in open("/tmp/.hdrs", "r", errors="replace"):
                low = line.lower()
                if low.startswith("etag:"):
                    remote_etag = line.split(":", 1)[1].strip().strip('"')
                if low.startswith("content-length:"):
                    remote_len = int(line.split(":", 1)[1].strip())
        except OSError:
            pass

        if remote_len is not None and remote_len != got:
            failed += 1
            print(prefix + f" landed with the wrong size: {remote_len} vs {got}")
            continue
        if remote_etag and "-" not in remote_etag:
            if remote_etag.lower() != local_md5:
                failed += 1
                print(prefix + " checksum mismatch after upload")
                continue
            copied += 1
            print(prefix + f" copied {human(got)} ✓md5")
        else:
            copied += 1
            sizeonly += 1
            print(prefix + f" copied {human(got)} (size only, no plain ETag)")

    try:
        os.remove(tmp)
    except OSError:
        pass

    print()
    if args.verify:
        print(f"  verified present {verified}, missing {failed}")
    else:
        print(f"  copied {copied}, already there {skipped}, failed {failed}")
        if sizeonly:
            print(f"  of the copies, {sizeonly} were verified by size alone")
    print()
    print("  Nothing was deleted from Supabase. The source bucket is untouched,")
    print("  and stays that way until you have proven the new one.")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
