import { Prisma } from "@prisma/client";
import { NextFunction, Request, Response } from "express";
import { HttpError } from "../utils/HttpError";

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message });
  }
  // Malformed JSON or an oversized body from express.json().
  const bodyError = err as { type?: string; status?: number };
  if (bodyError?.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Request body is not valid JSON" });
  }
  if (bodyError?.type === "entity.too.large") {
    return res.status(413).json({ error: "Request is too large" });
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") return res.status(409).json({ error: "A record with these details already exists" });
    if (err.code === "P2025") return res.status(404).json({ error: "Record not found" });
  }
  console.error(err);
  return res.status(500).json({ error: "Internal server error" });
}
