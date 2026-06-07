"""DC Hub × LangChain — 10-line agent example.

Asks "data-center capacity in Northern Virginia?"; the agent calls DC Hub and
answers with a citation.

    pip install -r requirements.txt langchain-openai
    export OPENAI_API_KEY=...
    python example_agent.py

If no OPENAI_API_KEY is set, this falls back to calling the tool directly so the
example is still runnable (and proves the data + citation path) without an LLM.
"""
import os
from dchub_tools import DCHUB_TOOLS, dchub_market_intel

QUESTION = "What is the data-center capacity in Northern Virginia? Cite your source."


def run_agent() -> str:
    from langchain_openai import ChatOpenAI
    from langgraph.prebuilt import create_react_agent

    agent = create_react_agent(ChatOpenAI(model="gpt-4o-mini"), DCHUB_TOOLS)
    result = agent.invoke({"messages": [("user", QUESTION)]})
    return result["messages"][-1].content


if __name__ == "__main__":
    if os.environ.get("OPENAI_API_KEY"):
        print(run_agent())
    else:
        d = dchub_market_intel("northern-virginia")
        s = d["stats"]
        print(f"[tool-only fallback — set OPENAI_API_KEY for the full agent]\n"
              f"Northern Virginia: {s['facility_count']} facilities, "
              f"{s['total_power_mw']:,.0f} MW total ({s['avg_power_mw']} MW avg). "
              f"Source: {d['citation']}")
