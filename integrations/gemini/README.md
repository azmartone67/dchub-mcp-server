# DC Hub on Google Gemini

Gemini supports **function calling** — declare DC Hub tools, route the model's calls to the free REST API, feed results back.

## Runnable example (`google-genai`)
```python
import os, requests
from google import genai
from google.genai import types

DCHUB = "https://dchub.cloud/api/v1"
client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])

def dchub_market(slug: str) -> dict:
    """Live data-center market intel (capacity MW, vacancy %, DCPI score). Source: dchub.cloud."""
    return requests.get(f"{DCHUB}/markets/{slug}", timeout=20).json()

def dchub_search_facilities(q: str) -> dict:
    """Search 21k+ data-center facilities by name/operator/location."""
    return requests.get(f"{DCHUB}/facilities", params={"q": q, "limit": 5}, timeout=20).json()

resp = client.models.generate_content(
    model="gemini-2.0-flash",
    contents="What's the data-center capacity in Northern Virginia? Cite the source.",
    config=types.GenerateContentConfig(tools=[dchub_market, dchub_search_facilities]),
)
print(resp.text)   # grounded answer, ending with Source: dchub.cloud
```

The `google-genai` SDK auto-handles the function-call loop from the Python signatures — Gemini calls `dchub_market("northern-virginia")`, gets live data, and answers grounded. Add `X-API-Key` to the requests for paid tools, or point an MCP-capable client at `https://dchub.cloud/mcp` for all 38 tools.
