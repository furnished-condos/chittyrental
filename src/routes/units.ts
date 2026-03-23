import { Hono } from "hono";
import type { AppEnv } from "../index";

const app = new Hono<AppEnv>();

app.get("/", (c) => c.json({ status: "not implemented" }));
app.get("/:id", (c) => c.json({ status: "not implemented" }));
app.post("/", (c) => c.json({ status: "not implemented" }));
app.put("/:id", (c) => c.json({ status: "not implemented" }));
app.delete("/:id", (c) => c.json({ status: "not implemented" }));

export default app;
