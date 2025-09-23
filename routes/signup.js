import express from "express";
import { body } from "express-validator";
import { handleValidationErrors } from "../utils/validationHelpers.js"; // Assuming you have this helper for validation errors

import { prisma } from "../config/prisma.js";
import bcrypt from "bcryptjs";

const router = express.Router();

// Your existing signup complete route
router.post(
  "/signup/complete",
  [
    body("email").exists().isEmail(),
    body("password").exists().isLength({ min: 6 }),
    body("fullName").exists().isLength({ min: 2, max: 100 }),
    body("year").optional().isString().isLength({ max: 10 }),
    body("branch").optional().isString().isLength({ max: 100 }),
    body("mobile").optional().isString().isLength({ max: 20 }),
    // body("rollNumber").optional().isString().isLength({ max: 100 }), // For students
    handleValidationErrors,
  ],
  async (req, res) => {
    try {
      const normEmail = req.body.email.toLowerCase();
      const { password, fullName, year, branch, mobile, rollNumber } = req.body;

      // Ensure there is a verified registration session still valid
      const reg = await prisma.registration.findUnique({
        where: { email: normEmail },
      });
      if (!reg) {
        return res
          .status(404)
          .json({ success: false, message: "Registration not found" });
      }
      if (reg.status !== "VERIFIED") {
        return res
          .status(400)
          .json({ success: false, message: "Please verify OTP first" });
      }
      //   if (!reg.otpExpires || reg.otpExpires < new Date()) {
      //     return res.status(400).json({
      //       success: false,
      //       message: "Signup session expired. Please verify OTP again.",
      //     });
      //   }

      // Prevent duplicates
      const exists = await prisma.user.findUnique({
        where: { email: normEmail },
      });
      if (exists) {
        return res.status(409).json({
          success: false,
          message: "User already exists with this email",
        });
      }

      // Hash password
      const hash = await bcrypt.hash(password, 10);

      // Role is determined by registration data
      const role = reg.role.toLowerCase();

      // Build user data
      const userData = {
        email: normEmail,
        password: hash,
        authProvider: "credentials",
        role,
        tokenVersion: 0,
        isEmailVerified: true,
        isActive: true,
        fullName: fullName.trim(),
        year: year || null,
        branch: branch || null,
        mobile: mobile || null,
        // rollNumber: rollNumber || null,
        mustChangePassword: false,
        permissions: {},
      };

      // Create user and mark registration completed (transactional)
      const result = await prisma.$transaction(async (tx) => {
        const createdUser = await tx.user.create({
          data: userData,
          select: {
            id: true,
            email: true,
            fullName: true,
            role: true,
            isActive: true,
            permissions: true,
            authProvider: true,
          },
        });

        await tx.registration.update({
          where: { id: reg.id },
          data: { status: "COMPLETED" },
        });

        return createdUser;
      });

      return res.status(201).json({
        success: true,
        message: "Account created. Please log in to receive a token.",
        data: { user: result },
      });
    } catch (err) {
      if (err?.code === "P2002") {
        return res
          .status(400)
          .json({ success: false, message: "Email already in use" });
      }
      return res
        .status(500)
        .json({ success: false, message: err?.message || "Signup failed" });
    }
  }
);

export default router;
