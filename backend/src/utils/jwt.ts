import jwt from "jsonwebtoken";

const JWT_SECRET: string = process.env.JWT_SECRET ?? "";

if (!JWT_SECRET) {
  throw new Error("JWT_SECRET is not defined");
}

export interface AuthTokenPayload {
  userId: string;
  email: string;
}

export function generateToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: "7d",
  });
}