import { Request, Response } from "express";

export async function login(_req: Request, res: Response) {
  res.status(501).json({ error: "Legacy auth controller is not implemented. Use /api/login." });
}
