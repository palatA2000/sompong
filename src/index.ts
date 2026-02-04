import { Elysia } from "elysia";
import { config } from "./config.js";
import { lineWebhook } from "./modules/line-webhook/index.js";

export default new Elysia()
  .use(lineWebhook)
  .get("/health", () => ({ ok: true }))
  .listen(config.port);
