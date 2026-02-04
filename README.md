# LINE Webhook + Gemini (ElysiaJS)

A minimal ElysiaJS webhook server for LINE Messaging API that uses Gemini to:
- Summarize group chat with `/summary`
- Suggest event details with `/event` or `/poll`
- Answer questions with `/research`

## Endpoints
- `POST /webhook/line` LINE webhook
- `GET /health` health check

## Env
Copy `.env.example` and fill in values:
- `LINE_CHANNEL_SECRET`
- `LINE_CHANNEL_ACCESS_TOKEN`
- `GEMINI_API_KEY`

Optional:
- `GEMINI_MODEL` (default `gemini-2.5-flash`)
- `SUMMARY_LIMIT` (default `80`)
- `HISTORY_LIMIT` (default `120`)
- `DEFAULT_TIMEZONE` (default `Asia/Bangkok`)

## Run
```bash
bun install
bun run dev
```

## Notes
- Message history is stored in memory only. Use a database or cache for production.
- `/event` returns a calendar link when date/time is detected.
- `/research` answers from the model only (no live web search).
