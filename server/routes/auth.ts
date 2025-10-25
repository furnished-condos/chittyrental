import { Router } from "express";
import { validateCredentials, createSession, revokeSession } from "../auth";

const router = Router();

router.post("/login", async (req, res) => {
  const { email, username, password } = req.body ?? {};
  const identifier = typeof username === "string" && username.trim().length > 0
    ? username.trim()
    : typeof email === "string" ? email.trim() : "";

  if (!identifier || typeof password !== "string" || password.length === 0) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  try {
    const user = await validateCredentials(identifier, password);
    const token = await createSession(req, user);
    res.json({ user, token });
  } catch (error) {
    res.status(401).json({ error: "Invalid credentials" });
  }
});

router.post("/logout", async (req, res) => {
  await revokeSession(req);
  res.clearCookie("connect.sid");
  res.json({ success: true });
});

export default router;
