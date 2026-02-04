import { t } from 'elysia'

export const LineWebhookEvent = t.Object({
  type: t.String(),
  timestamp: t.Number(),
  mode: t.Optional(t.String()),
  replyToken: t.Optional(t.String()),
  source: t.Object({
    type: t.String(),
    userId: t.Optional(t.String()),
    groupId: t.Optional(t.String()),
    roomId: t.Optional(t.String())
  }),
  message: t.Optional(
    t.Object({
      id: t.Optional(t.String()),
      type: t.String(),
      text: t.Optional(t.String())
    })
  )
})

export const LineWebhookBody = t.Object({
  destination: t.Optional(t.String()),
  events: t.Array(LineWebhookEvent)
})

export type LineWebhookBody = typeof LineWebhookBody.static
export type LineWebhookEvent = typeof LineWebhookEvent.static

export type LineTextMessage = {
  type: 'text'
  text: string
}

export type MessageEntry = {
  userId?: string
  text: string
  timestamp: number
}
