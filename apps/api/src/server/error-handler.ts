import { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

export const errorHandler = (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ZodError) {
    return res.status(400).json({ message: "Validation failed", issues: err.issues });
  }
  if (err && typeof err === "object" && "status" in err && typeof (err as { status: unknown }).status === "number") {
    const e = err as Error & { status: number };
    return res.status(e.status).json({ message: e.message || "Error" });
  }
  const message = err instanceof Error ? err.message : "Internal server error";
  return res.status(500).json({ message });
};
