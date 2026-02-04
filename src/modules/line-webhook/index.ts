import { Elysia } from 'elysia'
import { LineWebhookBody } from './model'
import { LineWebhookService } from './service'
import { config } from '../../config'

const service = new LineWebhookService(
  {
    channelSecret: config.lineChannelSecret,
    channelAccessToken: config.lineChannelAccessToken
  },
  {
    apiKey: config.geminiApiKey,
    model: config.geminiModel,
    defaultTimezone: config.defaultTimezone
  },
  config.summaryLimit,
  config.historyLimit,
  config.conversationTtlMinutes,
  config.maxConversations
)

export const lineWebhook = new Elysia({ name: 'line-webhook' })
  .onParse(({ contentType, request }) => {
    if (contentType?.includes('application/json')) {
      return request.text()
    }
  })
  .post('/webhook/line', async ({ body, headers, set }) => {
    const rawBody = typeof body === 'string' ? body : JSON.stringify(body)
    const signature = headers['x-line-signature'] ?? headers['X-Line-Signature']

    if (!service.verifySignature(rawBody, signature)) {
      set.status = 401
      return { ok: false, error: 'Invalid signature' }
    }

    let payload: LineWebhookBody
    try {
      payload = JSON.parse(rawBody) as LineWebhookBody
    } catch {
      set.status = 400
      return { ok: false, error: 'Invalid JSON body' }
    }

    if (!payload.events || !Array.isArray(payload.events)) {
      set.status = 400
      return { ok: false, error: 'Invalid webhook payload' }
    }

    await service.handleWebhook(payload)
    return { ok: true }
  })
