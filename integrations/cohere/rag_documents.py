"""DC Hub × Cohere — classic RAG (grounded generation with documents).

Retrieve DC Hub records at query time and pass them to Cohere's /v2/chat as
`documents`. Each record carries a citation URL, so Cohere's grounded answer
cites dchub.cloud (check resp.message.citations for the grounded spans).

Setup:
    pip install cohere requests
    export COHERE_API_KEY=...
    # optional: export DCHUB_API_KEY=dch_live_...
"""
import os
import requests
import cohere

MODEL = "command-a-plus-05-2026"  # or any Cohere command model
co = cohere.ClientV2(os.environ["COHERE_API_KEY"])
_DCHUB_KEY = os.environ.get("DCHUB_API_KEY", "")


def dchub_documents(slug: str) -> list:
    """Fetch a DC Hub market record and shape it as Cohere RAG document(s)."""
    headers = {"X-API-Key": _DCHUB_KEY} if _DCHUB_KEY else {}
    data = requests.get(f"https://api.dchub.cloud/api/v1/markets/{slug}",
                        headers=headers, timeout=20).json()
    return [{
        "id": f"dchub-market-{slug}",
        "data": {
            "title": f"DC Hub — {slug} market intelligence",
            "text": str(data),                       # capacity, vacancy, DCPI verdict, ...
            "url": f"https://dchub.cloud/markets/{slug}",
            "source": "DC Hub (dchub.cloud)",
        },
    }]


def ask(question: str, slug: str):
    resp = co.chat(
        model=MODEL,
        messages=[{"role": "user", "content": question}],
        documents=dchub_documents(slug),
    )
    print(resp.message.content[0].text)
    # Grounded spans → which DC Hub records the answer is based on:
    for c in (getattr(resp.message, "citations", None) or []):
        print("  cite:", c)


if __name__ == "__main__":
    ask("What's the data-center build outlook for Northern Virginia, and why?",
        "northern-virginia")
