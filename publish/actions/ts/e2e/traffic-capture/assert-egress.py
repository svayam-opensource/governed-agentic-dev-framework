#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
"""Assert what reached Svayam (PRJ-121 intent 02, A18; I02.3 — evidence never leaves the customer).

    assert-egress.py --flows flows.jsonl --canaries canaries.txt --schema lease-request.schema.json
                     [--allow-host HOST ...] [--expect-no-svayam]

Fails (exit 1, one line per problem) unless EVERY recorded request:
  1. goes to a host that is Svayam, GitHub, npmjs or an --allow-host (the configured judge provider);
  2. if Svayam-bound, is one of: a portal/auth page or API load (portal.*, auth.*), POST /api/v1/leases,
     POST /api/v1/leases/oidc, /api/v1/keys*, POST /api/v1/registry-token, or a GET of npm.svayamtech.com;
  3. if a lease body: validates STRICTLY against lease-request.schema.json (no extra field);
  4. carries none of the canaries (rule ids, shas, segment/chain hashes, repo and file names, a planted string and
     a planted rule message) anywhere in a Svayam-bound request line, header-free body or path. The ONE ruled
     exception (Q3) is the OIDC token inside a lease body: GitHub's own token names repo, actor, ref and sha, and
     the service minimises it. That single value is removed before the scan; nothing else is.
With --expect-no-svayam (an unsubscribed org): ANY Svayam-bound request fails the run.
"""
import argparse
import base64
import json
import re
import sys

SVAYAM = re.compile(r"(^|\.)svayamtech\.com$")
OPEN_HOSTS = (
    re.compile(r"^(www\.)?github\.com$"), re.compile(r"(^|\.)githubusercontent\.com$"),
    re.compile(r"^api\.github\.com$"), re.compile(r"^codeload\.github\.com$"),
    re.compile(r"^registry\.npmjs\.org$"), re.compile(r"(^|\.)actions\.githubusercontent\.com$"),
    re.compile(r"^(www\.)?npmjs\.(com|org)$"), re.compile(r"^objects\.githubusercontent\.com$"),
)
GOV_HOST = re.compile(r"^gov(-dev|-uat)?\.svayamtech\.com$")
PORTAL_HOST = re.compile(r"^(portal|auth)(-dev|-uat)?\.svayamtech\.com$")
NPM_HOST = re.compile(r"^npm\.svayamtech\.com$")
GOV_PATHS = [
    ("POST", re.compile(r"^/api/v1/leases(\?.*)?$")),
    ("POST", re.compile(r"^/api/v1/leases/oidc(\?.*)?$")),
    ("POST", re.compile(r"^/api/v1/registry-token(\?.*)?$")),
    ("GET", re.compile(r"^/api/v1/keys(/.*)?(\?.*)?$")),
    ("POST", re.compile(r"^/api/v1/keys/personal(\?.*)?$")),
    ("GET", re.compile(r"^/api/v1/keys/personal(\?.*)?$")),
    ("DELETE", re.compile(r"^/api/v1/keys/personal/[^/]+$")),
]


def check_schema(schema, root, v, at, errs):
    """The subset of JSON Schema the seam's own schemas use; an unknown keyword is an error, never ignored."""
    known = {"$schema", "$id", "$defs", "$ref", "title", "description", "format", "type", "properties", "required",
             "additionalProperties", "enum", "const", "pattern", "minimum", "minLength", "maxLength", "items", "oneOf"}
    for k in schema:
        if k not in known:
            errs.append(f"{at}: unsupported schema keyword {k}")
            return
    if "$ref" in schema:
        name = schema["$ref"].rsplit("/", 1)[-1]
        check_schema(root["$defs"][name], root, v, at, errs)
    if "oneOf" in schema:
        ok = 0
        for sub in schema["oneOf"]:
            e = []
            check_schema(sub, root, v, at, e)
            ok += not e
        if ok != 1:
            errs.append(f"{at}: must match exactly one allowed shape (matched {ok})")
    if "const" in schema and v != schema["const"]:
        errs.append(f"{at}: must be {schema['const']!r}")
    if "enum" in schema and v not in schema["enum"]:
        errs.append(f"{at}: not an allowed value")
    t = schema.get("type")
    if t:
        py = {"object": dict, "array": list, "string": str, "integer": int, "number": (int, float), "boolean": bool}[t]
        if isinstance(v, bool) and t in ("integer", "number") or not isinstance(v, py):
            errs.append(f"{at}: must be {t}")
            return
    if isinstance(v, str):
        if "pattern" in schema and not re.search(schema["pattern"], v):
            errs.append(f"{at}: does not match {schema['pattern']}")
        if "maxLength" in schema and len(v) > schema["maxLength"]:
            errs.append(f"{at}: too long")
        if "minLength" in schema and len(v) < schema["minLength"]:
            errs.append(f"{at}: too short")
    if isinstance(v, (int, float)) and not isinstance(v, bool) and "minimum" in schema and v < schema["minimum"]:
        errs.append(f"{at}: below {schema['minimum']}")
    if isinstance(v, dict):
        props = schema.get("properties", {})
        for r in schema.get("required", []):
            if r not in v:
                errs.append(f"{at}: missing {r}")
        for k, x in v.items():
            if k in props:
                check_schema(props[k], root, x, f"{at}.{k}", errs)
            elif schema.get("additionalProperties") is False:
                errs.append(f"{at}: field {k!r} is not allowed")


def audit(flows, canaries, schema, allow_hosts=(), expect_no_svayam=False):
    problems = []
    extra = [re.compile("^" + re.escape(h) + "$") for h in allow_hosts]
    for i, f in enumerate(flows, 1):
        host, method, path = f["host"], f["method"], f["path"]
        where = f"flow {i} {method} {host}{path}"
        svayam = bool(SVAYAM.search(host))
        if not svayam and not any(p.search(host) for p in (*OPEN_HOSTS, *extra)):
            problems.append(f"{where}: host is not Svayam, GitHub, npmjs or an allowed provider")
            continue
        if not svayam:
            continue
        if expect_no_svayam:
            problems.append(f"{where}: an unsubscribed org must make no Svayam-bound request")
            continue
        body = base64.b64decode(f.get("body_b64", "")) if f.get("body_b64") else b""
        if PORTAL_HOST.search(host):
            pass  # portal browser traffic: pages, assets, its API and sign-in
        elif NPM_HOST.search(host):
            if method != "GET":
                problems.append(f"{where}: the registry may only be read (GET)")
        elif GOV_HOST.search(host):
            if not any(m == method and p.search(path) for m, p in GOV_PATHS):
                problems.append(f"{where}: not an allowed licence-service request")
        else:
            problems.append(f"{where}: unknown Svayam host")
            continue
        scan = body
        if GOV_HOST.search(host) and re.match(r"^/api/v1/leases(/oidc)?(\?.*)?$", path):
            try:
                doc = json.loads(body)
            except ValueError:
                problems.append(f"{where}: the lease body is not JSON")
                continue
            errs = []
            check_schema(schema, schema, doc, "$", errs)
            problems.extend(f"{where}: lease body {e}" for e in errs)
            if isinstance(doc, dict):
                doc.pop("oidcToken", None)   # the Q3 exception: GitHub's token, minimised server-side
                doc.pop("personalKey", None)  # a credential, not evidence
                scan = json.dumps(doc).encode()
        haystack = scan + b"\n" + path.encode()
        for c in canaries:
            if c and c.encode() in haystack:
                problems.append(f"{where}: LEAK — canary {c[:12]!r}… found in a Svayam-bound request")
    return problems


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--flows", required=True)
    ap.add_argument("--canaries", required=True)
    ap.add_argument("--schema", required=True)
    ap.add_argument("--allow-host", action="append", default=[])
    ap.add_argument("--expect-no-svayam", action="store_true")
    a = ap.parse_args(argv)
    flows = [json.loads(l) for l in open(a.flows, encoding="utf-8") if l.strip()]
    canaries = [l.strip() for l in open(a.canaries, encoding="utf-8") if l.strip()]
    schema = json.load(open(a.schema, encoding="utf-8"))
    problems = audit(flows, canaries, schema, a.allow_host, a.expect_no_svayam)
    svayam = sum(1 for f in flows if SVAYAM.search(f["host"]))
    print(json.dumps({"flows": len(flows), "svayam_bound": svayam, "problems": len(problems)}))
    for p in problems:
        print(f"FAIL {p}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
