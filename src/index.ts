import { Elysia } from 'elysia'
import { config } from './config.js'
import { lineWebhook } from './modules/line-webhook/index.js'

const app = new Elysia()
  .use(lineWebhook)
  .get('/health', () => ({ ok: true }))
  .listen(config.port)

console.log(`LINE webhook server running on http://localhost:${config.port}`)
