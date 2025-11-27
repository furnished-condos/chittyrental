import type { Express } from "express";
import { randomBytes } from "crypto";
import { createChittyAuth, comparePasswords } from "chittyauth";
import { storage, type SessionRecord } from "./storage";
import type { User as SelectUser } from "@shared/schema";

declare global {
  namespace Express {
    // chittyauth returns the authenticated user without the password hash
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
    interface User extends Omit<SelectUser, "password"> {}
  }
}

export function setupAuth(app: Express) {
  const auth = createChittyAuth({
    storage,
    sessionSecret: process.env.SESSION_SECRET ?? "",
    sessionStore: storage.sessionStore,
  });

  auth.initialize(app);
}

function sanitizeUser(user: SelectUser): Omit<SelectUser, "password"> {
  const { password: _password, ...safeUser } = user;
  return safeUser;
}

export async function validateCredentials(username: string, password: string) {
  if (!username || !password) {
    throw new Error("Invalid credentials");
  }

  const user = await storage.getUserByUsername(username);
  if (!user) {
    throw new Error("Invalid credentials");
  }

  const passwordMatches = await comparePasswords(password, user.password);
  if (!passwordMatches) {
    throw new Error("Invalid credentials");
  }

  return sanitizeUser(user);
}

export async function createSession(user: Omit<SelectUser, "password">) {
  const token = randomBytes(32).toString("hex");
  const session: SessionRecord = {
    token,
    user,
    createdAt: new Date(),
  };

  await storage.saveSession(session);
  return session;
}

export async function revokeSession(token: string) {
  if (!token) return;
  await storage.deleteSession(token);
}

export { hashPassword, comparePasswords } from "chittyauth";
