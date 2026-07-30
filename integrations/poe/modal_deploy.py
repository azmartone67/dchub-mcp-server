"""
One-command Modal deploy for the DC Hub Poe bot — SELF-CONTAINED (bot inlined, no
cross-module mount, so the container can't fail to import dchub_bot).

Setup (once):
    python3 -m venv ~/dchub-venv && source ~/dchub-venv/bin/activate
    pip install modal && modal token new
    # Server bot at https://poe.com/create_bot -> copy the access key:
    modal secret create dchub-poe POE_ACCESS_KEY=psk_YOUR_REAL_KEY

Deploy:
    cd ~/dchub-mcp-server/integrations/poe && modal deploy modal_deploy.py

Paste the printed *.modal.run URL as your Poe bot's Server URL -> Sync settings.
Tail logs if anything misbehaves:  modal app logs dchub-poe-bot
"""
import os
import modal

app = modal.App("dchub-poe-bot")
image = modal.Image.debian_slim(python_version="3.11").pip_install(
    "fastapi-poe>=0.0.36", "requests"
)


@app.function(image=image, secrets=[modal.Secret.from_name("dchub-poe")])
@modal.asgi_app()
def poe_app():
    import requests
    import fastapi_poe as fp

    DCHUB = "https://dchub.cloud/api/v1"
    MARKETS = [
        "northern-virginia", "dallas", "phoenix", "atlanta", "chicago", "santa-clara",
        "columbus", "reno", "salt-lake-city", "portland", "hillsboro", "ashburn",
        "san-antonio", "des-moines", "omaha", "richmond",
    ]

    class DCHubBot(fp.PoeBot):
        async def get_response(self, request):
            user_msg = request.query[-1].content if request.query else ""
            low = user_msg.lower()
            out = []
            try:
                for m in MARKETS:
                    if m in low or m.replace("-", " ") in low:
                        d = requests.get(f"{DCHUB}/markets/{m}", timeout=15).json()
                        cap = d.get("capacity_mw") or d.get("total_mw")
                        out.append(f"**{m.replace('-', ' ').title()}** — capacity {cap or '?'} MW, "
                                   f"vacancy {d.get('vacancy_pct', '?')}%, "
                                   f"DCPI {d.get('dcpi_score') or d.get('composite_score', '?')}.")
                        break
            except Exception:
                pass
            try:
                r = requests.get(f"{DCHUB}/facilities", params={"q": user_msg, "limit": 5}, timeout=15).json()
                for f in (r.get("data") or r.get("facilities") or [])[:5]:
                    out.append(f"- {f.get('name')} — {f.get('provider')} ({f.get('city')}, {f.get('state')})")
            except Exception:
                pass
            if not out:
                out.append("Ask me about a US data-center market (e.g. *Northern Virginia*), an operator, or a facility.")
            out.append("\n_Source: [dchub.cloud](https://dchub.cloud) — live data-center, power & grid intelligence (81 MCP tools, free)._")
            yield fp.PartialResponse(text="\n".join(out))

        async def get_settings(self, setting):
            return fp.SettingsResponse(
                introduction=("I'm **DC Hub** 🏢⚡ — ask me about any US data-center market, operator, "
                              "or facility. Live capacity, vacancy, DCPI scores, grid & M&A. Source: dchub.cloud")
            )

    return fp.make_app(DCHubBot(), access_key=os.environ["POE_ACCESS_KEY"])
