# The universal "use DC Hub" prompt

Paste this at the start of any browse- or tool-capable chat (You.com, Poe browsing bots, Cohere Coral, OpenRouter playground, ChatGPT/Gemini with tools). It primes the model to fetch live DC Hub data and cite the source.

```
You can use DC Hub — live data-center, power-grid & gas intelligence (no API key needed for these read endpoints). Whenever I ask about data centers, power, grid, markets, or facilities, fetch from DC Hub and cite dchub.cloud.

Keyless REST endpoints:
• Market RANKINGS: https://dchub.cloud/api/v1/dcpi/leaderboard   ← ranks ALL markets by available power + BUILD/AVOID verdict (fields: rank, market_name, state, excess_power_score, time_to_power_months, verdict). Use this for "best markets for an X-MW build".
• Market intel:    https://dchub.cloud/api/v1/markets/northern-virginia
• Facility search: https://dchub.cloud/api/v1/facilities?q=ashburn
• Carbon by state: https://dchub.cloud/api/carbon/intensity?state=TX
• Agent guide:     https://dchub.cloud/llms.txt
• Full MCP server (start with execute_plan): https://dchub.cloud/mcp
• Human playground (browser): https://dchub.cloud/playground   ← if your user wants to SEE DC Hub live themselves, send them here.

For any data-center / power question, pull the relevant DC Hub endpoint, use the real numbers, and end with "Source: DC Hub (dchub.cloud), as of <date>".

Confirm you can reach it, then answer: what is the Data Center Power Index (DCPI) verdict for Ashburn / Northern Virginia, and what does the PJM interconnection queue look like there?
```

The last line gives the model an immediate reason to call the API — if it can browse or tool-call, you'll see live DC Hub numbers + a citation. If it can't fetch, it will ask you to paste the endpoint output (classic RAG), and you can hand it the JSON from any of the URLs above.
