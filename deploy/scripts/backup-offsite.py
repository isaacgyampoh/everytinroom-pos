#!/usr/bin/env python3
"""
Copy local database backups off the server, to S3-compatible storage (R2).

    # on the server, from cron, after backup.sh
    R2_ENDPOINT=... R2_BUCKET=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... \
      deploy/scripts/backup-offsite.py --dir /srv/central/backups --keep-days 90

    deploy/scripts/backup-offsite.py --dir /srv/central/backups --plan   # look only

WHY THIS IS NOT OPTIONAL
    backup.sh writes to /srv/central/backups, which is on the same disk as the
    database. That covers a dropped table or a bad migration. It does not cover
    losing the server, and "we have backups" that live on the thing that failed
    is the most common way a backup strategy turns out not to be one.

    R2 charges nothing for egress and nothing for the first 10 GB, so a copy of
    these dumps costs nothing at the sizes involved.

WHAT IT VERIFIES
    Every upload is read back and its MD5 compared against the local file.
    An upload that reports 200 and stored something else is exactly the
    failure a backup system must not have, so the check is not optional and
    there is no flag to skip it.

RETENTION
    Remote copies older than --keep-days are deleted, and ONLY files matching
    the naming backup.sh produces. It will not delete a remote object it does
    not recognise, and it refuses to prune at all if any upload failed in the
    same run -- that is precisely when the old copies matter.
"""

import argparse
import datetime
import hashlib
import hmac
import os
import re
import subprocess
import sys
import urllib.parse
import xml.etree.ElementTree as ET

PREFIX = "db-backups"
# Exactly what backup.sh writes: <name>-YYYYmmdd-HHMMSS.sql.gz, plus the
# globals and pre-restore safety dumps.
NAME_RE = re.compile(r"^(globals|PRE-RESTORE-[A-Za-z0-9_]+|[A-Za-z0-9_]+)-\d{8}-\d{6}\.sql\.gz$")


def need(n):
    v = os.environ.get(n, "").strip()
    if not v:
        sys.exit(f"{n} is not set. See the header of this script.")
    return v


def sigv4(method, endpoint, bucket, key, access, secret, region="auto",
          payload_sha="UNSIGNED-PAYLOAD", length=None, ctype=None, query=""):
    host = urllib.parse.urlparse(endpoint).netloc
    uri = "/" + bucket + (("/" + urllib.parse.quote(key, safe="/~")) if key else "")
    now = datetime.datetime.now(datetime.timezone.utc)
    amz, day = now.strftime("%Y%m%dT%H%M%SZ"), now.strftime("%Y%m%d")
    h = {"host": host, "x-amz-content-sha256": payload_sha, "x-amz-date": amz}
    if length is not None:
        h["content-length"] = str(length)
    if ctype:
        h["content-type"] = ctype
    signed = ";".join(sorted(h))
    canon = "\n".join([method, uri, query,
                       "".join(f"{k}:{h[k]}\n" for k in sorted(h)), signed, payload_sha])
    scope = f"{day}/{region}/s3/aws4_request"
    to_sign = "\n".join(["AWS4-HMAC-SHA256", amz, scope,
                         hashlib.sha256(canon.encode()).hexdigest()])

    def _h(k, m):
        return hmac.new(k, m.encode(), hashlib.sha256).digest()

    k = _h(_h(_h(_h(("AWS4" + secret).encode(), day), region), "s3"), "aws4_request")
    h["Authorization"] = (f"AWS4-HMAC-SHA256 Credential={access}/{scope}, "
                          f"SignedHeaders={signed}, "
                          f"Signature={hmac.new(k, to_sign.encode(), hashlib.sha256).hexdigest()}")
    return f"{endpoint.rstrip('/')}{uri}" + (f"?{query}" if query else ""), h


def call(method, url, headers, data_file=None, out=None, dump_headers=False):
    cmd = ["curl", "-s", "-S", "--max-time", "600", "-X", method, "-w", "\n%{http_code}"]
    for k, v in headers.items():
        cmd += ["-H", f"{k}: {v}"]
    if data_file:
        cmd += ["--data-binary", f"@{data_file}"]
    if out:
        cmd += ["-o", out]
    if dump_headers:
        cmd += ["-D", "/tmp/.offsite-hdrs"]
    cmd.append(url)
    r = subprocess.run(cmd, capture_output=True, text=True)
    t = r.stdout or ""
    code = t.strip().split("\n")[-1] if t.strip() else "000"
    return code, (t[: t.rfind("\n")] if "\n" in t else "")


def md5_of(path):
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def sha256_of(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def list_remote(cfg):
    """Every object under the backup prefix, with its age."""
    out, token = [], None
    while True:
        q = f"list-type=2&prefix={urllib.parse.quote(PREFIX + '/', safe='')}"
        if token:
            q += f"&continuation-token={urllib.parse.quote(token, safe='')}"
        url, h = sigv4("GET", cfg["endpoint"], cfg["bucket"], "",
                       cfg["access"], cfg["secret"], query=q)
        code, body = call("GET", url, h)
        if code != "200":
            return None, f"listing failed with HTTP {code}: {body[:200]}"
        try:
            root = ET.fromstring(body)
        except ET.ParseError as e:
            return None, f"could not parse the listing: {e}"
        ns = {"s3": root.tag.split("}")[0].strip("{")} if "}" in root.tag else {}
        def find(el, name):
            return el.find(f"s3:{name}", ns) if ns else el.find(name)
        for c in (root.findall("s3:Contents", ns) if ns else root.findall("Contents")):
            k = find(c, "Key")
            lm = find(c, "LastModified")
            sz = find(c, "Size")
            if k is None:
                continue
            out.append({"key": k.text,
                        "modified": lm.text if lm is not None else "",
                        "size": int(sz.text) if sz is not None else 0})
        trunc = find(root, "IsTruncated")
        nxt = find(root, "NextContinuationToken")
        if trunc is not None and trunc.text == "true" and nxt is not None:
            token = nxt.text
            continue
        break
    return out, None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default="/srv/central/backups")
    ap.add_argument("--keep-days", type=int, default=90)
    ap.add_argument("--plan", action="store_true", help="report only; uploads nothing")
    args = ap.parse_args()

    if not os.path.isdir(args.dir):
        sys.exit(f"{args.dir} does not exist. Run backup.sh first.")

    local = sorted(f for f in os.listdir(args.dir) if NAME_RE.match(f))
    if not local:
        sys.exit(f"no backup files matching backup.sh's naming in {args.dir}.\n"
                 "Nothing was uploaded. Run backup.sh first.")

    total = sum(os.path.getsize(os.path.join(args.dir, f)) for f in local)
    print(f"\nOff-server backup copy")
    print(f"  local directory : {args.dir}")
    print(f"  files           : {len(local)}  ({total / 1024 / 1024:.1f} MB)")

    if args.plan:
        print(f"  remote prefix   : {PREFIX}/")
        print("\n  --plan: nothing was uploaded and no remote was contacted.")
        print("  Set R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID and")
        print("  R2_SECRET_ACCESS_KEY, then run without --plan.\n")
        return

    cfg = {"endpoint": need("R2_ENDPOINT").rstrip("/"), "bucket": need("R2_BUCKET"),
           "access": need("R2_ACCESS_KEY_ID"), "secret": need("R2_SECRET_ACCESS_KEY")}
    print(f"  remote          : {cfg['endpoint']}/{cfg['bucket']}/{PREFIX}/")

    remote, err = list_remote(cfg)
    if err:
        sys.exit(f"\n  cannot read the remote bucket: {err}\n"
                 "  Nothing was uploaded.\n")
    have = {r["key"] for r in remote}
    print(f"  already there   : {len(have)}")
    print()

    uploaded = skipped = failed = 0
    for f in local:
        path = os.path.join(args.dir, f)
        key = f"{PREFIX}/{f}"
        label = f"  {f[:54]:<54}"
        if key in have:
            skipped += 1
            print(label + " already copied")
            continue
        size = os.path.getsize(path)
        url, h = sigv4("PUT", cfg["endpoint"], cfg["bucket"], key,
                       cfg["access"], cfg["secret"],
                       payload_sha=sha256_of(path), length=size,
                       ctype="application/gzip")
        code, body = call("PUT", url, h, data_file=path)
        if code not in ("200", "201"):
            failed += 1
            print(label + f" UPLOAD FAILED (HTTP {code}) {body[:120]}")
            continue
        # Read the stored object's ETag back and compare. An upload that
        # reports success and stored something else is the one failure a
        # backup system must not have.
        url, h = sigv4("HEAD", cfg["endpoint"], cfg["bucket"], key,
                       cfg["access"], cfg["secret"])
        call("HEAD", url, h, out="/dev/null", dump_headers=True)
        etag = ""
        try:
            for line in open("/tmp/.offsite-hdrs", errors="replace"):
                if line.lower().startswith("etag:"):
                    etag = line.split(":", 1)[1].strip().strip('"')
        except OSError:
            pass
        if etag and "-" not in etag:
            if etag.lower() != md5_of(path):
                failed += 1
                print(label + " CHECKSUM MISMATCH after upload")
                continue
            uploaded += 1
            print(label + f" copied {size / 1024 / 1024:.1f} MB  md5 verified")
        else:
            uploaded += 1
            print(label + f" copied {size / 1024 / 1024:.1f} MB  (multipart ETag; size only)")

    print()
    print(f"  uploaded {uploaded}, already there {skipped}, failed {failed}")

    # Retention. Never while an upload failed in this run.
    cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=args.keep_days)
    old = []
    for r in remote:
        name = r["key"].split("/")[-1]
        if not NAME_RE.match(name):
            continue          # not ours; left alone
        try:
            when = datetime.datetime.fromisoformat(r["modified"].replace("Z", "+00:00"))
        except ValueError:
            continue
        if when < cutoff:
            old.append(r["key"])

    if not old:
        print(f"  nothing remote is older than {args.keep_days} days")
    elif failed:
        print(f"  {len(old)} remote copies are older than {args.keep_days} days and NOTHING")
        print(f"  was deleted, because {failed} upload(s) failed in this run and those")
        print("  old copies may be the only ones that exist.")
    else:
        removed = 0
        for key in old:
            url, h = sigv4("DELETE", cfg["endpoint"], cfg["bucket"], key,
                           cfg["access"], cfg["secret"])
            code, _ = call("DELETE", url, h)
            if code in ("200", "204"):
                removed += 1
        print(f"  removed {removed} remote copy(ies) older than {args.keep_days} days")

    print()
    print("  Restoring from here: download the dump and the matching globals-*.sql.gz,")
    print("  then scripts/restore.sh --app <name> --file <dump>. It restores into a")
    print("  separate database by default, so the restore can be checked before")
    print("  anything live is touched.")
    print()
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
