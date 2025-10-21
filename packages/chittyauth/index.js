import session from "express-session";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Router } from "express";
import { randomBytes, scrypt as nodeScrypt, timingSafeEqual } from "crypto";
import { promisify } from "util";

const scryptAsync = promisify(nodeScrypt);

async function hashPasswordInternal(password) {
  if (typeof password !== "string" || password.length === 0) {
    throw new Error("chittyauth: password must be a non-empty string");
  }

  const salt = randomBytes(16).toString("hex");
  const buf = await scryptAsync(password, salt, 64);
  return `${buf.toString("hex")}.${salt}`;
}

async function comparePasswordsInternal(supplied, stored) {
  if (typeof supplied !== "string" || typeof stored !== "string") {
    return false;
  }

  const [hashed, salt] = stored.split(".");
  if (!hashed || !salt) {
    return false;
  }

  const hashedBuf = Buffer.from(hashed, "hex");
  const suppliedBuf = await scryptAsync(supplied, salt, 64);

  if (hashedBuf.length !== suppliedBuf.length) {
    return false;
  }

  return timingSafeEqual(hashedBuf, suppliedBuf);
}

function sanitizeUser(user) {
  if (!user || typeof user !== "object") {
    return user;
  }

  const { password, ...rest } = user;
  return rest;
}

export async function hashPassword(password) {
  return hashPasswordInternal(password);
}

export async function comparePasswords(supplied, stored) {
  return comparePasswordsInternal(supplied, stored);
}

export function createChittyAuth(options) {
  if (!options || typeof options !== "object") {
    throw new TypeError("chittyauth: options are required");
  }

  const {
    storage,
    sessionSecret,
    sessionStore,
    sessionOptions = {},
  } = options;

  if (!sessionSecret || typeof sessionSecret !== "string" || sessionSecret.length < 32) {
    throw new Error(
      "chittyauth: SESSION_SECRET must be provided and contain at least 32 characters",
    );
  }

  if (!storage ||
      typeof storage.getUser !== "function" ||
      typeof storage.getUserByUsername !== "function" ||
      typeof storage.createUser !== "function") {
    throw new Error("chittyauth: storage must provide getUser, getUserByUsername, and createUser methods");
  }

  const router = Router();
  let initialized = false;

  passport.use(
    new LocalStrategy(async (username, password, done) => {
      try {
        const user = await storage.getUserByUsername(username);
        if (!user) {
          return done(null, false, { message: "Invalid username or password" });
        }

        const match = await comparePasswordsInternal(password, user.password);
        if (!match) {
          return done(null, false, { message: "Invalid username or password" });
        }

        return done(null, sanitizeUser(user));
      } catch (error) {
        return done(error);
      }
    }),
  );

  passport.serializeUser((user, done) => {
    if (!user || typeof user !== "object" || typeof user.id === "undefined") {
      return done(new Error("chittyauth: cannot serialize user without an id"));
    }

    done(null, user.id);
  });

  passport.deserializeUser(async (id, done) => {
    try {
      const user = await storage.getUser(Number(id));
      if (!user) {
        return done(null, false);
      }

      done(null, sanitizeUser(user));
    } catch (error) {
      done(error);
    }
  });

  router.post("/register", async (req, res, next) => {
    try {
      const { username, password, ...rest } = req.body ?? {};
      if (!username || !password) {
        return res.status(400).json({ message: "Username and password are required" });
      }

      const existingUser = await storage.getUserByUsername(username);
      if (existingUser) {
        return res.status(409).json({ message: "Username already exists" });
      }

      const hashedPassword = await hashPasswordInternal(password);
      const user = await storage.createUser({
        ...rest,
        username,
        password: hashedPassword,
      });

      const safeUser = sanitizeUser(user);
      req.login(safeUser, (err) => {
        if (err) {
          return next(err);
        }

        return res.status(201).json(safeUser);
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/login", (req, res, next) => {
    passport.authenticate("local", (err, user, info) => {
      if (err) {
        return next(err);
      }

      if (!user) {
        return res.status(401).json({ message: info?.message ?? "Authentication failed" });
      }

      req.login(user, (loginErr) => {
        if (loginErr) {
          return next(loginErr);
        }

        return res.status(200).json(user);
      });
    })(req, res, next);
  });

  router.post("/logout", (req, res, next) => {
    req.logout((err) => {
      if (err) {
        return next(err);
      }

      if (req.session) {
        req.session.destroy(() => res.sendStatus(204));
      } else {
        res.sendStatus(204);
      }
    });
  });

  router.get("/user", (req, res) => {
    if (!req.isAuthenticated || !req.isAuthenticated()) {
      return res.sendStatus(401);
    }

    res.json(req.user ?? null);
  });

  return {
    initialize(app) {
      if (initialized) {
        return;
      }

      if (!app || typeof app.use !== "function") {
        throw new TypeError("chittyauth: app must be an Express application");
      }

      const { cookie: userCookieOptions, ...restSessionOptions } = sessionOptions;
      const baseSessionOptions = {
        secret: sessionSecret,
        resave: false,
        saveUninitialized: false,
        store: sessionStore,
        cookie: {
          httpOnly: true,
          sameSite: "lax",
          secure: process.env.NODE_ENV === "production",
          maxAge: 30 * 24 * 60 * 60 * 1000,
          ...userCookieOptions,
        },
        ...restSessionOptions,
      };

      if (!baseSessionOptions.store) {
        delete baseSessionOptions.store;
      }

      app.set("trust proxy", 1);
      app.use(session(baseSessionOptions));
      app.use(passport.initialize());
      app.use(passport.session());
      app.use("/api", router);

      initialized = true;
    },
    router,
    hashPassword: hashPasswordInternal,
    comparePasswords: comparePasswordsInternal,
  };
}
