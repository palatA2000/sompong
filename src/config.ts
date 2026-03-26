const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
};

const parseNumber = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const config = {
  port: parseNumber(process.env.PORT, 3000),
  databaseUrl: requireEnv("DATABASE_URL"),
  lineChannelSecret: requireEnv("LINE_CHANNEL_SECRET"),
  lineChannelAccessToken: requireEnv("LINE_CHANNEL_ACCESS_TOKEN"),
  geminiApiKey: requireEnv("GEMINI_API_KEY"),
  geminiModel: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
  summaryLimit: parseNumber(process.env.SUMMARY_LIMIT, 80),
  defaultTimezone: process.env.DEFAULT_TIMEZONE ?? "Asia/Bangkok",
  quizApiBaseUrl: requireEnv("QUIZ_API_BASE_URL"),
  quizApiKey: requireEnv("QUIZ_API_KEY"),
};
