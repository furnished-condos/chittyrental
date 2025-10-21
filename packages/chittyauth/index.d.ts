import type { Express } from "express";
import type session from "express-session";

type Awaitable<T> = T | Promise<T>;

type UserWithId = {
  id: number | string;
  [key: string]: unknown;
};

type Storage<User extends UserWithId> = {
  getUser(id: number | string): Awaitable<User | undefined | null>;
  getUserByUsername(username: string): Awaitable<User | undefined | null>;
  createUser(user: Record<string, unknown>): Awaitable<User>;
};

type SessionOptions = Omit<session.SessionOptions, "store" | "secret"> & {
  cookie?: session.CookieOptions;
};

type ChittyAuthOptions<User extends UserWithId> = {
  storage: Storage<User>;
  sessionSecret: string;
  sessionStore?: session.Store;
  sessionOptions?: SessionOptions;
};

type ChittyAuthInstance<User extends UserWithId> = {
  initialize(app: Express): void;
  router: import("express").Router;
  hashPassword(password: string): Promise<string>;
  comparePasswords(supplied: string, stored: string): Promise<boolean>;
};

export declare function createChittyAuth<User extends UserWithId>(
  options: ChittyAuthOptions<User>,
): ChittyAuthInstance<User>;

export declare function hashPassword(password: string): Promise<string>;
export declare function comparePasswords(supplied: string, stored: string): Promise<boolean>;
export type { ChittyAuthOptions, ChittyAuthInstance };
