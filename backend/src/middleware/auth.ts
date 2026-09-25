import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
const JWT_SECRET: string = process.env.JWT_SECRET ?? "";

if (!JWT_SECRET) {
  throw new Error("JWT_SECRET is not defined");
}

export interface AuthenticatedRequest extends Request {
  user?: {
    userId: string;
    email: string;
  };
}

export function authenticateToken(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers.authorization;

  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.substring(7)
    : null;

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "Authentication token is required",
    });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    if (typeof decoded !== "object" || decoded === null) {
      return res.status(401).json({
        success: false,
        message: "Invalid authentication token",
      });
    }

    const { userId, email } = decoded as {
      userId?: string;
      email?: string;
    };

    if (!userId || !email) {
      return res.status(401).json({
        success: false,
        message: "Invalid authentication token",
      });
    }

    req.user = {
      userId,
      email,
    };

    next();
  } catch {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired authentication token",
    });
  }
}