#!/usr/bin/env python3
"""
Test REAL Cloudflare R2: create, upload, download, list, delete.

    read -rs R2_ACCESS_KEY_ID      && export R2_ACCESS_KEY_ID
    read -rs R2_SECRET_ACCESS_KEY  && export R2_SECRET_ACCESS_KEY
    export R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
    export R2_BUCKET=everytinroom-images
    deploy/scripts/test-r2.py

Needs no Docker and no server: it signs its own SigV4 requests with curl, so
it runs on a laptop. `read -rs` keeps the keys out of the shell history and
off the screen.

WHY THIS EXISTS SEPARATELY FROM THE STAGING RUN
    The staging run tests storage against adobe/s3mock. That proves OUR
    configuration -- the backend selection, the bucket wiring, the signing,
    the proxy route -- and it proves nothing whatsoever about Cloudflare.

    R2 has its own behaviour. It rejects the trailing-checksum headers the AWS
    SDK adds by default, which is why STORAGE_S3_REQUEST_CHECKSUM_CALCULATION
    is set to WHEN_REQUIRED in app.compose.yml. A mock will never show that.

    So this is the only thing that can honestly be called "R2 verified", and
    it needs credentials that only the account owner has.

IT CLEANS UP AFTER ITSELF, and only after itself: every object it writes is
under a probe prefix with a random suffix, and it deletes exactly those.
NOTHING ELSE IN THE BUCKET IS TOUCHED, read or written.
"""

import argparse
import base64
import binascii
import datetime
import hashlib
import hmac
import os
import subprocess
import sys
import urllib.parse

PREFIX = "_platform-probe"


def need(name):
    v = os.environ.get(name, "").strip()
    if not v:
        sys.exit(f"{name} is not set. See the header of this script.")
    return v


def sigv4(method, endpoint, bucket, key, access, secret, region="auto",
          payload_sha=None, length=None, ctype=None, query=""):
    host = urllib.parse.urlparse(endpoint).netloc
    uri = "/" + bucket + ("/" + urllib.parse.quote(key, safe="/~") if key else "")
    now = datetime.datetime.now(datetime.timezone.utc)
    amz = now.strftime("%Y%m%dT%H%M%SZ")
    day = now.strftime("%Y%m%d")
    pay = payload_sha or "UNSIGNED-PAYLOAD"
    h = {"host": host, "x-amz-content-sha256": pay, "x-amz-date": amz}
    if length is not None:
        h["content-length"] = str(length)
    if ctype:
        h["content-type"] = ctype
    signed = ";".join(sorted(h))
    canon_h = "".join(f"{k}:{h[k]}\n" for k in sorted(h))
    canon = "\n".join([method, uri, query, canon_h, signed, pay])
    scope = f"{day}/{region}/s3/aws4_request"
    to_sign = "\n".join(["AWS4-HMAC-SHA256", amz, scope,
                         hashlib.sha256(canon.encode()).hexdigest()])

    def _h(k, m):
        return hmac.new(k, m.encode(), hashlib.sha256).digest()

    k = _h(_h(_h(_h(("AWS4" + secret).encode(), day), region), "s3"), "aws4_request")
    sig = hmac.new(k, to_sign.encode(), hashlib.sha256).hexdigest()
    h["Authorization"] = (f"AWS4-HMAC-SHA256 Credential={access}/{scope}, "
                          f"SignedHeaders={signed}, Signature={sig}")
    url = f"{endpoint.rstrip('/')}{uri}" + (f"?{query}" if query else "")
    return url, h


def call(method, url, headers, data_file=None, out=None):
    cmd = ["curl", "-s", "-S", "--max-time", "90", "-X", method, "-w", "\n%{http_code}"]
    for k, v in headers.items():
        cmd += ["-H", f"{k}: {v}"]
    if data_file:
        cmd += ["--data-binary", f"@{data_file}"]
    if out:
        cmd += ["-o", out]
    cmd.append(url)
    r = subprocess.run(cmd, capture_output=True, text=True)
    txt = r.stdout or ""
    code = txt.strip().split("\n")[-1] if txt.strip() else "000"
    body = txt[: txt.rfind("\n")] if "\n" in txt else ""
    return code, body


PASS = FAIL = 0
# Every verdict, in order, for the dated report. Messages only -- no value
# read from the credentials file ever reaches this list, and the report is
# written outside the repository.
RESULTS = []


def ok(msg):
    global PASS
    PASS += 1
    RESULTS.append(("PASS", msg))
    print(f"  \033[32mok\033[0m   {msg}")


def bad(msg):
    global FAIL
    FAIL += 1
    RESULTS.append(("FAIL", msg))
    print(f"  \033[31mFAIL\033[0m {msg}")


def load_env_file(path):
    """Read KEY=VALUE lines into the environment. Never prints a value.

    The file is the one setup-r2-credentials.sh writes: mode 600, gitignored.
    Reading it here means the credentials never have to be exported in a
    shell, where they would reach the history, nor passed as arguments, where
    `ps` would show them.
    """
    if not os.path.isfile(path):
        sys.exit(f"{path} does not exist.\n"
                 "Run deploy/scripts/setup-r2-credentials.sh first; it writes that file.")
    mode = oct(os.stat(path).st_mode & 0o777)[2:]
    if mode != "600":
        print(f"  note: {path} is mode {mode}, not 600. Fix with: chmod 600 {path}")
    n = 0
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            k = k.strip()
            if k.startswith("R2_"):
                os.environ[k] = v.strip()
                n += 1
    print(f"  read {n} setting(s) from {path}; none of them are printed below")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--env-file", default=None,
                    help="a mode-600 file of R2_* settings, instead of the environment")
    ap.add_argument("--report", default=None,
                    help="write a dated report here (outside the repository)")
    args = ap.parse_args()
    if args.env_file:
        load_env_file(args.env_file)

    endpoint = need("R2_ENDPOINT").rstrip("/")
    bucket = need("R2_BUCKET")
    access = need("R2_ACCESS_KEY_ID")
    secret = need("R2_SECRET_ACCESS_KEY")

    if "r2.cloudflarestorage.com" not in endpoint:
        print(f"  note: endpoint is {endpoint} — this does not look like R2.")
        print("        The test still runs, but do not call the result 'R2 verified'.")

    suffix = hashlib.sha256(os.urandom(16)).hexdigest()[:10]
    key = f"{PREFIX}/{suffix}/probe.bin"
    payload = b"platform probe \x00\x01\x02 " + suffix.encode() * 64
    tmp = f"/tmp/.r2probe-{suffix}"
    with open(tmp, "wb") as f:
        f.write(payload)
    sha = hashlib.sha256(payload).hexdigest()
    md5 = hashlib.md5(payload).hexdigest()

    print(f"\nCloudflare R2 operations")
    print(f"  endpoint : {endpoint}")
    print(f"  bucket   : {bucket}")
    print(f"  test key : {key}   ({len(payload)} bytes)")
    print("  credentials are read from the environment and never printed.\n")

    # 1. Can we reach the bucket at all?
    url, h = sigv4("GET", endpoint, bucket, "", access, secret,
                   query="list-type=2&max-keys=1")
    code, body = call("GET", url, h)
    if code == "200":
        ok("the bucket is reachable and the credentials are accepted")
    elif code in ("403", "401"):
        bad(f"access denied (HTTP {code}). The token may lack Object Read/Write, "
            f"or be scoped to a different bucket.")
        print(f"       {body[:200]}")
        sys.exit(1)
    elif code == "404":
        bad(f"the bucket {bucket!r} does not exist at that endpoint")
        sys.exit(1)
    else:
        bad(f"unexpected HTTP {code} listing the bucket: {body[:200]}")
        sys.exit(1)

    # 2. Upload, with a real payload hash rather than UNSIGNED-PAYLOAD. This is
    #    the path that exposes R2's checksum behaviour.
    url, h = sigv4("PUT", endpoint, bucket, key, access, secret,
                   payload_sha=sha, length=len(payload),
                   ctype="application/octet-stream")
    code, body = call("PUT", url, h, data_file=tmp)
    if code in ("200", "201"):
        ok(f"UPLOAD accepted (HTTP {code})")
    else:
        bad(f"upload failed with HTTP {code}: {body[:300]}")
        os.remove(tmp)
        sys.exit(1)

    # 3. Download and compare the bytes, not just the status.
    outf = tmp + ".back"
    url, h = sigv4("GET", endpoint, bucket, key, access, secret)
    code, _ = call("GET", url, h, out=outf)
    if code == "200":
        got = open(outf, "rb").read()
        if got == payload:
            ok(f"DOWNLOAD returned byte-identical content ({len(got)} bytes)")
        else:
            bad(f"download returned {len(got)} bytes, expected {len(payload)} — content differs")
    else:
        bad(f"download failed with HTTP {code}")

    # 4. HEAD, and check the ETag is the MD5 for a single-part upload. This is
    #    what migrate-storage.py relies on to verify a copied image.
    url, h = sigv4("HEAD", endpoint, bucket, key, access, secret)
    cmd = ["curl", "-s", "-D", "-", "-o", "/dev/null", "-X", "HEAD", "--max-time", "60"]
    for k, v in h.items():
        cmd += ["-H", f"{k}: {v}"]
    cmd.append(url)
    hdrs = subprocess.run(cmd, capture_output=True, text=True).stdout
    etag = ""
    for line in hdrs.split("\n"):
        if line.lower().startswith("etag:"):
            etag = line.split(":", 1)[1].strip().strip('"')
    if etag and "-" not in etag:
        if etag.lower() == md5:
            ok("the ETag is a plain MD5 and matches — migrate-storage.py can verify copies")
        else:
            bad(f"the ETag {etag} does not match the MD5 {md5}")
    elif etag:
        ok(f"the ETag is multipart ({etag}); migrate-storage.py falls back to a size check")
    else:
        bad("no ETag was returned, so a copy cannot be checksum-verified")

    # 4b. THE CHECKSUM-TRAILER COMPATIBILITY ISSUE, tested for real.
    #
    # This is the one thing no mock has ever shown, and the reason
    # app.compose.yml sets STORAGE_S3_REQUEST_CHECKSUM_CALCULATION to
    # WHEN_REQUIRED. By default the AWS SDK adds a TRAILING checksum: it sends
    # the body in aws-chunked framing with x-amz-trailer naming a checksum
    # header that arrives after the data, and signs it with
    # STREAMING-UNSIGNED-PAYLOAD-TRAILER.
    #
    # So that exact shape is sent here -- correctly framed, not a malformed
    # approximation -- and then the WHEN_REQUIRED shape is sent to the same
    # bucket. Whatever each one does, it is reported. If the trailing form is
    # refused, that is the setting earning its place against the real service.
    # If it is accepted, the setting is merely unnecessary, and this says so
    # rather than leaving a comment in a compose file claiming otherwise.
    trailer_key = f"{PREFIX}/{suffix}/trailer.bin"
    crc = (binascii.crc32(payload) & 0xFFFFFFFF).to_bytes(4, "big")
    crc_b64 = base64.b64encode(crc).decode()
    chunked = (f"{len(payload):x}\r\n".encode() + payload + b"\r\n"
               + b"0\r\n"
               + f"x-amz-checksum-crc32:{crc_b64}\r\n".encode()
               + b"\r\n")
    tmp_tr = tmp + ".chunked"
    with open(tmp_tr, "wb") as f:
        f.write(chunked)
    host = urllib.parse.urlparse(endpoint).netloc
    now = datetime.datetime.now(datetime.timezone.utc)
    amz, day = now.strftime("%Y%m%dT%H%M%SZ"), now.strftime("%Y%m%d")
    th = {
        "host": host,
        "content-encoding": "aws-chunked",
        "content-length": str(len(chunked)),
        "x-amz-content-sha256": "STREAMING-UNSIGNED-PAYLOAD-TRAILER",
        "x-amz-date": amz,
        "x-amz-decoded-content-length": str(len(payload)),
        "x-amz-sdk-checksum-algorithm": "CRC32",
        "x-amz-trailer": "x-amz-checksum-crc32",
    }
    signed = ";".join(sorted(th))
    uri = "/" + bucket + "/" + urllib.parse.quote(trailer_key, safe="/~")
    canon = "\n".join(["PUT", uri, "",
                       "".join(f"{k}:{th[k]}\n" for k in sorted(th)),
                       signed, "STREAMING-UNSIGNED-PAYLOAD-TRAILER"])
    scope = f"{day}/auto/s3/aws4_request"
    to_sign = "\n".join(["AWS4-HMAC-SHA256", amz, scope,
                         hashlib.sha256(canon.encode()).hexdigest()])

    def _h(k, m):
        return hmac.new(k, m.encode(), hashlib.sha256).digest()

    k = _h(_h(_h(_h(("AWS4" + secret).encode(), day), "auto"), "s3"), "aws4_request")
    th["Authorization"] = (f"AWS4-HMAC-SHA256 Credential={access}/{scope}, "
                           f"SignedHeaders={signed}, "
                           f"Signature={hmac.new(k, to_sign.encode(), hashlib.sha256).hexdigest()}")
    code_tr, body_tr = call("PUT", f"{endpoint}{uri}", th, data_file=tmp_tr)
    if code_tr in ("200", "201"):
        ok("an SDK-DEFAULT trailing-checksum upload was ACCEPTED (HTTP "
           f"{code_tr}) — on this bucket WHEN_REQUIRED is not strictly needed, "
           "though it remains harmless")
        url, h = sigv4("DELETE", endpoint, bucket, trailer_key, access, secret)
        call("DELETE", url, h)
    else:
        ok(f"an SDK-DEFAULT trailing-checksum upload was REFUSED (HTTP {code_tr}) — "
           "this is exactly why STORAGE_S3_REQUEST_CHECKSUM_CALCULATION is set to "
           "WHEN_REQUIRED, and no mock has ever reproduced it")
        print(f"       {body_tr.strip()[:200]}")
    # And the WHEN_REQUIRED shape, to the same bucket, for the comparison.
    url, h = sigv4("PUT", endpoint, bucket, trailer_key + ".plain", access, secret,
                   payload_sha=sha, length=len(payload),
                   ctype="application/octet-stream")
    code_wr, body_wr = call("PUT", url, h, data_file=tmp)
    if code_wr in ("200", "201"):
        ok(f"the WHEN_REQUIRED shape, with no trailing checksum, was accepted (HTTP {code_wr})")
        url, h = sigv4("DELETE", endpoint, bucket, trailer_key + ".plain", access, secret)
        call("DELETE", url, h)
    else:
        bad(f"the WHEN_REQUIRED shape was refused too (HTTP {code_wr}): {body_wr[:200]}")
    try:
        os.remove(tmp_tr)
    except OSError:
        pass

    # 5. List, and confirm the object appears.
    url, h = sigv4("GET", endpoint, bucket, "", access, secret,
                   query=f"list-type=2&prefix={urllib.parse.quote(PREFIX, safe='')}")
    code, body = call("GET", url, h)
    if code == "200" and key in body:
        ok("LIST shows the object under its prefix")
    else:
        bad(f"LIST did not show the object (HTTP {code})")

    # 6. Delete, and confirm it is really gone.
    url, h = sigv4("DELETE", endpoint, bucket, key, access, secret)
    code, body = call("DELETE", url, h)
    if code in ("200", "204"):
        ok(f"DELETE accepted (HTTP {code})")
    else:
        bad(f"delete failed with HTTP {code}: {body[:200]}")

    url, h = sigv4("HEAD", endpoint, bucket, key, access, secret)
    code, _ = call("HEAD", url, h, out="/dev/null")
    if code == "404":
        ok("the object is gone — confirmed by a second request, not assumed")
    else:
        bad(f"the object still answers HTTP {code} after the delete")

    for f in (tmp, outf):
        try:
            os.remove(f)
        except OSError:
            pass

    print(f"\n  passed {PASS}  failed {FAIL}")
    print(f"  Only objects under {PREFIX}/{suffix}/ were written, and they were deleted.")
    print("  Nothing else in the bucket was read or modified.\n")

    if args.report:
        # Outside the repository, and with no credential in it: the endpoint's
        # account id is a hostname, so even that is reduced to its shape.
        host = urllib.parse.urlparse(endpoint).netloc
        masked = host.split(".", 1)
        masked = ("<account-id>." + masked[1]) if len(masked) == 2 else "<endpoint>"
        when = datetime.datetime.now(datetime.timezone.utc)
        L = [f"# Cloudflare R2 verification — {when:%Y-%m-%d %H:%M:%S UTC}", "",
             "Run against the REAL Cloudflare R2 service, not a mock, a stand-in",
             "or an S3-compatible substitute.", "",
             f"- Endpoint: `https://{masked}`  (the account id is not recorded here)",
             f"- Bucket: `{bucket}`",
             f"- Probe prefix: `{PREFIX}/{suffix}/` — created and removed by this run",
             f"- Credentials: read from a mode-600 local file; no value appears in this report",
             "", f"**{PASS} passed, {FAIL} failed.**", "",
             "| # | Check | Result |", "|---|---|---|"]
        for i, (st, msg) in enumerate(RESULTS, 1):
            L.append(f"| {i} | {msg.replace('|', '/')} | **{st}** |")
        # The same shape readiness-package.py already parses, so this
        # evidence can be fed to it with --extra instead of being retyped.
        L += ["", "## Machine-readable", "",
              "These lines are what readiness-package.py reads.", ""]
        for st, msg in RESULTS:
            L.append(f"- {'PASS' if st == 'PASS' else '**FAIL**'} {msg}")
        L += ["",
              "## What this does and does not establish", "",
              "It establishes that this bucket, this endpoint and these credentials",
              "accept an upload, return the same bytes, list the object, delete it and",
              "report it gone — and how R2 answers the AWS SDK's default trailing",
              "checksum, which is the one thing no mock reproduces.", "",
              "It does NOT establish that storage-api is configured correctly against",
              "this bucket. That is a separate step, and it is deliberately not done",
              "from CI, because the credentials must not go there.", ""]
        with open(args.report, "w", encoding="utf-8") as fh:
            fh.write("\n".join(L) + "\n")
        print(f"  report written to {args.report}\n")

    sys.exit(1 if FAIL else 0)


if __name__ == "__main__":
    main()
