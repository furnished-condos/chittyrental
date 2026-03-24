import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { AppEnv } from "../index";
import { getDb } from "../db";
import { crSetupSessions } from "../db/schema";

const app = new Hono<AppEnv>();

// Create a new setup session
app.post("/start", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const body = await c.req.json<{
    property_id?: string;
    portfolio_id?: string;
    session_type: string;
    current_step?: string;
    state?: unknown;
  }>();

  const [created] = await db
    .insert(crSetupSessions)
    .values({
      property_id: body.property_id,
      portfolio_id: body.portfolio_id,
      session_type: body.session_type,
      current_step: body.current_step ?? "start",
      state: body.state ?? {},
      completed_steps: [],
      status: "in_progress",
    })
    .returning();

  return c.json({ data: created }, 201);
});

// Get session
app.get("/:sessionId", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const sessionId = c.req.param("sessionId");

  const [session] = await db
    .select()
    .from(crSetupSessions)
    .where(eq(crSetupSessions.id, sessionId))
    .limit(1);

  if (!session) return c.json({ error: "Session not found" }, 404);
  return c.json({ data: session });
});

// Update step — advance the wizard
app.post("/:sessionId/step", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const sessionId = c.req.param("sessionId");
  const body = await c.req.json<{
    current_step: string;
    state?: unknown;
    ai_suggestions?: unknown;
  }>();

  const [session] = await db
    .select()
    .from(crSetupSessions)
    .where(eq(crSetupSessions.id, sessionId))
    .limit(1);

  if (!session) return c.json({ error: "Session not found" }, 404);
  if (session.status !== "in_progress") {
    return c.json({ error: "Session is not in progress" }, 400);
  }

  // Add previous step to completed list
  const completedSteps = (session.completed_steps as string[]) ?? [];
  if (session.current_step && !completedSteps.includes(session.current_step)) {
    completedSteps.push(session.current_step);
  }

  // Merge state
  const existingState =
    (session.state as Record<string, unknown>) ?? {};
  const newState = body.state
    ? { ...existingState, ...(body.state as Record<string, unknown>) }
    : existingState;

  const [updated] = await db
    .update(crSetupSessions)
    .set({
      current_step: body.current_step,
      completed_steps: completedSteps,
      state: newState,
      ai_suggestions: body.ai_suggestions ?? session.ai_suggestions,
      updated_at: new Date(),
    })
    .where(eq(crSetupSessions.id, sessionId))
    .returning();

  return c.json({ data: updated });
});

// Complete session
app.post("/:sessionId/complete", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const sessionId = c.req.param("sessionId");

  const [session] = await db
    .select()
    .from(crSetupSessions)
    .where(eq(crSetupSessions.id, sessionId))
    .limit(1);

  if (!session) return c.json({ error: "Session not found" }, 404);
  if (session.status !== "in_progress") {
    return c.json({ error: "Session is not in progress" }, 400);
  }

  // Mark current step as completed
  const completedSteps = (session.completed_steps as string[]) ?? [];
  if (session.current_step && !completedSteps.includes(session.current_step)) {
    completedSteps.push(session.current_step);
  }

  const [updated] = await db
    .update(crSetupSessions)
    .set({
      status: "completed",
      completed_steps: completedSteps,
      updated_at: new Date(),
    })
    .where(eq(crSetupSessions.id, sessionId))
    .returning();

  return c.json({ data: updated });
});

export default app;
