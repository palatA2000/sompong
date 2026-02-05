import { createHmac, timingSafeEqual } from "crypto";
import { GoogleGenAI } from "@google/genai";
import type {
  LineWebhookBody,
  LineWebhookEvent,
  LineTextMessage,
  MessageEntry,
} from "./model.js";

export type LineConfig = {
  channelSecret: string;
  channelAccessToken: string;
};

export type GeminiConfig = {
  apiKey: string;
  model: string;
  defaultTimezone: string;
};

const LINE_REPLY_API = "https://api.line.me/v2/bot/message/reply";

const HELP_TEXT = [
  "คำสั่งที่ใช้งานได้:",
  "/help - แสดงรายการคำสั่ง",
  "/fortune - ดูดวงสั้นๆ",
  "/summary - สรุปบทสนทนาล่าสุด",
  "/research <คำถาม> - ค้นเว็บและสรุปคำตอบพร้อมอ้างอิง",
].join("\n");

type ConversationBucket = {
  items: MessageEntry[];
  lastSeen: number;
};

class MessageStore {
  private history = new Map<string, ConversationBucket>();

  constructor(
    private limit: number,
    private ttlMs: number,
    private maxConversations: number,
  ) {}

  add(conversationId: string, entry: MessageEntry) {
    const now = Date.now();
    this.cleanup(now);

    const bucket = this.history.get(conversationId) ?? {
      items: [],
      lastSeen: now,
    };
    bucket.items.push(entry);
    bucket.lastSeen = now;

    if (bucket.items.length > this.limit) {
      bucket.items.splice(0, bucket.items.length - this.limit);
    }

    this.history.delete(conversationId);
    this.history.set(conversationId, bucket);
  }

  getRecent(conversationId: string, limit: number): MessageEntry[] {
    const now = Date.now();
    this.cleanup(now);

    const bucket = this.history.get(conversationId);
    if (!bucket) return [];

    bucket.lastSeen = now;
    this.history.delete(conversationId);
    this.history.set(conversationId, bucket);

    const items = bucket.items;
    if (items.length <= limit) return items;
    return items.slice(items.length - limit);
  }

  private cleanup(now: number) {
    if (this.ttlMs > 0) {
      for (const [key, bucket] of this.history.entries()) {
        if (now - bucket.lastSeen > this.ttlMs) {
          this.history.delete(key);
        }
      }
    }

    if (this.maxConversations > 0) {
      while (this.history.size > this.maxConversations) {
        const oldestKey = this.history.keys().next().value;
        if (!oldestKey) break;
        this.history.delete(oldestKey);
      }
    }
  }
}

class LineClient {
  constructor(private accessToken: string) {}

  async replyText(replyToken: string, text: string) {
    return this.reply(replyToken, [{ type: "text", text }]);
  }

  async reply(replyToken: string, messages: LineTextMessage[]) {
    const response = await fetch(LINE_REPLY_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.accessToken}`,
      },
      body: JSON.stringify({ replyToken, messages }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`LINE reply failed: ${response.status} ${errorBody}`);
    }
  }
}

class GeminiClient {
  private ai: GoogleGenAI;

  constructor(private config: GeminiConfig) {
    this.ai = new GoogleGenAI({ apiKey: config.apiKey });
  }

  async generateText(prompt: string) {
    const response = await this.ai.models.generateContent({
      model: this.config.model,
      contents: prompt,
    });

    return this.extractText(response);
  }

  async generateTextWithSearch(prompt: string) {
    const response = await this.ai.models.generateContent({
      model: this.config.model,
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
      },
    });

    return {
      text: this.extractText(response),
      sources: this.extractWebSources(response),
    };
  }

  private extractText(response: {
    text?: string;
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  }) {
    if (typeof response.text === "string") return response.text;
    const candidateText = response.candidates?.[0]?.content?.parts?.[0]?.text;
    return typeof candidateText === "string" ? candidateText : "";
  }

  private extractWebSources(response: {
    candidates?: Array<{
      groundingMetadata?: {
        groundingChunks?: Array<{ web?: { uri?: string } }>;
      };
    }>;
  }) {
    const sources: string[] = [];
    const seen = new Set<string>();

    for (const candidate of response.candidates ?? []) {
      for (const chunk of candidate.groundingMetadata?.groundingChunks ?? []) {
        const uri = chunk.web?.uri;
        if (!uri || seen.has(uri)) continue;
        seen.add(uri);
        sources.push(uri);
      }
    }

    return sources;
  }
}

const buildConversationId = (event: LineWebhookEvent) => {
  const source = event.source;
  if (source.groupId) return `group:${source.groupId}`;
  if (source.roomId) return `room:${source.roomId}`;
  if (source.userId) return `user:${source.userId}`;
  return "unknown";
};

const formatMessages = (messages: MessageEntry[]) =>
  messages
    .map((entry) => {
      const time = new Date(entry.timestamp).toISOString();
      const user = entry.userId ?? "unknown";
      return `${time} | ${user} | ${entry.text}`;
    })
    .join("\n");

const trimCommand = (text: string, command: string) =>
  text.replace(new RegExp(`^/${command}\\s*`, "i"), "").trim();

export class LineWebhookService {
  private store: MessageStore;
  private lineClient: LineClient;
  private gemini: GeminiClient;

  constructor(
    private lineConfig: LineConfig,
    private geminiConfig: GeminiConfig,
    private summaryLimit: number,
    historyLimit: number,
    conversationTtlMinutes: number,
    maxConversations: number,
  ) {
    const ttlMs =
      conversationTtlMinutes > 0 ? conversationTtlMinutes * 60_000 : 0;
    this.store = new MessageStore(historyLimit, ttlMs, maxConversations);
    this.lineClient = new LineClient(lineConfig.channelAccessToken);
    this.gemini = new GeminiClient(geminiConfig);
  }

  verifySignature(rawBody: string, signature: string | undefined): boolean {
    if (!signature) return false;
    const hmac = createHmac("sha256", this.lineConfig.channelSecret);
    hmac.update(rawBody);
    const digest = hmac.digest("base64");
    const expected = Buffer.from(digest);
    const received = Buffer.from(signature);
    if (expected.length !== received.length) return false;
    return timingSafeEqual(expected, received);
  }

  async handleWebhook(payload: LineWebhookBody) {
    for (const event of payload.events) {
      try {
        await this.handleEvent(event);
      } catch (err) {
        console.error("Error handling event:", err, event);
      }
    }
  }

  private async handleEvent(event: LineWebhookEvent) {
    if (event.type !== "message") return;
    if (!event.message || event.message.type !== "text") return;

    const text = event.message.text?.trim() ?? "";
    const conversationId = buildConversationId(event);
    const timestamp = event.timestamp ?? Date.now();

    this.store.add(conversationId, {
      userId: event.source.userId,
      text,
      timestamp,
    });

    if (!event.replyToken) return;

    if (/^\/summary\b/i.test(text)) {
      await this.handleSummary(event, conversationId);
      return;
    }

    if (/^\/help\b/i.test(text)) {
      await this.handleHelp(event);
      return;
    }

    if (/^\/(fortune|duang|ดูดวง)(\s|$)/i.test(text)) {
      await this.handleFortune(event);
      return;
    }

    if (/^\/research\b/i.test(text)) {
      await this.handleResearch(event, conversationId, text);
    }
  }

  private async handleHelp(event: LineWebhookEvent) {
    await this.lineClient.replyText(event.replyToken!, HELP_TEXT);
  }

  private async handleFortune(event: LineWebhookEvent) {
    const prompt = [
      "คุณคือหมอดูสายกวนในแชตกลุ่ม LINE",
      "ทำนายดวงจากดวงดาวที่เรียกกันในวันนี้",
      "ตอบเป็นภาษาไทยแบบกวนๆ สุภาพ ไม่หยาบคาย",
      "ความยาว 1-2 ประโยค ไม่เกิน 120 ตัวอักษร",
    ].join("\n");

    const fortune = await this.gemini.generateText(prompt);
    const answer =
      fortune.trim() ||
      "ดวงวันนี้: มีคนจะชวนทำเรื่องใหญ่ แต่เริ่มจากกินข้าวก่อน";

    await this.lineClient.replyText(event.replyToken!, `ดวงวันนี้: ${answer}`);
  }

  private async handleSummary(event: LineWebhookEvent, conversationId: string) {
    const history = this.store
      .getRecent(conversationId, this.summaryLimit)
      .filter((entry) => !/^\/summary\b/i.test(entry.text));

    if (history.length === 0) {
      await this.lineClient.replyText(
        event.replyToken!,
        "ยังไม่มีข้อความให้สรุปในตอนนี้",
      );
      return;
    }

    const prompt = [
      'คุณคือ "เลขาหน้าห้อง" ที่สรุปแชตกลุ่ม LINE ให้สั้น กระชับ และเป็นภาษาไทย',
      "ใช้เฉพาะข้อมูลที่ให้มา ห้ามเดาเพิ่ม",
      "สรุปเป็นหัวข้อสั้นๆ พร้อมหัวข้อย่อยสั้นๆ 3-7 ข้อ",
      'ปิดท้ายด้วย "ประเด็นค้าง" ถ้ามีคำถาม/การตัดสินใจที่ยังไม่ได้ข้อสรุป',
      "",
      "แชตล่าสุด:",
      formatMessages(history),
    ].join("\n");

    const summary = await this.gemini.generateText(prompt);
    const responseText = summary.trim() || "สรุปไม่สำเร็จ ลองใหม่อีกครั้งนะ";

    await this.lineClient.replyText(event.replyToken!, responseText);
  }

  private async handleResearch(
    event: LineWebhookEvent,
    conversationId: string,
    text: string,
  ) {
    const query = trimCommand(text, "research");
    if (!query) {
      await this.lineClient.replyText(
        event.replyToken!,
        "พิมพ์คำถามต่อท้าย /research เช่น /research ร้านชาบูสยาม ราคาไม่เกิน 500",
      );
      return;
    }

    const history = this.store.getRecent(conversationId, 30);

    const prompt = [
      "คุณคือผู้ช่วยหาข้อมูลจากเว็บและช่วยตัดสินใจในกลุ่ม LINE",
      "ใช้ผลค้นเว็บจาก Google Search ที่ระบบให้มาเป็นหลัก",
      "ตอบเป็นภาษาไทย กระชับ และจัดเป็นหัวข้อ",
      "ถ้าข้อมูลอัปเดตยังไม่ชัดเจน ให้บอกความไม่แน่นอนอย่างตรงไปตรงมา",
      "",
      `คำถาม: ${query}`,
      "",
      "บริบทจากแชตล่าสุด (ถ้ามี):",
      formatMessages(history),
    ].join("\n");

    const response = await this.gemini.generateTextWithSearch(prompt);
    const answer =
      response.text.trim() || "ยังตอบไม่ได้ ลองถามใหม่พร้อมรายละเอียดเพิ่มเติม";
    const sources =
      response.sources.length > 0
        ? `\n\nอ้างอิงจากเว็บ:\n${response.sources
            .slice(0, 2)
            .map((source, index) => `${index + 1}. ${source}`)
            .join("\n")}`
        : "";

    await this.lineClient.replyText(event.replyToken!, `${answer}${sources}`);
  }
}
