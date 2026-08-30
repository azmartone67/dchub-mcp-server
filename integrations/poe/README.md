# DC Hub on Poe

A **Poe server bot** puts DC Hub in front of every Poe user — they just chat with `@DCHub`. [`dchub_bot.py`](./dchub_bot.py) is a ready-to-deploy bot that answers data-center / power / grid questions with live DC Hub data + a citation.

## Deploy in 5 minutes
1. `pip install fastapi-poe requests`
2. Create the bot at **https://poe.com/create_bot → "Server bot"** — grab the **access key** and pick a bot name.
3. Host `dchub_bot.py` anywhere that serves HTTP ([Modal](https://modal.com) is the canonical Poe path; Railway/Render/Fly also work):
   ```bash
   POE_ACCESS_KEY=psk_your_key python dchub_bot.py
   ```
4. Back on poe.com, set your bot's **Server URL** to the deployed endpoint and **sync settings**.

Done — Poe users can now chat with DC Hub. Try: *"What's the data-center capacity in Northern Virginia?"* → live numbers + `Source: dchub.cloud`.

## Make it smarter (optional)
The starter bot does keyword market-matching + facility search against the free REST API. To give it the full 83 tools, have it call `https://dchub.cloud/mcp` (MCP) or the `dchub` Python SDK (`pip install dchub`), and route a Poe model (e.g. GPT-4o via `server_bot_dependencies`) to reason over the results.
