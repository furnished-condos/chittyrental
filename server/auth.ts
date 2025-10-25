import type { Express, Request } from "express";
import type { Router } from "express";
import {
  createChittyAuth,
  comparePasswords as comparePasswordsInternal,
} from "chittyauth";
import { storage } from "./storage";
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

export { hashPassword, comparePasswords } from "chittyauth";
