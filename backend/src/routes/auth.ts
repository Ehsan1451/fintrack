import { Router } from "express";
import type { Response } from "express";
import bcrypt from "bcrypt";
import prisma from "../prisma.js";
import { generateToken } from "../utils/jwt.js";
import { authenticateToken } from "../middleware/auth.js";
import type { AuthenticatedRequest } from "../middleware/auth.js";

const router = Router();

router.post("/register", async (req, res) => {
  try {
    const { email, password, firstName, lastName } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 8 characters",
      });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    const existingUser = await prisma.user.findUnique({
      where: {
        email: normalizedEmail,
      },
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists",
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        passwordHash,
        firstName: firstName ? String(firstName).trim() : null,
        lastName: lastName ? String(lastName).trim() : null,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        createdAt: true,
      },
    });

    return res.status(201).json({
      success: true,
      message: "Account created successfully",
      user,
    });
  } catch (error) {
    console.error("Registration error:", error);

    return res.status(500).json({
      success: false,
      message: "Something went wrong while creating the account",
    });
  }
});
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    const user = await prisma.user.findUnique({
      where: {
        email: normalizedEmail,
      },
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    const passwordMatches = await bcrypt.compare(
      String(password),
      user.passwordHash
    );

    if (!passwordMatches) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

  const token = generateToken({
  userId: user.id,
  email: user.email,
});

return res.status(200).json({
  success: true,
  message: "Login successful",
  token,
  user: {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    createdAt: user.createdAt,
  },
});
  } catch (error) {
    console.error("Login error:", error);

    return res.status(500).json({
      success: false,
      message: "Something went wrong while logging in",
    });
  }
});
router.get(
  "/me",
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const user = await prisma.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        createdAt: true,
      },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    return res.status(200).json({
      success: true,
      user,
    });
  } catch (error) {
    console.error("Get current user error:", error);

    return res.status(500).json({
      success: false,
      message: "Something went wrong",
    });
  }
});
export default router;