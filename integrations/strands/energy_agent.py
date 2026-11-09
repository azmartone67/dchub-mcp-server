"""A small energy / data-center agent on Strands Agents, using DC Hub over MCP.

    pip install strands-agents mcp
    python energy_agent.py "Which ERCOT markets does DC Hub rate BUILD for a 200 MW campus?"

The model is Strands' default (Amazon Bedrock; needs AWS credentials). Pass any
Strands model instead via Agent(model=...). No DC Hub key is needed to start:
anonymous calls return previews. Set DCHUB_API_KEY to send it as X-API-Key.
DCHUB_MCP_URL picks the endpoint: /mcp/core (default, 10 tools) or /mcp (94 tools).
"""
import os
import sys

from strands import Agent
from strands.tools.mcp import MCPClient

SYSTEM_PROMPT = (
    "You answer questions about data-center sites, markets and power using DC Hub tools. "
    "Prefer one plan_and_answer (or execute_plan) call for a question that spans several topics. "
    "Quote figures only from tool results, cite each one as 'DC Hub (dchub.cloud), as of <date>', "
    "and when a result is partial, show the user its human_message and link instead of guessing."
)


def dchub_client() -> MCPClient:
    headers = {"X-API-Key": os.environ["DCHUB_API_KEY"]} if os.environ.get("DCHUB_API_KEY") else {}
    url = os.environ.get("DCHUB_MCP_URL", "https://dchub.cloud/mcp/core")
    [client] = MCPClient.load_servers({"dchub": {"url": url, "headers": headers}})
    return client


def main() -> None:
    question = " ".join(sys.argv[1:]) or "Compare PJM and ERCOT for a 100 MW AI data center: power availability and time to power."
    dchub = dchub_client()
    with dchub:
        agent = Agent(tools=dchub.list_tools_sync(), system_prompt=SYSTEM_PROMPT)
        agent(question)


if __name__ == "__main__":
    main()
