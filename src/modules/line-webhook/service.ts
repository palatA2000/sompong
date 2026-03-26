import { createHmac, timingSafeEqual } from "crypto";
import { GoogleGenAI } from "@google/genai";
import { Kysely } from "kysely";
import type { Database } from "../../db/types.js";
import type {
  LineWebhookBody,
  LineWebhookEvent,
  LineTextMessage,
  MessageEntry,
  LineFlexMessage,
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
const LINE_USER_PROFILE_API = "https://api.line.me/v2/bot/profile";
const LINE_GROUP_MEMBER_PROFILE_API = "https://api.line.me/v2/bot/group";
const LINE_GROUP_SUMMARY_API = "https://api.line.me/v2/bot/group";
const LINE_ROOM_MEMBER_PROFILE_API = "https://api.line.me/v2/bot/room";
const PROFILE_CACHE_TTL_MS = 30 * 60_000;

const HELP_TEXT = [
  "คำสั่งที่ใช้งานได้:",
  "/help - แสดงรายการคำสั่ง",
  "/fortune - ดูดวงสั้นๆ",
  "/summary - สรุปบทสนทนาล่าสุด",
  "/research <คำถาม> - ค้นเว็บและสรุปคำตอบพร้อมอ้างอิง",
  "/ทายเพลง - ทายเพลงจาก emoji",
].join("\n");

type ConversationSourceType = "group" | "room" | "user" | "unknown";

type ConversationContext = {
  conversationId: string;
  sourceType: ConversationSourceType;
  sourceId: string | null;
};

type GroupSummaryEntry = {
  groupId: string;
  groupName?: string;
  pictureUrl?: string;
};

class MessageStore {
  constructor(private db: Kysely<Database>) {}

  async add(
    context: ConversationContext,
    entry: MessageEntry,
    group?: GroupSummaryEntry,
  ) {
    const userId = await this.upsertUser(entry.userId, entry.displayName);
    const groupId = await this.upsertGroup(context, group);
    const chatId = await this.upsertChat(context, groupId);

    await this.db
      .insertInto("chat_messages")
      .values({
        chat_id: chatId,
        user_id: userId,
        text: entry.text,
        sent_at: new Date(entry.timestamp),
      })
      .execute();
  }

  async getRecent(
    conversationId: string,
    limit: number,
  ): Promise<MessageEntry[]> {
    await this.touchConversation(conversationId);

    const rows = await this.db
      .selectFrom("chat_messages")
      .innerJoin("chats", "chats.id", "chat_messages.chat_id")
      .leftJoin("users", "users.id", "chat_messages.user_id")
      .select([
        "chat_messages.text as text",
        "chat_messages.sent_at as sent_at",
        "users.display_name as display_name",
      ])
      .where("chats.conversation_id", "=", conversationId)
      .orderBy("chat_messages.sent_at", "desc")
      .orderBy("chat_messages.id", "desc")
      .limit(limit)
      .execute();

    return rows.reverse().map((row) => ({
      text: row.text,
      displayName: row.display_name ?? undefined,
      timestamp: row.sent_at.getTime(),
    }));
  }

  private async upsertUser(
    lineUserId: string | undefined,
    displayName?: string,
  ): Promise<number | null> {
    if (!lineUserId) return null;

    const now = new Date();
    const user = await this.db
      .insertInto("users")
      .values({
        line_user_id: lineUserId,
        display_name: displayName ?? null,
        updated_at: now,
      })
      .onConflict((oc) =>
        oc.column("line_user_id").doUpdateSet({
          ...(displayName !== undefined ? { display_name: displayName } : {}),
          updated_at: now,
        }),
      )
      .returning("id")
      .executeTakeFirstOrThrow();

    return user.id;
  }

  private async upsertGroup(
    context: ConversationContext,
    group?: GroupSummaryEntry,
  ): Promise<number | null> {
    if (context.sourceType !== "group" || !context.sourceId) return null;

    const now = new Date();
    const groupRecord = await this.db
      .insertInto("groups")
      .values({
        line_group_id: context.sourceId,
        group_name: group?.groupName ?? null,
        picture_url: group?.pictureUrl ?? null,
        updated_at: now,
      })
      .onConflict((oc) =>
        oc.column("line_group_id").doUpdateSet({
          ...(group?.groupName !== undefined
            ? { group_name: group.groupName }
            : {}),
          ...(group?.pictureUrl !== undefined
            ? { picture_url: group.pictureUrl }
            : {}),
          updated_at: now,
        }),
      )
      .returning("id")
      .executeTakeFirstOrThrow();

    return groupRecord.id;
  }

  private async upsertChat(
    context: ConversationContext,
    groupId: number | null,
  ): Promise<number> {
    const now = new Date();
    const chat = await this.db
      .insertInto("chats")
      .values({
        conversation_id: context.conversationId,
        source_type: context.sourceType,
        source_id: context.sourceId,
        group_id: groupId,
        last_message_at: now,
        updated_at: now,
      })
      .onConflict((oc) =>
        oc.column("conversation_id").doUpdateSet({
          source_type: context.sourceType,
          source_id: context.sourceId,
          group_id: groupId,
          last_message_at: now,
          updated_at: now,
        }),
      )
      .returning("id")
      .executeTakeFirstOrThrow();

    return chat.id;
  }

  private async touchConversation(conversationId: string) {
    const now = new Date();

    await this.db
      .updateTable("chats")
      .set({
        last_message_at: now,
        updated_at: now,
      })
      .where("conversation_id", "=", conversationId)
      .execute();
  }
}

class LineClient {
  private profileCache = new Map<
    string,
    { displayName: string; expiresAt: number }
  >();
  private groupSummaryCache = new Map<
    string,
    { summary: GroupSummaryEntry; expiresAt: number }
  >();

  constructor(private accessToken: string) {}

  async replyText(replyToken: string, text: string) {
    return this.reply(replyToken, [{ type: "text", text }]);
  }

  async reply(
    replyToken: string,
    messages: (LineTextMessage | LineFlexMessage)[],
  ) {
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

  async getDisplayName(event: LineWebhookEvent): Promise<string | undefined> {
    const userId = event.source.userId;
    if (!userId) return undefined;

    const profilePath = this.buildProfilePath(event, userId);
    if (!profilePath) return undefined;

    const cacheKey = `${profilePath}|${userId}`;
    const cached = this.profileCache.get(cacheKey);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      return cached.displayName;
    }

    const response = await fetch(profilePath, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
      },
    });

    if (!response.ok) {
      return undefined;
    }

    const body = (await response.json()) as { displayName?: string };
    const displayName = body.displayName?.trim();
    if (!displayName) return undefined;

    this.profileCache.set(cacheKey, {
      displayName,
      expiresAt: now + PROFILE_CACHE_TTL_MS,
    });

    return displayName;
  }

  async getGroupSummary(
    groupId: string,
  ): Promise<GroupSummaryEntry | undefined> {
    const cached = this.groupSummaryCache.get(groupId);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      return cached.summary;
    }

    const encodedGroupId = encodeURIComponent(groupId);
    const response = await fetch(
      `${LINE_GROUP_SUMMARY_API}/${encodedGroupId}/summary`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
      },
    );

    if (!response.ok) {
      return undefined;
    }

    const body = (await response.json()) as {
      groupName?: string;
      pictureUrl?: string;
    };

    const summary: GroupSummaryEntry = {
      groupId,
      ...(body.groupName ? { groupName: body.groupName.trim() } : {}),
      ...(body.pictureUrl ? { pictureUrl: body.pictureUrl.trim() } : {}),
    };

    this.groupSummaryCache.set(groupId, {
      summary,
      expiresAt: now + PROFILE_CACHE_TTL_MS,
    });

    return summary;
  }

  private buildProfilePath(
    event: LineWebhookEvent,
    userId: string,
  ): string | undefined {
    const encodedUserId = encodeURIComponent(userId);

    if (event.source.groupId) {
      const encodedGroupId = encodeURIComponent(event.source.groupId);
      return `${LINE_GROUP_MEMBER_PROFILE_API}/${encodedGroupId}/member/${encodedUserId}`;
    }

    if (event.source.roomId) {
      const encodedRoomId = encodeURIComponent(event.source.roomId);
      return `${LINE_ROOM_MEMBER_PROFILE_API}/${encodedRoomId}/member/${encodedUserId}`;
    }

    return `${LINE_USER_PROFILE_API}/${encodedUserId}`;
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

const buildConversationContext = (
  event: LineWebhookEvent,
): ConversationContext => {
  const source = event.source;
  if (source.groupId) {
    return {
      conversationId: `group:${source.groupId}`,
      sourceType: "group",
      sourceId: source.groupId,
    };
  }

  if (source.roomId) {
    return {
      conversationId: `room:${source.roomId}`,
      sourceType: "room",
      sourceId: source.roomId,
    };
  }

  if (source.userId) {
    return {
      conversationId: `user:${source.userId}`,
      sourceType: "user",
      sourceId: source.userId,
    };
  }

  return {
    conversationId: "unknown",
    sourceType: "unknown",
    sourceId: null,
  };
};

const formatMessages = (messages: MessageEntry[]) =>
  messages
    .map((entry) => {
      const time = new Date(entry.timestamp).toISOString();
      const user = entry.displayName ?? "unknown";
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
    db: Kysely<Database>,
    private lineConfig: LineConfig,
    private geminiConfig: GeminiConfig,
    private summaryLimit: number,
    private quizApiBaseUrl: string,
    private quizApiKey: string,
  ) {
    this.store = new MessageStore(db);
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
    if (event.type === "postback") {
      await this.handlePostback(event);
      return;
    }
    if (event.type !== "message") return;
    if (!event.message || event.message.type !== "text") return;

    const text = event.message.text?.trim() ?? "";
    const conversation = buildConversationContext(event);
    const timestamp = event.timestamp ?? Date.now();
    const [displayName, groupSummary] = await Promise.all([
      this.lineClient.getDisplayName(event),
      event.source.groupId
        ? this.lineClient.getGroupSummary(event.source.groupId)
        : Promise.resolve(undefined),
    ]);

    await this.store.add(
      conversation,
      {
        userId: event.source.userId,
        displayName,
        text,
        timestamp,
      },
      groupSummary,
    );

    if (!event.replyToken) return;

    if (/^\/summary\b/i.test(text)) {
      await this.handleSummary(event, conversation.conversationId);
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
      await this.handleResearch(event, conversation.conversationId, text);
      return;
    }

    if (/^\/(ทายเพลง)(\s|$)/i.test(text)) {
      await this.handleQuiz(event);
    }
  }

  private async handlePostback(event: LineWebhookEvent) {
    if (!event.postback?.data) return;

    const params = new URLSearchParams(event.postback.data);
    const action = params.get("action");

    if (action === "answer") {
      const qid = params.get("qid");
      const cid = params.get("cid");
      if (!qid || !cid) return;

      const lineUserId = event.source.userId ?? "";
      const lineGroupId = event.source.groupId ?? "";

      let result: {
        correct: boolean;
        already_answered: boolean;
        score: number;
      };
      try {
        const response = await fetch(
          `${this.quizApiBaseUrl}/api/v1/quiz/answers`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Api-Key": this.quizApiKey,
            },
            body: JSON.stringify({
              line_user_id: lineUserId,
              line_group_id: lineGroupId,
              question_id: Number(qid),
              choice_id: Number(cid),
            }),
          },
        );
        if (!response.ok) return;
        result = (await response.json()) as {
          correct: boolean;
          already_answered: boolean;
          score: number;
        };
      } catch {
        return;
      }

      if (result.already_answered) return;
      if (!event.replyToken) return;

      const displayName = await this.lineClient.getDisplayName(event);
      const message = result.correct
        ? `${displayName} ถูกต้อง! คะแนนของคุณ: ${result.score}`
        : `${displayName} ผิด! คะแนนของคุณ: ${result.score}`;

      await this.lineClient.replyText(event.replyToken, message);
    }
  }

  private async handleHelp(event: LineWebhookEvent) {
    await this.lineClient.replyText(event.replyToken!, HELP_TEXT);
  }

  private async handleFortune(event: LineWebhookEvent) {
    const prompt = [
      "คุณคือหมอดู AI สายตลก ที่ให้คำทำนายแบบขำ ๆ เพื่อความบันเทิงเท่านั้น สไตล์การทำนายของคุณต้อง สนุก กวน ๆ น่ารัก และไม่จริงจัง",
      "บุคลิกของหมอดู",
      "- พูดเหมือนหมอดูที่มั่นใจเกินเหตุ",
      "- ใช้คำเปรียบเทียบแปลก ๆ หรือเกินจริง",
      "- มีมุกตลกหรือความกวนเล็ก ๆ ในคำทำนาย",
      "- โทนเป็นมิตร ไม่ล้อเลียนหรือทำร้ายจิตใจ",
      "กฎสำคัญ",
      "- การดูดวงทั้งหมดเป็น เพื่อความบันเทิงเท่านั้น",
      "- ห้ามให้คำแนะนำที่จริงจังเกี่ยวกับ:",
      "1.สุขภาพ",
      "2.การเงิน",
      "3.กฎหมาย",
      "4.การตัดสินใจชีวิตใหญ่ ๆ",
      "- หลีกเลี่ยงคำทำนายที่ทำให้ผู้ใช้เครียดหรือกังวล",
      "- หากต้องพูดถึงเรื่องลบ ให้ทำในโทนขำ ๆ หรือเบา ๆ",
      "ตอบสั้น ๆ ในรูปแบบ 'ดวงวันนี้: <คำทำนาย>'",
    ].join("\n");

    const fortune = await this.gemini.generateText(prompt);
    const answer =
      fortune.trim() ||
      "ดวงวันนี้: มีคนจะชวนทำเรื่องใหญ่ แต่เริ่มจากกินข้าวก่อน";

    await this.lineClient.replyText(event.replyToken!, `ดวงวันนี้: ${answer}`);
  }

  private async handleSummary(event: LineWebhookEvent, conversationId: string) {
    const history = (
      await this.store.getRecent(conversationId, this.summaryLimit)
    ).filter((entry) => !/^\/summary\b/i.test(entry.text));

    if (history.length === 0) {
      await this.lineClient.replyText(
        event.replyToken!,
        "ยังไม่มีข้อความให้สรุปในตอนนี้",
      );
      return;
    }

    const prompt = [
      "คุณคือผู้ช่วย AI ที่เชี่ยวชาญในการสรุปบทสนทนาในกลุ่มแชท หน้าที่ของคุณคืออ่านบทสนทนา แล้วสรุปให้เข้าใจง่าย กระชับ และใช้งานได้จริง เป็นภาษาไทย",
      "เป้าหมายของการสรุป",
      "- สรุป หัวข้อหลัก ที่ถูกพูดถึง",
      "- ระบุ ข้อสรุปหรือการตัดสินใจ",
      "- ดึง งานที่ต้องทำต่อ (Action items) และผู้รับผิดชอบ (ถ้ามี)",
      "- ตัดบทสนทนาที่เป็นเรื่องเล่น ๆ หรือไม่เกี่ยวข้องออก",
      "- ทำให้สรุปอ่านง่ายและกระชับ",
      "กฎการตอบ",
      "- ใช้ภาษากลาง เข้าใจง่าย",
      "- ห้ามแต่งข้อมูลเพิ่มจากที่ไม่มีในแชท",
      "- หากข้อมูลไม่ชัดเจน ให้ระบุว่า “ไม่ชัดเจน”",
      "- เขียนสรุปเป็นภาษาเดียวกับบทสนทนา",
      "",
      "แชตล่าสุด:",
      formatMessages(history),
    ].join("\n");

    const summary = await this.gemini.generateText(prompt);
    const responseText = summary.trim() || "สรุปไม่สำเร็จ ลองใหม่อีกครั้งนะ";

    await this.lineClient.replyText(event.replyToken!, responseText);
  }

  private async handleQuiz(event: LineWebhookEvent) {
    if (!event.replyToken) return;

    type QuizQuestion = {
      id: number;
      emoji: string;
      question_text: string;
      choices: Array<{
        id: number;
        question_id: number;
        choice_text: string;
        choice_order: number;
        is_correct: boolean;
      }>;
    };

    let question: QuizQuestion;
    try {
      const response = await fetch(`${this.quizApiBaseUrl}/api/v1/quiz`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Api-Key": this.quizApiKey,
        },
      });
      if (!response.ok) {
        await this.lineClient.replyText(
          event.replyToken,
          "ไม่สามารถโหลดคำถามได้ ลองใหม่อีกครั้ง",
        );
        return;
      }
      question = (await response.json()) as QuizQuestion;
    } catch {
      await this.lineClient.replyText(
        event.replyToken,
        "ไม่สามารถโหลดคำถามได้ ลองใหม่อีกครั้ง",
      );
      return;
    }

    const buttons = question.choices.map((choice) => ({
      type: "button",
      style: "primary",
      action: {
        type: "postback",
        label: choice.choice_text,
        data: `action=answer&qid=${question.id}&cid=${choice.id}`,
      },
    }));

    const flexMessage: LineFlexMessage = {
      type: "flex",
      altText: "Emoji Quiz",
      contents: {
        type: "bubble",
        body: {
          type: "box",
          layout: "vertical",
          spacing: "md",
          contents: [
            {
              type: "text",
              text: question.emoji,
              size: "xxl",
              align: "center",
            },
            {
              type: "text",
              text: question.question_text,
              wrap: true,
              weight: "bold",
              size: "md",
            },
          ],
        },
        footer: {
          type: "box",
          layout: "vertical",
          spacing: "sm",
          contents: buttons,
        },
      },
    };

    await this.lineClient.reply(event.replyToken, [flexMessage]);
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

    const history = await this.store.getRecent(conversationId, 30);

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
