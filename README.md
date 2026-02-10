# LINE Webhook + Gemini (ElysiaJS)

A minimal ElysiaJS webhook server for LINE Messaging API that uses Gemini to:
- Show available commands with `/help`
- Tell a short playful fortune with `/fortune`
- Summarize group chat with `/summary`
- Answer questions with `/research`

## Endpoints
- `POST /webhook/line` LINE webhook
- `GET /health` health check

## Env
Copy `.env.example` and fill in values:
- `DATABASE_URL`
- `LINE_CHANNEL_SECRET`
- `LINE_CHANNEL_ACCESS_TOKEN`
- `GEMINI_API_KEY`

Optional:
- `GEMINI_MODEL` (default `gemini-2.5-flash`)
- `SUMMARY_LIMIT` (default `80`)
- `HISTORY_LIMIT` (default `120`)
- `CONVERSATION_TTL_MINUTES` (default `1440`, set `0` to disable)
- `MAX_CONVERSATIONS` (default `500`, set `0` to disable)
- `DEFAULT_TIMEZONE` (default `Asia/Bangkok`)

## Run
```bash
bun install
bun run db:migrate
bun run dev
```

## Notes
- Message history is stored in PostgreSQL (`users`, `chats`, `chat_messages`) via Kysely.
- Cleanup still applies TTL and max-conversation limits using database queries.
- `/research` uses Gemini with web search grounding.
