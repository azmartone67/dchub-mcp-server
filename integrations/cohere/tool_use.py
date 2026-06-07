"""DC Hub × Cohere — command-a tool-use example.

The model calls DC Hub live when a question needs ground-truth data-center data,
then answers citing dchub.cloud.

Setup:
    pip install cohere requests
    export COHERE_API_KEY=...
    # optional (free tier works without): export DCHUB_API_KEY=dch_live_...
    #   get one: curl -X POST https://dchub.cloud/api/v1/keys/claim -d '{"client_name":"cohere"}'
"""
import os
import json
import requests
import cohere

MODEL = "command-a-plus-05-2026"  # or any Cohere command model
co = cohere.ClientV2(os.environ["COHERE_API_KEY"])
_DCHUB_KEY = os.environ.get("DCHUB_API_KEY", "")


def dchub_market(slug: str) -> dict:
    """Live market intel for a DC Hub market slug, e.g. 'northern-virginia'."""
    headers = {"X-API-Key": _DCHUB_KEY} if _DCHUB_KEY else {}
    r = requests.get(f"https://api.dchub.cloud/api/v1/markets/{slug}",
                     headers=headers, timeout=20)
    return r.json()


TOOLS = [{
    "type": "function",
    "function": {
        "name": "dchub_market",
        "description": ("Live data-center market intelligence: capacity $/MW-day, "
                        "vacancy, grid headroom, DCPI BUILD/CAUTION/AVOID verdict, "
                        "and a citation URL. `slug` is a market like "
                        "'northern-virginia', 'ashburn', or 'dallas'."),
        "parameters": {
            "type": "object",
            "properties": {"slug": {"type": "string",
                                    "description": "market slug, lowercase-hyphenated"}},
            "required": ["slug"],
        },
    },
}]

_DISPATCH = {"dchub_market": dchub_market}


def ask(question: str) -> str:
    messages = [{"role": "user", "content": question}]
    resp = co.chat(model=MODEL, messages=messages, tools=TOOLS)

    # Run any tool the model requested, feed results back, ask once more.
    if getattr(resp.message, "tool_calls", None):
        messages.append(resp.message)
        for tc in resp.message.tool_calls:
            args = json.loads(tc.function.arguments)
            result = _DISPATCH[tc.function.name](**args)
            messages.append({"role": "tool", "tool_call_id": tc.id,
                             "content": json.dumps(result)})
        resp = co.chat(model=MODEL, messages=messages, tools=TOOLS)

    text = resp.message.content[0].text
    print(text)
    return text


if __name__ == "__main__":
    ask("Should I build a data center in Northern Virginia right now? "
        "Use live data and cite your source.")
