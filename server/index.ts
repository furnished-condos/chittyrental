import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { storage } from "./storage";
import { UserRole } from "../shared/schema";
import { hashPassword } from "chittyauth";

export const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Add request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

// Function to create default admin user
async function createDefaultAdminUser() {
  const username = process.env.DEFAULT_ADMIN_USERNAME;
  const password = process.env.DEFAULT_ADMIN_PASSWORD;

  if (!username || !password) {
    log("Skipping default admin bootstrap. Provide DEFAULT_ADMIN_USERNAME and DEFAULT_ADMIN_PASSWORD to enable it.");
    return;
  }

  try {
    const existingUser = await storage.getUserByUsername(username);

    if (existingUser) {
      log(`Admin user ${username} already exists.`);
      return;
    }

    const hashedPassword = await hashPassword(password);

    await storage.createUser({
      username,
      password: hashedPassword,
      role: UserRole.MANAGER,
      full_name: "Admin User",
      email: "admin@example.com",
      fullName: 'Admin User',
      email: 'admin@example.com'
    });

    log("Default admin user created successfully.");
  } catch (error) {
    log(`Error creating default admin user: ${error}`);
  }
}

// Handle process termination gracefully
let server: any;

async function shutdown() {
  if (server) {
    await new Promise((resolve) => {
      server.close(resolve);
    });
    log('Server shut down gracefully');
    process.exit(0);
  }
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

(async () => {
  try {
    // Create default admin user
    await createDefaultAdminUser();
    
    server = await registerRoutes(app);

    // Global error handler
    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";
      log(`Error: ${message}`);
      res.status(status).json({ message });
    });

    if (app.get("env") === "development") {
      await setupVite(app, server);
    } else {
      serveStatic(app);
    }

    // Use port 5000 for Replit compatibility
    const port = process.env.PORT || 5000;
    server.listen({
      port,
      host: "0.0.0.0",
    }, () => {
      log(`Server started successfully on port ${port}`);
    });
  } catch (error) {
    log(`Failed to start server: ${error}`);
    process.exit(1);
  }
})();