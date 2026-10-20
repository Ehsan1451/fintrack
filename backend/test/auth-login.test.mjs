import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import bcrypt from "bcrypt";
import express from "express";
import jwt from "jsonwebtoken";

process.env.JWT_SECRET = "auth-login-test-only";
process.env.DATABASE_URL = "postgresql://127.0.0.1:1/test-only";

const { createLoginHandler } = await import("../src/routes/auth.ts");

const loginUser = {
  id: "login-user",
  email: "user@example.invalid",
  passwordHash: await bcrypt.hash("correct-password", 4),
  firstName: "Test",
  lastName: "User",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
};

async function requestWith(database, body) {
  const app = express();
  app.use(express.json());
  app.post("/api/auth/login", createLoginHandler(database));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();

  try {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/auth/login`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    return { response, body: await response.json() };
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("login returns a verified token and public user data on success", async () => {
  const database = {
    user: {
      findUnique: async () => loginUser,
    },
  };
  const { response, body } = await requestWith(database, {
    email: " USER@example.invalid ",
    password: "correct-password",
  });

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.message, "Login successful");
  const tokenPayload = jwt.verify(body.token, process.env.JWT_SECRET);
  assert.equal(tokenPayload.userId, loginUser.id);
  assert.equal(tokenPayload.email, loginUser.email);
  assert.equal(typeof tokenPayload.iat, "number");
  assert.equal(typeof tokenPayload.exp, "number");
  assert.deepEqual(body.user, {
    id: loginUser.id,
    email: loginUser.email,
    firstName: loginUser.firstName,
    lastName: loginUser.lastName,
    createdAt: loginUser.createdAt.toISOString(),
  });
  assert.equal(Object.hasOwn(body.user, "passwordHash"), false);
});

test("login returns 401 for an unknown account or incorrect password", async () => {
  let lookupResult = null;
  const database = {
    user: {
      findUnique: async () => lookupResult,
    },
  };

  const unknownAccount = await requestWith(database, {
    email: "missing@example.invalid",
    password: "any-password",
  });
  assert.equal(unknownAccount.response.status, 401);
  assert.deepEqual(unknownAccount.body, {
    success: false,
    message: "Invalid email or password",
  });

  lookupResult = loginUser;
  const wrongPassword = await requestWith(database, {
    email: loginUser.email,
    password: "incorrect-password",
  });
  assert.equal(wrongPassword.response.status, 401);
  assert.deepEqual(wrongPassword.body, {
    success: false,
    message: "Invalid email or password",
  });
});

test("login returns a generic 500 response when the database lookup fails", async () => {
  const databaseError = new Error("sensitive database diagnostic");
  const database = {
    user: {
      findUnique: async () => {
        throw databaseError;
      },
    },
  };

  const { response, body } = await requestWith(database, {
    email: "user@example.invalid",
    password: "any-password",
  });

  assert.equal(response.status, 500);
  assert.deepEqual(body, {
    success: false,
    message: "Something went wrong while logging in",
  });
});
