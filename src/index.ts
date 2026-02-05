import { Elysia } from "elysia";
import { lineWebhook } from "./modules/line-webhook/index.js";

new Elysia()
  .use(lineWebhook)
  .get("/health", () => ({ ok: true }))
  .listen(3000);
