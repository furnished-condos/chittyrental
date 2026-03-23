import { Hono } from "hono";
import type { AppEnv } from "../index";

const app = new Hono<AppEnv>();

app.post("/start", (c) => c.json({ status: "not implemented" }));
app.get("/:sessionId", (c) => c.json({ status: "not implemented" }));
app.post("/:sessionId/step", (c) => c.json({ status: "not implemented" }));
app.post("/:sessionId/complete", (c) => c.json({ status: "not implemented" }));

export default app;
