# Privacy

This plugin sends the tool arguments you or your agent provide (for example a question, a market name, an ISO code or a target capacity) to DC Hub's hosted API at `https://dchub.cloud/mcp` to produce an answer. If you configure the optional API key, it is sent in the `X-API-Key` header and is stored by Dify as an encrypted credential; the plugin never logs it or includes it in error messages.

The plugin itself stores nothing. DC Hub processes requests as described in its privacy policy: https://dchub.cloud/privacy (tool-call logs are kept 90 days; questions about deletion go to privacy@dchub.cloud). DC Hub does not sell this data and does not use it to train third-party models.

The plugin does not request health, financial-account, biometric, government ID or children's data. Do not put personal data in questions.
