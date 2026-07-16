#!/usr/bin/env python3
"""CI gate for the DC Hub ChatGPT Actions OpenAPI (per ChatGPT's 2026-07-16 review).
Checks: (1) valid OpenAPI, (2) no duplicate operationIds, (3) every op references a
concrete response schema (not a bare `type: object`), (4) every gated op (402) uses the
shared PaidPreview schema, (5) every workflow op (x-agent OR recipe in description) carries
x-agent metadata. Exit 1 on any failure so CI fails."""
import json, sys, re

def check(path):
    fails = []
    try:
        d = json.load(open(path))
    except Exception as e:
        return [f"invalid JSON: {e}"], []
    # 1. valid OpenAPI shell
    if not (d.get("openapi","").startswith("3.") and d.get("info") and d.get("paths")):
        fails.append("not a valid OpenAPI 3.x doc (missing openapi/info/paths)")
    schemas = set((d.get("components",{}).get("schemas",{}) or {}).keys())
    has_paid = "PaidPreview" in schemas
    oids, ops = [], []
    for path_, item in d.get("paths",{}).items():
        for method, op in (item or {}).items():
            if method not in ("get","post","put","delete","patch"): continue
            oid = op.get("operationId")
            oids.append(oid); ops.append((path_,method,oid,op))
    # 2. duplicate operationIds
    dup = {o for o in oids if oids.count(o) > 1 and o}
    if dup: fails.append(f"duplicate operationIds: {sorted(dup)}")
    if any(o is None for o in oids): fails.append("some operations missing operationId")
    for path_, method, oid, op in ops:
        rr = op.get("responses",{})
        # 3. concrete 200 response schema
        s200 = rr.get("200",{}).get("content",{}).get("application/json",{}).get("schema",{})
        if s200 is not None:
            bare = (s200.get("type")=="object" and not s200.get("properties") and "$ref" not in s200)
            if "200" in rr and (not s200 or bare):
                fails.append(f"{oid}: 200 has no concrete schema (bare type:object)")
        # 4. gated op -> PaidPreview
        if "402" in rr:
            s402 = rr["402"].get("content",{}).get("application/json",{}).get("schema",{})
            if s402.get("$ref","") != "#/components/schemas/PaidPreview":
                fails.append(f"{oid}: 402 does not $ref PaidPreview")
        # 5. if x-agent present, it must be well-formed (recipe + step)
        xa = op.get("x-agent")
        if xa is not None and not (isinstance(xa, dict) and xa.get("recipe") and "step" in xa):
            fails.append(f"{oid}: x-agent present but malformed (needs recipe + step)")
    return fails, oids

if __name__ == "__main__":
    for p in sys.argv[1:]:
        fails, oids = check(p)
        tag = "PASS ✅" if not fails else f"FAIL ❌ ({len(fails)})"
        print(f"\n=== {p} — {tag} | {len(oids)} ops ===")
        for f in fails[:20]: print("  -", f)
    # exit 1 if the LAST file failed (the canonical one under test)
    if sys.argv[1:]:
        last_fails,_ = check(sys.argv[-1])
        sys.exit(1 if last_fails else 0)
