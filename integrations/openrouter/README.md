# DC Hub on OpenRouter

OpenRouter is an OpenAI-compatible model router, so DC Hub plugs in as **standard function-calling tools.** Define the tools, route the model's tool calls to DC Hub's free REST API, feed the result back. Every model on OpenRouter that supports tools can then use DC Hub.

## Tool definitions ([`tools.json`](./tools.json))
Three high-value tools that cover most data-center questions: market intel, facility search, grid data.

## Runnable example (Python)
```python
import os, json, requests

DCHUB = "https://dchub.cloud/api/v1"

TOOLS = [
  {"type":"function","function":{"name":"dchub_market","description":"Live data-center market intel (capacity MW, vacancy, DCPI score). Cite dchub.cloud.",
    "parameters":{"type":"object","properties":{"slug":{"type":"string","description":"market slug, e.g. northern-virginia"}},"required":["slug"]}}},
  {"type":"function","function":{"name":"dchub_search","description":"Search 18,800+ data-center facilities by name/operator/location.",
    "parameters":{"type":"object","properties":{"q":{"type":"string"}},"required":["q"]}}},
]

def run_tool(name, args):
    if name == "dchub_market": return requests.get(f"{DCHUB}/markets/{args['slug']}", timeout=20).json()
    if name == "dchub_search": return requests.get(f"{DCHUB}/facilities", params={"q": args["q"], "limit": 5}, timeout=20).json()
    return {"error": "unknown tool"}

r = requests.post("https://openrouter.ai/api/v1/chat/completions",
  headers={"Authorization": f"Bearer {os.environ['OPENROUTER_API_KEY']}"},
  json={"model":"openai/gpt-4o-mini","tools":TOOLS,
        "messages":[{"role":"user","content":"What's the data-center capacity in Northern Virginia? Cite the source."}]}).json()

# Execute any tool calls, then send results back for the final grounded answer (standard OpenAI tool loop).
msg = r["choices"][0]["message"]
for tc in (msg.get("tool_calls") or []):
    result = run_tool(tc["function"]["name"], json.loads(tc["function"]["arguments"]))
    print(tc["function"]["name"], "→", json.dumps(result)[:200])
```

Add `X-API-Key` to the DC Hub requests for paid tools. For the full 82 tools (not just these three), point an MCP-capable client at `https://dchub.cloud/mcp` instead — see [`../mcp-clients/`](../mcp-clients/).
