# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
"""mitmproxy addon: record every request of the evidence journey for assert-egress.py (PRJ-121 intent 02, A18).

Run:  mitmdump -s svayam_egress.py --set egress_out=flows.jsonl
SANDBOX ONLY (svayam-e2e). One JSON line per request: host, method, path, the request body (base64) when the host
is a Svayam host (everything that matters for "what reached Svayam"), only its size otherwise, and the status.
The capture CA must be trusted by the tools under test (NODE_EXTRA_CA_CERTS, git http.sslCAInfo, npm cafile).
"""
import base64
import json

SVAYAM_SUFFIX = ".svayamtech.com"


def is_svayam(host: str) -> bool:
    return host == "svayamtech.com" or host.endswith(SVAYAM_SUFFIX)


def record(host: str, method: str, path: str, body: bytes, status: int, headers: dict) -> dict:
    """One flow as a plain dict. Authorization / cookie VALUES are never kept: only that they were present."""
    svayam = is_svayam(host)
    return {
        "host": host,
        "method": method,
        "path": path,
        "svayam": svayam,
        "body_b64": base64.b64encode(body).decode() if svayam else "",
        "body_len": len(body),
        "status": status,
        "has_auth": any(k.lower() in ("authorization", "cookie") for k in headers),
    }


class Egress:
    def __init__(self):
        self.out = None

    def load(self, loader):
        loader.add_option("egress_out", str, "flows.jsonl", "where the flows are written")

    def response(self, flow):  # pragma: no cover - needs mitmproxy
        from mitmproxy import ctx
        if self.out is None:
            self.out = open(ctx.options.egress_out, "a", encoding="utf-8")
        r = record(flow.request.pretty_host, flow.request.method, flow.request.path,
                   flow.request.get_content() or b"", flow.response.status_code, dict(flow.request.headers))
        self.out.write(json.dumps(r) + "\n")
        self.out.flush()


addons = [Egress()]
