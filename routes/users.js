// routes/auth.js
import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { body, validationResult } from "express-validator";
import multer from "multer";
import xlsx from "xlsx";
import crypto from "crypto";

import { protect } from "../middleware/auth.js";
import { prisma } from "../config/prisma.js";
import { sendEmail, sendAccountCreatedEmail } from "../utils/sendEmail.js"; // <-- use your path

const router = express.Router();

/* -------------------------------- utils -------------------------------- */
const signToken = (user) =>
  jwt.sign(
    { sub: user.id, role: user.role },
    process.env.JWT_SECRET || "dev-secret",
    { expiresIn: "7d" }
  );

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty())
    return res.status(400).json({ success: false, errors: errors.array() });
  next();
};
const normalizeEmail = (e) =>
  typeof e === "string" ? e.trim().toLowerCase() : e;

const genTempPassword = () =>
  crypto.randomBytes(6).toString("base64url").slice(0, 10);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

/* ----------------------------- PUBLIC ROUTES ---------------------------- */
router.post(
  "/register",
  [
    body("fullName")
      .exists()
      .trim()
      .isLength({ min: 2, max: 100 })
      .withMessage("fullName is required (2–100 chars)"),
    body("email").exists().isEmail().withMessage("Valid email required"),

    // password is optional — required only if sendInvite=false (self-register)
    body("password")
      .optional()
      .isLength({ min: 6 })
      .withMessage("Password must be at least 6 chars"),

    // admin can set this; default true
    body("sendInvite").optional().isBoolean(),

    // optional new fields
    body("role").optional().isString(),
    body("year").optional().isString(),
    body("branch").optional().isString(),
    body("mobile").optional().isString(),

    // custom cross-field validation
    (req, _res, next) => {
      const sendInvite =
        req.body.sendInvite !== undefined ? Boolean(req.body.sendInvite) : true;
      if (!sendInvite && !req.body.password) {
        return next({
          status: 400,
          message: "password is required when sendInvite=false",
        });
      }
      return next();
    },

    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const fullName = String(req.body.fullName).trim();
      const email = normalizeEmail(req.body.email);
      const requested = String(req.body.role || "STUDENT").toUpperCase();
      const sendInvite =
        req.body.sendInvite !== undefined ? Boolean(req.body.sendInvite) : true;

      const exists = await prisma.user.findUnique({ where: { email } });
      if (exists)
        return res
          .status(400)
          .json({ success: false, message: "Email already in use" });

      // Role gating (keep your SUPER_ADMIN-on-first-user rule)
      const userCount = await prisma.user.count();
      let finalRole;
      if (userCount === 0) {
        finalRole = requested === "SUPER_ADMIN" ? "SUPER_ADMIN" : "STUDENT";
      } else {
        const allowed = ["STUDENT", "INSTRUCTOR", "ADMIN"];
        if (!allowed.includes(requested)) {
          return res.status(400).json({
            success: false,
            message:
              "Role must be student, instructor, or admin (SUPER_ADMIN only allowed for first registered user)",
          });
        }
        finalRole = requested;
      }

      // Determine password + mustChangePassword behavior
      let rawPassword;
      let mustChangePassword;
      if (sendInvite) {
        rawPassword = genTempPassword();
        mustChangePassword = true;
      } else {
        rawPassword = String(req.body.password);
        mustChangePassword = false;
      }
      const hash = await bcrypt.hash(rawPassword, 10);


      const created = await prisma.user.create({
        data: {
          fullName,
          email,
          password: hash,
          role: finalRole,
          isActive: true,
          permissions: req.body.permissions ?? {},
          year: req.body.year || null,
          branch: req.body.branch || null,
          mobile: req.body.mobile || null,
          mustChangePassword,
          isEmailVerified: !sendInvite ? false : false, 
        },
        select: {
          id: true,
          fullName: true,
          email: true,
          role: true,
          isActive: true,
          permissions: true,
          mustChangePassword: true,
        },
      });

      // If invite mode, send the email with temp password
      let emailInfo = null;
      if (sendInvite) {
        try {
          const appBase = process.env.APP_BASE_URL || "";
          if (!appBase) {
            console.warn(
              "[register] APP_BASE_URL not set. Links may be broken in email."
            );
          }
          const loginUrl = `${appBase}/login`;
          const firstLoginUrl = `${appBase}/first-login`;

          emailInfo = await sendAccountCreatedEmail({
            to: created.email,
            name: created.fullName,
            tempPassword: rawPassword,
            loginUrl,
            firstLoginUrl,
          });
        } catch (e) {
          console.error(
            "[register] send invite email error:",
            e?.response || e?.message || e
          );
          // We keep the user created but signal email failure in response
          return res.status(201).json({
            success: true,
            data: { user: created, invited: true, emailSent: false },
            warning: "User created, but invite email failed to send.",
          });
        }
      }

      // Return
      const token = signToken(created); // keep this if you want immediate auth for self-register
      return res.status(201).json({
        success: true,
        data: {
          user: created,
          token,
          invited: sendInvite,
          emailSent: sendInvite ? true : false,
          messageId: emailInfo?.messageId || null,
          previewUrl: emailInfo?.previewUrl || null, // Ethereal dev preview
        },
      });
    } catch (err) {
      if (err.code === "P2002")
        return res
          .status(400)
          .json({ success: false, message: "Email already in use" });
      next(err);
    }
  }
);

router.post("/login", async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body.email);
    const { password } = req.body;
    if (!email || !password)
      return res
        .status(400)
        .json({ success: false, message: "email and password are required" });

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user)
      return res
        .status(401)
        .json({ success: false, message: "Invalid credentials" });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok)
      return res
        .status(401)
        .json({ success: false, message: "Invalid credentials" });

    const token = signToken(user);
    const payload = {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      permissions: user.permissions || {},
      // expose flag so client can redirect to /first-login
      mustChangePassword: !!user.mustChangePassword,
    };

    res.json({ success: true, data: { user: payload, token } });
  } catch (err) {
    next(err);
  }
});

router.post("/register-bulk", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "File is required" });

    // Validate key envs (won't block, just logs)
    const appBase = process.env.APP_BASE_URL || "";
    if (!appBase) {
      console.warn(
        "[bulk] APP_BASE_URL not set. Links in emails may be broken."
      );
    }

    const wb = xlsx.read(req.file.buffer, { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = xlsx.utils.sheet_to_json(ws, { defval: "" }); // array of objects

    const results = [];

    // Helper to get field by possible header variants (case-insensitive)
    const pick = (obj, keys) => {
      const map = {};
      for (const k of Object.keys(obj)) map[k.trim().toLowerCase()] = obj[k];
      for (const key of keys) {
        const v = map[key.toLowerCase()];
        if (typeof v !== "undefined") return v;
      }
      return "";
    };

    for (const r of rows) {
      const fullName = String(
        pick(r, ["fullName", "fullname", "full name", "name"]).trim()
      );
      const emailRaw = String(
        pick(r, ["email", "e-mail", "mail"]).trim().toLowerCase()
      );
      const role = String(pick(r, ["role"]).trim() || "student").toUpperCase();
      const branch = String(pick(r, ["branch"]).trim());
      const mobile = String(pick(r, ["mobile", "mobile no", "phone"]).trim());
      const year = String(pick(r, ["year", "class year", "yr"]).trim()); // keep as string

      if (!fullName || !emailRaw) {
        results.push({
          email: emailRaw || "(missing)",
          status: "SKIPPED",
          reason: "Missing fullName or email",
        });
        continue;
      }

      const exists = await prisma.user.findUnique({
        where: { email: emailRaw },
      });
      if (exists) {
        results.push({
          email: emailRaw,
          status: "SKIPPED",
          reason: "Email already exists",
        });
        continue;
      }

      const tempPass = genTempPassword();
      const hash = await bcrypt.hash(tempPass, 10);

      let createdUser = null;
      let emailInfo = null;

      // 1) create user
      try {
        createdUser = await prisma.user.create({
          data: {
            fullName,
            email: emailRaw,
            role,
            password: hash,
            year: year || null,
            branch: branch || null,
            mobile: mobile || null,
            mustChangePassword: true, // force reset on first login
            isEmailVerified: false,
          },
        });
      } catch (e) {
        results.push({
          email: emailRaw,
          status: "ERROR",
          step: "CREATE",
          reason: e?.message || "create failed",
        });
        continue; // skip email if create failed
      }

      // 2) send email
      try {
        const loginUrl = `${appBase}/login`;
        const firstLoginUrl = `${appBase}/first-login`;

        emailInfo = await sendAccountCreatedEmail({
          to: createdUser.email,
          name: createdUser.fullName,
          tempPassword: tempPass,
          loginUrl,
          firstLoginUrl,
        });

        results.push({
          email: emailRaw,
          status: "CREATED",
          emailSent: true,
          messageId: emailInfo?.messageId || null,
          previewUrl: emailInfo?.previewUrl || null, // will show in dev/Ethereal
        });
      } catch (e) {
        console.error(
          "[bulk] send mail error for",
          emailRaw,
          e?.response || e?.message || e
        );
        results.push({
          email: emailRaw,
          status: "CREATED", // user exists
          emailSent: false,
          step: "EMAIL",
          reason: e?.message || "email send failed",
        });
      }
    }

    res.json({
      ok: true,
      summary: {
        total: results.length,
        created: results.filter((r) => r.status === "CREATED").length,
        skipped: results.filter((r) => r.status === "SKIPPED").length,
        errors: results.filter((r) => r.status === "ERROR").length,
        emailFailures: results.filter(
          (r) => r.status === "CREATED" && r.emailSent === false
        ).length,
      },
      results,
    });
  } catch (err) {
    console.error("[bulk] fatal error:", err);
    res.status(500).json({ error: err?.message || "Bulk register failed" });
  }
});

router.post("/first-login/set-password", async (req, res) => {
  try {
    const { email, currentPassword, newPassword } = req.body;
    if (!email || !currentPassword || !newPassword)
      return res
        .status(400)
        .json({ error: "email, currentPassword, newPassword are required" });

    const user = await prisma.user.findUnique({
      where: { email: normalizeEmail(email) },
    });
    if (!user) return res.status(400).json({ error: "Invalid email" });

    if (!user.mustChangePassword)
      return res
        .status(400)
        .json({ error: "First-login password change not required" });

    const ok = await bcrypt.compare(currentPassword, user.password);
    if (!ok)
      return res.status(400).json({ error: "Current password is incorrect" });

    const hash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: hash,
        mustChangePassword: false,
        isEmailVerified: true,
      },
    });

    // Optional: notify user
    // await sendEmail({
    //   to: user.email,
    //   subject: "Password updated",
    //   text: `Hi ${user.fullName}, your password was successfully updated.`,
    //   html: `<p>Hi ${user.fullName}, your password was successfully updated.</p>`,
    // });

    res.json({ ok: true, message: "Password updated" });
  } catch (err) {
    res
      .status(500)
      .json({ error: err?.message || "Failed to update password" });
  }
});

router.use(protect);

router.get("/me", async (req, res, next) => {
  try {
    const me = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        isEmailVerified: true,
        isActive: true,
        lastLogin: true,
        createdAt: true,
        updatedAt: true,
        permissions: true,

        year: true,
        branch: true,
        mobile: true,
        mustChangePassword: true,
      },
    });
    if (!me)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    res.status(200).json({ success: true, data: { user: me } });
  } catch (err) {
    next(err);
  }
});

router.put(
  "/me",
  [
    body("fullName")
      .optional()
      .trim()
      .isLength({ min: 2, max: 100 })
      .withMessage("Full name must be between 2 and 100 characters"),
    body("email").optional().isEmail().withMessage("Provide a valid email"),
    body("currentPassword").optional().isLength({ min: 6 }),
    body("newPassword").optional().isLength({ min: 6 }),

    body("year").optional().isString(),
    body("branch").optional().isString(),
    body("mobile").optional().isString(),
    body(["currentPassword", "newPassword"]).custom((_, { req }) => {
      const { currentPassword, newPassword } = req.body;
      if (
        (currentPassword && !newPassword) ||
        (!currentPassword && newPassword)
      ) {
        throw new Error(
          "Provide both currentPassword and newPassword to change password"
        );
      }
      if (currentPassword && newPassword && currentPassword === newPassword) {
        throw new Error("New password must differ from current password");
      }
      return true;
    }),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const userId = req.user.id;
      const {
        fullName,
        email,
        currentPassword,
        newPassword,
        year,
        branch,
        mobile,
      } = req.body;

      const me = await prisma.user.findUnique({ where: { id: userId } });
      if (!me)
        return res
          .status(404)
          .json({ success: false, message: "User not found" });

      const data = {};

      if (
        typeof fullName === "string" &&
        fullName.trim() &&
        fullName !== me.fullName
      ) {
        data.fullName = fullName.trim();
      }

      if (email) {
        const normalized = normalizeEmail(email);
        if (normalized !== normalizeEmail(me.email)) {
          const exists = await prisma.user.findUnique({
            where: { email: normalized },
          });
          if (exists)
            return res
              .status(400)
              .json({ success: false, message: "Email already in use" });
          data.email = normalized;
          // Optionally: data.isEmailVerified = false;
        }
      }

      if (currentPassword && newPassword) {
        const ok = await bcrypt.compare(currentPassword, me.password);
        if (!ok)
          return res
            .status(400)
            .json({ success: false, message: "Current password is incorrect" });
        const salt = await bcrypt.genSalt(10);
        data.password = await bcrypt.hash(newPassword, salt);
      }

      // NEW editable fields
      if (typeof year !== "undefined") data.year = year || null;
      if (typeof branch !== "undefined") data.branch = branch || null;
      if (typeof mobile !== "undefined") data.mobile = mobile || null;

      if (Object.keys(data).length === 0) {
        return res
          .status(400)
          .json({ success: false, message: "No changes provided" });
      }

      const updated = await prisma.user.update({
        where: { id: userId },
        data,
        select: {
          id: true,
          fullName: true,
          email: true,
          role: true,
          isEmailVerified: true,
          isActive: true,
          lastLogin: true,
          createdAt: true,
          updatedAt: true,
          permissions: true,
          year: true,
          branch: true,
          mobile: true,
          mustChangePassword: true,
        },
      });

      res
        .status(200)
        .json({
          success: true,
          message: "Profile updated",
          data: { user: updated },
        });
    } catch (err) {
      if (err.code === "P2002") {
        return res
          .status(400)
          .json({ success: false, message: "Email already in use" });
      }
      next(err);
    }
  }
);

router.delete(
  "/me",
  [
    body("password")
      .exists()
      .withMessage("Password is required to delete your account")
      .isLength({ min: 6 })
      .withMessage("Password must be at least 6 characters"),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const userId = req.user.id;
      const { password } = req.body;

      const me = await prisma.user.findUnique({ where: { id: userId } });
      if (!me)
        return res
          .status(404)
          .json({ success: false, message: "User not found" });

      const ok = await bcrypt.compare(password, me.password);
      if (!ok)
        return res
          .status(400)
          .json({ success: false, message: "Password is incorrect" });

      const [createdCount, managedCount] = await Promise.all([
        prisma.course.count({ where: { creatorId: userId } }),
        prisma.course.count({ where: { managerId: userId } }),
      ]);
      if (createdCount > 0) {
        return res.status(409).json({
          success: false,
          message:
            "You are creator of courses. Reassign or delete those courses before deleting your account.",
        });
      }
      if (managedCount > 0) {
        return res.status(409).json({
          success: false,
          message:
            "You manage courses. Reassign manager before deleting your account.",
        });
      }

      // Atomic cleanup + delete
      await prisma.$transaction(async (tx) => {
        await tx.assessmentAttempt.deleteMany({ where: { studentId: userId } });
        await tx.chapterProgress.deleteMany({ where: { studentId: userId } });
        await tx.courseReview.deleteMany({ where: { studentId: userId } });
        await tx.enrollment.deleteMany({ where: { studentId: userId } });
        await tx.courseInstructor.deleteMany({
          where: { instructorId: userId },
        });
        await tx.user.delete({ where: { id: userId } });
      });

      res
        .status(200)
        .json({ success: true, message: "Account deleted successfully" });
    } catch (err) {
      if (err.code === "P2003") {
        return res.status(409).json({
          success: false,
          message:
            "Cannot delete account due to related data. Consider a soft delete (set isActive=false) or reassign related records.",
        });
      }
      next(err);
    }
  }
);

export default router;
