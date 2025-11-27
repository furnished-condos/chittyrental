import { Router } from "express";
import { validateCredentials, createSession, revokeSession } from "../auth";

const router = Router();

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = await validateCredentials(username, password);
    const session = await createSession(user);
    res.json({ user, token: session.token });
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
