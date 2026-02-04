import { createHmac, timingSafeEqual } from 'crypto'
import { GoogleGenAI } from '@google/genai'
import type { LineWebhookBody, LineWebhookEvent, LineTextMessage, MessageEntry } from './model'

export type LineConfig = {
  channelSecret: string
  channelAccessToken: string
}

export type GeminiConfig = {
  apiKey: string
  model: string
  defaultTimezone: string
}

const LINE_REPLY_API = 'https://api.line.me/v2/bot/message/reply'

class MessageStore {
  private history = new Map<string, MessageEntry[]>()

  constructor(private limit: number) {}

  add(conversationId: string, entry: MessageEntry) {
    const items = this.history.get(conversationId) ?? []
    items.push(entry)
    if (items.length > this.limit) {
      items.splice(0, items.length - this.limit)
    }
    this.history.set(conversationId, items)
  }

  getRecent(conversationId: string, limit: number): MessageEntry[] {
    const items = this.history.get(conversationId) ?? []
    if (items.length <= limit) return items
    return items.slice(items.length - limit)
  }
}

class LineClient {
  constructor(private accessToken: string) {}

  async replyText(replyToken: string, text: string) {
    return this.reply(replyToken, [{ type: 'text', text }])
  }

  async reply(replyToken: string, messages: LineTextMessage[]) {
    const response = await fetch(LINE_REPLY_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.accessToken}`
      },
      body: JSON.stringify({ replyToken, messages })
    })

    if (!response.ok) {
      const errorBody = await response.text()
      throw new Error(`LINE reply failed: ${response.status} ${errorBody}`)
    }
  }
}

class GeminiClient {
  private ai: GoogleGenAI

  constructor(private config: GeminiConfig) {
    this.ai = new GoogleGenAI({ apiKey: config.apiKey })
  }

  async generateText(prompt: string) {
    const response = await this.ai.models.generateContent({
      model: this.config.model,
      contents: prompt
    })

    if (typeof response.text === 'string') return response.text
    const candidateText = (response as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> })
      ?.candidates?.[0]?.content?.parts?.[0]?.text
    return typeof candidateText === 'string' ? candidateText : ''
  }
}

const buildConversationId = (event: LineWebhookEvent) => {
  const source = event.source
  if (source.groupId) return `group:${source.groupId}`
  if (source.roomId) return `room:${source.roomId}`
  if (source.userId) return `user:${source.userId}`
  return 'unknown'
}

const formatMessages = (messages: MessageEntry[]) =>
  messages
    .map((entry) => {
      const time = new Date(entry.timestamp).toISOString()
      const user = entry.userId ?? 'unknown'
      return `${time} | ${user} | ${entry.text}`
    })
    .join('\n')

const trimCommand = (text: string, command: string) =>
  text.replace(new RegExp(`^/${command}\\s*`, 'i'), '').trim()

const safeJsonParse = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

const buildCalendarLink = (
  title: string,
  startIso: string,
  durationMinutes: number,
  location?: string | null
) => {
  const start = new Date(startIso)
  if (Number.isNaN(start.getTime())) return null
  const end = new Date(start.getTime() + durationMinutes * 60_000)
  const format = (date: Date) => date.toISOString().replace(/[-:]|\.\d{3}/g, '')
  const dates = `${format(start)}/${format(end)}`
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates
  })
  if (location) params.set('location', location)
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

export class LineWebhookService {
  private store: MessageStore
  private lineClient: LineClient
  private gemini: GeminiClient

  constructor(
    private lineConfig: LineConfig,
    private geminiConfig: GeminiConfig,
    private summaryLimit: number,
    historyLimit: number
  ) {
    this.store = new MessageStore(historyLimit)
    this.lineClient = new LineClient(lineConfig.channelAccessToken)
    this.gemini = new GeminiClient(geminiConfig)
  }

  verifySignature(rawBody: string, signature: string | undefined): boolean {
    if (!signature) return false
    const hmac = createHmac('sha256', this.lineConfig.channelSecret)
    hmac.update(rawBody)
    const digest = hmac.digest('base64')
    const expected = Buffer.from(digest)
    const received = Buffer.from(signature)
    if (expected.length !== received.length) return false
    return timingSafeEqual(expected, received)
  }

  async handleWebhook(payload: LineWebhookBody) {
    for (const event of payload.events) {
      await this.handleEvent(event)
    }
  }

  private async handleEvent(event: LineWebhookEvent) {
    if (event.type !== 'message') return
    if (!event.message || event.message.type !== 'text') return

    const text = event.message.text?.trim() ?? ''
    const conversationId = buildConversationId(event)
    const timestamp = event.timestamp ?? Date.now()

    this.store.add(conversationId, {
      userId: event.source.userId,
      text,
      timestamp
    })

    if (!event.replyToken) return

    if (/^\/summary\b/i.test(text)) {
      await this.handleSummary(event, conversationId, text)
      return
    }

    if (/^\/(event|poll)\b/i.test(text)) {
      await this.handleEventPlanner(event, conversationId, text)
      return
    }

    if (/^\/research\b/i.test(text)) {
      await this.handleResearch(event, conversationId, text)
    }
  }

  private async handleSummary(
    event: LineWebhookEvent,
    conversationId: string,
    text: string
  ) {
    const history = this.store
      .getRecent(conversationId, this.summaryLimit)
      .filter((entry) => !/^\/summary\b/i.test(entry.text))

    if (history.length === 0) {
      await this.lineClient.replyText(event.replyToken!, 'ยังไม่มีข้อความให้สรุปในตอนนี้')
      return
    }

    const prompt = [
      'คุณคือ "เลขาหน้าห้อง" ที่สรุปแชตกลุ่ม LINE ให้สั้น กระชับ และเป็นภาษาไทย',
      'ใช้เฉพาะข้อมูลที่ให้มา ห้ามเดาเพิ่ม',
      'สรุปเป็นหัวข้อสั้นๆ พร้อมหัวข้อย่อยสั้นๆ 3-7 ข้อ',
      'ปิดท้ายด้วย "ประเด็นค้าง" ถ้ามีคำถาม/การตัดสินใจที่ยังไม่ได้ข้อสรุป',
      '',
      'แชตล่าสุด:',
      formatMessages(history)
    ].join('\n')

    const summary = await this.gemini.generateText(prompt)
    const responseText = summary.trim() || 'สรุปไม่สำเร็จ ลองใหม่อีกครั้งนะ'

    await this.lineClient.replyText(event.replyToken!, responseText)
  }

  private async handleEventPlanner(
    event: LineWebhookEvent,
    conversationId: string,
    text: string
  ) {
    const history = this.store
      .getRecent(conversationId, this.summaryLimit)
      .filter((entry) => !/^\/(event|poll)\b/i.test(entry.text))

    const prompt = [
      'คุณคือผู้ช่วยจัดตารางนัดหมายจากบทสนทนาในกลุ่ม LINE',
      `ตีความวันที่/เวลาโดยอิงโซนเวลา ${this.geminiConfig.defaultTimezone}`,
      'ดึงข้อมูลที่เกี่ยวกับการนัดหมาย ถ้าไม่พอให้ใส่คำถามที่ควรถามเพิ่ม',
      'ตอบกลับเป็น JSON เท่านั้น (ห้ามใส่คำอธิบายอื่น) ตามโครงสร้าง:',
      '{',
      '  "title": string | null,',
      '  "datetime": string | null,',
      '  "durationMinutes": number | null,',
      '  "location": string | null,',
      '  "participants": string[],',
      '  "openQuestions": string[],',
      '  "pollOptions": string[]',
      '}',
      '',
      `ข้อความเรียกใช้: ${text}`,
      '',
      'บทสนทนาล่าสุด:',
      formatMessages(history)
    ].join('\n')

    const raw = await this.gemini.generateText(prompt)
    const parsed = safeJsonParse(raw)

    if (!parsed || typeof parsed !== 'object') {
      await this.lineClient.replyText(
        event.replyToken!,
        'ยังสรุปแผนการนัดหมายไม่สำเร็จ ลองพิมพ์รายละเอียดเพิ่ม เช่น วัน เวลา สถานที่'
      )
      return
    }

    const data = parsed as {
      title?: string | null
      datetime?: string | null
      durationMinutes?: number | null
      location?: string | null
      participants?: string[]
      openQuestions?: string[]
      pollOptions?: string[]
    }

    const title = data.title ?? 'นัดหมาย'
    const location = data.location ?? null
    const datetime = data.datetime ?? null
    const duration = data.durationMinutes ?? 90
    const participants = data.participants ?? []
    const openQuestions = data.openQuestions ?? []
    const pollOptions = data.pollOptions ?? []

    const calendarLink =
      datetime && duration
        ? buildCalendarLink(title, datetime, duration, location)
        : null

    const lines = [
      `หัวข้อ: ${title}`,
      datetime ? `วันเวลา: ${datetime}` : 'วันเวลา: (ยังไม่ชัดเจน)',
      location ? `สถานที่: ${location}` : 'สถานที่: (ยังไม่ชัดเจน)',
      participants.length ? `คนที่เกี่ยวข้อง: ${participants.join(', ')}` : '',
      pollOptions.length ? `ตัวเลือกโหวต: ${pollOptions.join(' | ')}` : '',
      openQuestions.length ? `ประเด็นค้าง: ${openQuestions.join(' | ')}` : ''
    ].filter(Boolean)

    if (calendarLink) {
      lines.push(`ลิงก์สร้างปฏิทิน: ${calendarLink}`)
    }

    lines.push('ถ้าต้องการให้สร้างโพลล์ใน LINE ให้ระบุรูปแบบตัวเลือกเพิ่มเติม')

    await this.lineClient.replyText(event.replyToken!, lines.join('\n'))
  }

  private async handleResearch(
    event: LineWebhookEvent,
    conversationId: string,
    text: string
  ) {
    const query = trimCommand(text, 'research')
    if (!query) {
      await this.lineClient.replyText(
        event.replyToken!,
        'พิมพ์คำถามต่อท้าย /research เช่น /research ร้านชาบูสยาม ราคาไม่เกิน 500'
      )
      return
    }

    const history = this.store.getRecent(conversationId, 30)

    const prompt = [
      'คุณคือผู้ช่วยหาข้อมูลและตัดสินใจจากบทสนทนาในกลุ่ม LINE',
      'ตอบเป็นภาษาไทย กระชับ และจัดเป็นหัวข้อ',
      'ห้ามสร้างข้อมูลอ้างอิงจากเว็บ เพราะคุณไม่มีการท่องเว็บ ให้ตอบจากความรู้ทั่วไปเท่านั้น',
      'ถ้าข้อมูลไม่พอ ให้ถามกลับอย่างน้อย 1-2 คำถามเพื่อขอรายละเอียดเพิ่ม',
      '',
      `คำถาม: ${query}`,
      '',
      'บริบทจากแชตล่าสุด (ถ้ามี):',
      formatMessages(history)
    ].join('\n')

    const response = await this.gemini.generateText(prompt)
    const answer = response.trim() || 'ยังตอบไม่ได้ ลองถามใหม่พร้อมรายละเอียดเพิ่มเติม'

    await this.lineClient.replyText(event.replyToken!, answer)
  }
}
