import { Hono } from "hono";
import type { AppEnv } from "../index";

const app = new Hono<AppEnv>();

app.get("/", (c) => c.json({ status: "not implemented" }));
app.get("/:leaseId", (c) => c.json({ status: "not implemented" }));
app.post("/record-payment", (c) => c.json({ status: "not implemented" }));

export default app;
