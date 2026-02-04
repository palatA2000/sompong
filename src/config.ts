const requireEnv = (name: string): string => {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required env: ${name}`)
  }
  return value
}

const parseNumber = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export const config = {
  port: parseNumber(process.env.PORT, 3000),
  lineChannelSecret: requireEnv('LINE_CHANNEL_SECRET'),
  lineChannelAccessToken: requireEnv('LINE_CHANNEL_ACCESS_TOKEN'),
  geminiApiKey: requireEnv('GEMINI_API_KEY'),
  geminiModel: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash',
  summaryLimit: parseNumber(process.env.SUMMARY_LIMIT, 80),
  historyLimit: parseNumber(process.env.HISTORY_LIMIT, 120),
  conversationTtlMinutes: parseNumber(process.env.CONVERSATION_TTL_MINUTES, 24 * 60),
  maxConversations: parseNumber(process.env.MAX_CONVERSATIONS, 500),
  defaultTimezone: process.env.DEFAULT_TIMEZONE ?? 'Asia/Bangkok'
}
