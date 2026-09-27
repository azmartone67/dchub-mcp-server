"""web_bot_auth.py — sign DC Hub's own probe requests.

Copied from dchub-backend web_bot_auth.py (2026-09-26); install_urllib_signing()
is added here (2026-09-27) for this repo's scheduled probe scripts, the Python
twin of lib/web-bot-auth.mjs installFetchSigning(). Pinned to the same RFC 8032
test vector by test/web-bot-auth-python.test.mjs.

Web Bot Auth (HTTP Message Signatures, RFC 9421, Ed25519). A signed request
carries Signature-Agent / Signature-Input / Signature; Cloudflare verifies it
against the key directory the frontend worker serves at
https://dchub.cloud/.well-known/http-message-signatures-directory. That lets the
WAF trust our probes by signature instead of by a User-Agent anyone can copy.

The signature covers ("@authority" "signature-agent") — not the path — per the
Web Bot Auth architecture draft, so it is bound to the host and expires quickly.
Byte-for-byte the same scheme as dchub-frontend scripts/web-bot-auth.mjs.

Key: env WEB_BOT_AUTH_PRIVATE_JWK = {"kty":"OKP","crv":"Ed25519","x":..,"d":..}.
Unset, malformed, or `cryptography` missing -> probe_signature_headers() returns
{} and the probe goes out unsigned, exactly as before. Signing never blocks a probe.

    from web_bot_auth import probe_signature_headers
    headers = {**base_headers, **probe_signature_headers(url)}

Or, for a whole script: `import web_bot_auth; web_bot_auth.install_urllib_signing()`.
"""
from __future__ import annotations

import base64
import functools
import hashlib
import json
import os
import time
from urllib.parse import urlsplit

SIGNATURE_AGENT = "https://dchub.cloud"
DEFAULT_TTL = 300


def _b64url_decode(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def jwk_thumbprint(jwk: dict) -> str:
    """RFC 7638 / RFC 8037 thumbprint: crv, kty, x in order, no whitespace."""
    canon = '{"crv":"%s","kty":"%s","x":"%s"}' % (jwk["crv"], jwk["kty"], jwk["x"])
    return base64.urlsafe_b64encode(hashlib.sha256(canon.encode()).digest()).rstrip(b"=").decode()


def _load_jwk(jwk: dict | None) -> dict | None:
    if jwk is None:
        raw = os.environ.get("WEB_BOT_AUTH_PRIVATE_JWK") or ""
        if not raw:
            return None
        try:
            jwk = json.loads(raw)
        except ValueError:
            return None
    if not isinstance(jwk, dict):
        return None
    if jwk.get("kty") != "OKP" or jwk.get("crv") != "Ed25519" or not jwk.get("x") or not jwk.get("d"):
        return None
    return jwk


@functools.lru_cache(maxsize=4)
def _private_key(d: str):
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    return Ed25519PrivateKey.from_private_bytes(_b64url_decode(d))


def is_own_host(host: str | None) -> bool:
    """dchub.cloud and its subdomains: the only hosts a DC Hub signature is for."""
    h = (host or "").lower().rstrip(".")
    return h == "dchub.cloud" or h.endswith(".dchub.cloud")


def sign_if_own_host(url: str) -> dict:
    """probe_signature_headers(url) for our own hosts, {} for every other host.

    Used by http_ua_default's process-wide hooks, so a request to a third party
    never carries the headers."""
    try:
        if not is_own_host(urlsplit(url).hostname):
            return {}
    except ValueError:
        return {}
    return probe_signature_headers(url)


def probe_signature_headers(url: str, *, jwk: dict | None = None,
                            now: int | None = None, ttl: int = DEFAULT_TTL) -> dict:
    """Headers that sign a request to `url`; {} when no key is configured."""
    key_jwk = _load_jwk(jwk)
    if not key_jwk:
        return {}
    try:
        key = _private_key(key_jwk["d"])
    except Exception:
        return {}
    authority = (urlsplit(url).netloc or "").lower()
    if not authority:
        return {}
    created = int(time.time()) if now is None else int(now)
    expires = created + int(ttl)
    agent = '"%s"' % SIGNATURE_AGENT
    params = ('("@authority" "signature-agent");created=%d;keyid="%s";alg="ed25519";'
              'expires=%d;tag="web-bot-auth"' % (created, jwk_thumbprint(key_jwk), expires))
    base = '"@authority": %s\n"signature-agent": %s\n"@signature-params": %s' % (authority, agent, params)
    sig = base64.b64encode(key.sign(base.encode())).decode()
    return {
        "Signature-Agent": agent,
        "Signature-Input": "sig1=" + params,
        "Signature": "sig1=:%s:" % sig,
    }


_INSTALLED = "_dchub_web_bot_auth"


def install_urllib_signing() -> bool:
    """Wrap urllib.request.urlopen once so every request to our own hosts is signed.

    Other hosts are untouched, a request that already carries a Signature keeps
    it, and with no key it adds nothing. A signing error sends the request
    unsigned; it never fails a request. Returns False if already installed."""
    import urllib.request

    orig = urllib.request.urlopen
    if getattr(orig, _INSTALLED, False):
        return False

    def urlopen(url, *args, **kwargs):
        try:
            if isinstance(url, str):
                sig = sign_if_own_host(url)
                if sig:
                    url = urllib.request.Request(url, headers=sig)
            elif isinstance(url, urllib.request.Request) and not url.has_header("Signature"):
                for k, v in sign_if_own_host(url.full_url).items():
                    url.add_header(k, v)
        except Exception:  # a signature is never worth breaking a request
            pass
        return orig(url, *args, **kwargs)

    setattr(urlopen, _INSTALLED, True)
    urllib.request.urlopen = urlopen
    return True
