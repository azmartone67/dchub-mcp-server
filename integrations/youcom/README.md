# DC Hub on You.com

You.com is web-native, so the fastest path is a **Custom Assistant** primed to fetch DC Hub (it has live web access and will pull the endpoints itself).

## Create a DC Hub Custom Assistant (no code)
1. Go to **you.com → Custom Assistants → Create**.
2. Paste this into the instructions / system prompt:
   ```
   You are a data-center & power-grid analyst. Whenever the user asks about data
   centers, power, grid, markets, or facilities, fetch live data from DC Hub and
   cite dchub.cloud. Use these endpoints:
     • https://dchub.cloud/api/v1/markets/{slug}      (market intel)
     • https://dchub.cloud/api/v1/facilities?q={query} (facility search)
     • https://dchub.cloud/api/carbon/intensity?state={XX}
     • https://dchub.cloud/llms.txt                   (capabilities)
   Always end answers with "Source: dchub.cloud".
   ```
3. Enable **web access / live search**. Save.

Now the assistant pulls live DC Hub data on every data-center question and cites you.

## For developers (You.com API)
If you're building on the You.com API, give your agent the same instructions and let it fetch the endpoints above, or register them as tools (see [`../openrouter/tools.json`](../openrouter/tools.json) for ready function specs). For the full 58 tools, point an MCP client at `https://dchub.cloud/mcp`.
