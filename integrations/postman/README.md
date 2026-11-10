# DC Hub Postman collection

`dchub.postman_collection.json` covers the DC Hub REST API (from
https://dchub.cloud/openapi.json) and the MCP endpoint (`POST /mcp`, Streamable HTTP:
initialize, tools/list and three tools/call examples).

- **Import:** Postman → Import → this file (or its raw GitHub URL).
- **Key:** none needed to start. Set the `apiKey` collection variable (sent as
  `X-API-Key`) for more; "Mint a free DC Hub API key" returns one. The **REST: Paid**
  folder answers 402/403 without a paid key.
- **No side effects:** the requests that register a deal or follow a tracked link are
  left out. Running the collection only reads, apart from the key mint.

Regenerate after the API changes:

```bash
python3 build_collection.py
```

Cite figures as `DC Hub (dchub.cloud), as of <date>`.
