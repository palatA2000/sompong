import { Elysia } from "elysia";
import { lineWebhook } from "./modules/line-webhook/index.js";

export default new Elysia()
  .use(lineWebhook)
  .get("/health", () => ({ ok: true }));

// new Elysia()
//   .use(lineWebhook)
//   .get("/health", () => ({ ok: true }))
//   .listen(3000);
