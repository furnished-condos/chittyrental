import { Hono } from "hono";
import type { AppEnv } from "../index";

const app = new Hono<AppEnv>();

app.get("/", (c) => c.json({ status: "not implemented" }));
app.get("/:propertyId", (c) => c.json({ status: "not implemented" }));

export default app;
