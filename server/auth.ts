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

declare module "express-session" {
  interface SessionData {
    userId?: number | string;
    token?: string;
  }
}

type SafeUser = Omit<SelectUser, "password">;

let authInstance: ReturnType<typeof createChittyAuth<SelectUser>> | null = null;

export function setupAuth(app: Express) {
  if (!authInstance) {
    authInstance = createChittyAuth({
      storage,
      sessionSecret: process.env.SESSION_SECRET ?? "",
      sessionStore: storage.sessionStore,
    });
  }

  authInstance.initialize(app);
  removeRoute(authInstance.router, "/login", "post");
  removeRoute(authInstance.router, "/logout", "post");
}

export async function validateCredentials(
  identifier: string,
  password: string,
): Promise<SafeUser> {
  if (!identifier || !password) {
    throw new Error("Invalid credentials");
  }

  const user = await storage.getUserByUsername(identifier);
  if (!user) {
    throw new Error("Invalid credentials");
  }

  const isValid = await comparePasswordsInternal(password, user.password);
  if (!isValid) {
    throw new Error("Invalid credentials");
  }

  const { password: _pw, ...safeUser } = user;
  return safeUser;
}

export async function createSession(req: Request, user: SafeUser): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) {
        reject(err);
        return;
      }

      req.login(user, (loginErr) => {
        if (loginErr) {
          reject(loginErr);
          return;
        }

        req.session.userId = user.id;
        req.session.token = req.sessionID;
        req.session.save((saveErr) => {
          if (saveErr) {
            reject(saveErr);
            return;
          }

          resolve();
        });
      });
    });
  });

  return req.sessionID;
}

export async function revokeSession(req: Request): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    if (!req.session) {
      resolve();
      return;
    }

    req.logout((logoutErr) => {
      if (logoutErr) {
        reject(logoutErr);
        return;
      }

      req.session.destroy((err) => {
        if (err) {
          reject(err);
          return;
        }

        resolve();
      });
    });
  });
}

function removeRoute(router: Router, path: string, method: string) {
  const stack = (router as Router & { stack?: any[] }).stack;
  if (!Array.isArray(stack)) {
    return;
  }

  (router as any).stack = stack.filter((layer) => {
    const route = layer?.route;
    if (!route) {
      return true;
    }

    const matchesPath = route.path === path;
    const matchesMethod = Boolean(route.methods?.[method]);
    return !(matchesPath && matchesMethod);
  });
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
