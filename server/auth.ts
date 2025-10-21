import type { Express } from "express";
import { createChittyAuth } from "chittyauth";
import { storage } from "./storage";
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

export { hashPassword, comparePasswords } from "chittyauth";
