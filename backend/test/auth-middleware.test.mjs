import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import jwt from "jsonwebtoken";

process.env.JWT_SECRET = "auth-middleware-test-only";
process.env.DATABASE_URL = "postgresql://127.0.0.1:1/test-only";

const { authenticateToken } = await import("../src/middleware/auth.ts");

async function requestWithToken(token) {
  const app = express();
  app.get("/protected", authenticateToken, (req, res) => {
    res.json({ user: req.user });
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/protected`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    return { response, body: await response.json() };
  } finally {
    server.close();
    await once(server, "close");
  }
}

function createToken(overrides = {}, options = { expiresIn: "5m" }) {
  return jwt.sign(
    {
      userId: "user-A",
      email: "user-a@example.invalid",
      ...overrides,
    },
    process.env.JWT_SECRET,
    options,
  );
}

test("JWT authentication rejects a missing token", async () => {
  const { response, body } = await requestWithToken();

  assert.equal(response.status, 401);
  assert.deepEqual(body, {
    success: false,
    message: "Authentication token is required",
  });
});

test("JWT authentication rejects an invalid token", async () => {
  const { response, body } = await requestWithToken("not-a-valid-token");

  assert.equal(response.status, 401);
  assert.deepEqual(body, {
    success: false,
    message: "Invalid or expired authentication token",
  });
});

test("JWT authentication rejects a signed token without required user claims", async () => {
  const tokenWithoutUserId = createToken({ userId: undefined });
  const { response, body } = await requestWithToken(tokenWithoutUserId);

  assert.equal(response.status, 401);
  assert.deepEqual(body, {
    success: false,
    message: "Invalid authentication token",
  });
});

test("JWT authentication rejects an expired token", async () => {
  const expiredToken = createToken({}, { expiresIn: -1 });
  const { response, body } = await requestWithToken(expiredToken);

  assert.equal(response.status, 401);
  assert.deepEqual(body, {
    success: false,
    message: "Invalid or expired authentication token",
  });
});

test("JWT authentication attaches the verified user to the request", async () => {
  const { response, body } = await requestWithToken(createToken());

  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    user: {
      userId: "user-A",
      email: "user-a@example.invalid",
    },
  });
});
