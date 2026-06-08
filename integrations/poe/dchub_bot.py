"""
DC Hub Poe bot — a server bot that answers data-center / power / grid questions
with LIVE DC Hub data + a citation, so every Poe user can chat with DC Hub.

Deploy (Modal is easiest, or any host):
    pip install fastapi-poe requests
    # get an access key + bot name at https://poe.com/create_bot (Server bot)
    POE_ACCESS_KEY=... python dchub_bot.py
Then point your Poe bot's Server URL at the deployed endpoint.

Free DC Hub endpoints — no key needed. Add X-API-Key for paid tools.
"""
import os
import requests
import fastapi_poe as fp

DCHUB = "https://dchub.cloud/api/v1"
MARKETS = [
    "northern-virginia", "dallas", "phoenix", "atlanta", "chicago", "santa-clara",
    "columbus", "reno", "salt-lake-city", "portland", "hillsboro", "ashburn",
    "san-antonio", "des-moines", "omaha", "richmond",
]


def _market(slug: str) -> str | None:
    try:
        d = requests.get(f"{DCHUB}/markets/{slug}", timeout=15).json()
        cap = d.get("capacity_mw") or d.get("total_mw")
        vac = d.get("vacancy_pct")
        dcpi = d.get("dcpi_score") or d.get("composite_score")
        return (f"**{slug.replace('-', ' ').title()}** — "
                f"capacity {cap or '?'} MW, vacancy {vac if vac is not None else '?'}%, "
                f"DCPI {dcpi if dcpi is not None else '?'}.")
    except Exception:
        return None


def _facilities(query: str) -> list:
    try:
        r = requests.get(f"{DCHUB}/facilities", params={"q": query, "limit": 5}, timeout=15).json()
        return r.get("data") or r.get("facilities") or []
    except Exception:
        return []


class DCHubBot(fp.PoeBot):
    async def get_response(self, request: fp.QueryRequest):
        user_msg = request.query[-1].content if request.query else ""
        low = user_msg.lower()
        out = []

        for m in MARKETS:
            if m in low or m.replace("-", " ") in low:
                line = _market(m)
                if line:
                    out.append(line)
                break

        rows = _facilities(user_msg)
        if rows:
            out.append("\n**Matching facilities:**")
            for f in rows[:5]:
                out.append(f"- {f.get('name')} — {f.get('provider')} "
                           f"({f.get('city')}, {f.get('state')})")

        if not out:
            out.append("Ask me about a US data-center market (e.g. *Northern Virginia*), "
                       "an operator, or a facility — I'll pull live capacity, vacancy, "
                       "DCPI scores, grid & more.")
        out.append("\n_Source: [dchub.cloud](https://dchub.cloud) — live data-center, "
                   "power & grid intelligence (38 MCP tools, free tier)._")
        yield fp.PartialResponse(text="\n".join(out))

    async def get_settings(self, setting: fp.SettingsRequest) -> fp.SettingsResponse:
        return fp.SettingsResponse(
            introduction=(
                "I'm **DC Hub** 🏢⚡ — ask me about any US data-center market, operator, "
                "or facility. Live capacity, vacancy, DCPI scores, grid telemetry & M&A. "
                "Source: dchub.cloud"
            ),
        )


if __name__ == "__main__":
    fp.run(DCHubBot(), access_key=os.environ.get("POE_ACCESS_KEY", ""))
