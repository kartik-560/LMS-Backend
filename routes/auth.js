import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { body, validationResult } from "express-validator";
import multer from "multer";
import xlsx from "xlsx";
import { protect } from "../middleware/auth.js";
import { prisma } from "../config/prisma.js";
import { sendEmail } from "../utils/sendEmail.js";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import passport from "passport";
import expressSession from "express-session";

const router = express.Router();

passport.serializeUser((user, done) => {
  done(null, user.id); // You can store the user ID in the session
});

// Deserialize the user from the session
passport.deserializeUser(async (id, done) => {
  try {
    const user = await prisma.user.findUnique({ where: { id } });
    done(null, user); // Attach the user object to the request
  } catch (error) {
    done(error, null);
  }
});
router.use(
  expressSession({
    secret: process.env.SESSION_SECRET || "your-secret-key",
    resave: false,
    saveUninitialized: false,
    cookie: { secure: process.env.NODE_ENV === "production" },
  })
);

// Initialize Passport and session
router.use(passport.initialize());
router.use(passport.session());

// Google OAuth Strategy Setup
passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: `${process.env.APP_BASE_URL}/api/auth/google/callback`,
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        let user = await prisma.user.findUnique({
          where: { email: profile.emails[0].value },
        });

        if (!user) {
          user = await prisma.user.create({
            data: {
              fullName: profile.displayName,
              email: profile.emails[0].value,
              role: "STUDENT", // Default role for Google login
              authProvider: "google",
            },
          });
        }

        return done(null, user); // The user object is passed to the session
      } catch (error) {
        return done(error, null);
      }
    }
  )
);

// Google OAuth login route
router.get(
  "/google",
  passport.authenticate("google", {
    scope: ["profile", "email"],
  })
);

// Google OAuth callback route
router.get(
  "/google/callback",
  passport.authenticate("google", { failureRedirect: "/login" }),
  (req, res) => {
    const token = jwt.sign(
      {
        sub: req.user.id,
        role: req.user.role,
        tokenVersion: req.user.tokenVersion,
      },
      process.env.JWT_SECRET || "dev-secret",
      { expiresIn: "7d" }
    );

    res.redirect(`/dashboard?token=${token}`);
  }
);

const normalizeEmail = (e) =>
  typeof e === "string" ? e.trim().toLowerCase() : e;

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }
  next();
};

const signToken = (user) =>
  jwt.sign(
    {
      sub: user.id,
      role: user.role,
      tokenVersion: user.tokenVersion,
    },
    process.env.JWT_SECRET || "dev-secret",
    { expiresIn: "7d" }
  );

const authorize =
  (...roles) =>
  (req, res, next) => {
    if (!req.user)
      return res.status(401).json({ success: false, message: "Unauthorized" });

    const role = String(req.user.role || "").toUpperCase();
    if (!roles.map((r) => r.toUpperCase()).includes(role))
      return res.status(403).json({ success: false, message: "Forbidden" });
    next();
  };

const optionalProtect = async (req, _res, next) => {
  try {
    const hdr = req.headers.authorization || "";
    const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : null;
    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || "dev-secret");
      if (decoded?.sub) {
        const u = await prisma.user.findUnique({
          where: { id: decoded.sub },
          select: { id: true, role: true },
        });
        if (u) req.user = u;
      }
    }
  } catch (_e) {
    // ignore invalid token; route will enforce when needed
  }
  next();
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

const genOtp = () => String(Math.floor(100000 + Math.random() * 900000));
const hashOtp = async (otp) => bcrypt.hash(otp, 8);

const appBase = process.env.APP_BASE_URL || "http://localhost:5173";

const loadDepartmentCatalog = async () => {
  const rec = await prisma.setting.findUnique({
    where: { key: "departments_catalog" },
  });
  const raw = Array.isArray(rec?.value) ? rec.value : [];
  return raw.map((item) => {
    if (typeof item === "string") {
      return {
        key: item.trim().toUpperCase().replace(/\s+/g, "_"),
        name: item.trim(),
      };
    }
    return {
      key: String(item.key || item.name || "")
        .trim()
        .toUpperCase()
        .replace(/\s+/g, "_"),
      name: String(item.name || item.key || "").trim(),
    };
  });
};

router.get("/signup/departments-catalog", async (_req, res) => {
  const items = await loadDepartmentCatalog();
  return res.json({ success: true, data: { items } });
});

// Example: GET /api/colleges/:collegeId/departments

router.post("/registrations",
  [
    protect,
    authorize("SUPERADMIN"),
    body("fullName").exists().trim().isLength({ min: 2, max: 150 }),
    body("email").exists().isEmail(),
    body("role").exists().isString(),
    body("year").optional().isString(),
    body("academicYear").optional().isString(),
    body("rollNumber").optional().isString(),
    body("mobile")
      .optional({ checkFalsy: true }) // Allows the field to be empty or null
      .isMobilePhone("en-IN") // Validates as an Indian mobile number
      .withMessage("Please provide a valid 10-digit Indian mobile number"),
    // departmentId is only required for STUDENT
    body("collegeId").exists().isString(),
    body("departmentId").optional().isString(),

    body("role").custom((value, { req }) => {
      const roleUpper = String(value || "").toUpperCase();
      if (!["STUDENT", "INSTRUCTOR", "ADMIN"].includes(roleUpper)) {
        throw new Error("role must be STUDENT | INSTRUCTOR | ADMIN");
      }
      if (roleUpper === "STUDENT") {
        if (!req.body.departmentId)
          throw new Error("departmentId is required for STUDENT");
        if (!req.body.year) throw new Error("year is required for STUDENT");
        if (!req.body.academicYear)
          throw new Error("academicYear is required for STUDENT");
      }
      return true;
    }),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const roleUpper = String(req.body.role).trim().toUpperCase();

      const data = {
        fullName: String(req.body.fullName).trim(),
        email: normalizeEmail(req.body.email),
        role: roleUpper, // Registration stores uppercase roles
        collegeId: req.body.collegeId,

        // ✅ Only persist these for STUDENT; otherwise store safe empties
        year: roleUpper === "STUDENT" ? String(req.body.year) : "",
        academicYear:
          roleUpper === "STUDENT" ? String(req.body.academicYear) : "",
        rollNumber:
          roleUpper === "STUDENT" && req.body.rollNumber
            ? String(req.body.rollNumber)
            : null,

        departmentId:
          roleUpper === "STUDENT" || roleUpper === "INSTRUCTOR"
            ? String(req.body.departmentId)
            : null,

        mobile: req.body.mobile || null,

        status: "PENDING",
      };

      // Validate college
      const college = await prisma.college.findUnique({
        where: { id: data.collegeId },
      });
      if (!college)
        return res
          .status(404)
          .json({ success: false, message: "College not found" });

      // For STUDENT: ensure department belongs to this college
      if (roleUpper === "STUDENT") {
        const dept = await prisma.department.findUnique({
          where: { id: String(req.body.departmentId) },
        });
        if (!dept || dept.collegeId !== data.collegeId) {
          return res.status(400).json({
            success: false,
            message: "departmentId must belong to the selected college",
          });
        }
      }

      const created = await prisma.registration.create({ data });

      // Welcome email prompting OTP signup
      try {
        await sendEmail({
          to: data.email,
          subject: "Welcome! Complete your account",
          text: `Hi ${data.fullName}, you've been registered as ${data.role}. To activate your account, request an OTP at ${appBase}/signup.`,
          html: `<p>Hi ${data.fullName},</p>
                  <p>You’ve been registered as <b>${data.role}</b>.</p>
                  <p><a href="${appBase}/signup">Click here</a> to request an OTP and complete your account.</p>`,
        });
      } catch (e) {
        console.warn("[registrations] welcome email failed:", e?.message || e);
      }

      res.status(201).json({ success: true, data: { registration: created } });
    } catch (err) {
      if (err.code === "P2002")
        return res.status(400).json({
          success: false,
          message:
            "Registration exists for this email or (college, rollNumber)",
        });
      next(err);
    }
  }
);

router.post("/registrations/bulk",
  [protect, authorize("SUPERADMIN"), upload.single("file")],
  async (req, res) => {
    try {
      if (!req.file)
        return res
          .status(400)
          .json({ success: false, message: "File is required" });

      const wb = xlsx.read(req.file.buffer, { type: "buffer" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = xlsx.utils.sheet_to_json(ws, { defval: "" });

      const pick = (obj, keys) => {
        const map = {};
        for (const k of Object.keys(obj)) map[k.trim().toLowerCase()] = obj[k];
        for (const key of keys) {
          const v = map[key.toLowerCase()];
          if (typeof v !== "undefined") return v;
        }
        return "";
      };

      const results = [];
      for (const r of rows) {
        const fullName = String(
          pick(r, ["fullName", "fullname", "full name", "name"])
        ).trim();
        const email = normalizeEmail(
          String(pick(r, ["email", "e-mail", "mail"])).trim()
        );
        const roleUpper =
          String(pick(r, ["role"]))
            .trim()
            .toUpperCase() || "STUDENT";
        const year = String(pick(r, ["year"])).trim();

        const collegeId = String(pick(r, ["collegeId", "college id"])).trim();
        const departmentId = String(
          pick(r, ["departmentId", "department id"])
        ).trim();
        const academicYear = String(
          pick(r, ["academicYear", "academic year"])
        ).trim();
        const rollNumber = String(
          pick(r, ["rollNumber", "roll number"])
        ).trim();

        const missing =
          !fullName ||
          !email ||
          !year ||
          !collegeId ||
          !academicYear ||
          !["STUDENT", "INSTRUCTOR", "ADMIN"].includes(roleUpper) ||
          (roleUpper === "STUDENT" && !departmentId);

        if (missing) {
          results.push({
            email: email || "(missing)",
            status: "SKIPPED",
            reason: "Missing/invalid fields",
          });
          continue;
        }

        try {
          if (roleUpper === "STUDENT") {
            const dept = await prisma.department.findUnique({
              where: { id: departmentId },
            });
            if (!dept || dept.collegeId !== collegeId)
              throw new Error(
                "departmentId must belong to the selected college"
              );
          }

          await prisma.registration.create({
            data: {
              fullName,
              email,
              role: roleUpper,
              year,
              collegeId,
              departmentId: roleUpper === "STUDENT" ? departmentId : null,
              academicYear,
              rollNumber: rollNumber || null,
              status: "PENDING",
            },
          });

          try {
            await sendEmail({
              to: email,
              subject: "Welcome! Complete your account",
              text: `Hi ${fullName}, you've been registered as ${roleUpper}. Request an OTP at ${appBase}/signup to complete your account.`,
              html: `<p>Hi ${fullName},</p>
                     <p>You’ve been registered as <b>${roleUpper}</b>.</p>
                     <p><a href="${appBase}/signup">Request OTP</a> to complete your account.</p>`,
            });
          } catch (e) {
            console.warn(
              "[registrations/bulk] welcome email failed:",
              email,
              e?.message || e
            );
          }

          results.push({ email, status: "CREATED" });
        } catch (e) {
          results.push({
            email,
            status: "ERROR",
            reason:
              e?.code === "P2002"
                ? "Duplicate registration"
                : e?.message || "create failed",
          });
        }
      }

      res.json({
        success: true,
        summary: {
          total: results.length,
          created: results.filter((r) => r.status === "CREATED").length,
          skipped: results.filter((r) => r.status === "SKIPPED").length,
          errors: results.filter((r) => r.status === "ERROR").length,
        },
        results,
      });
    } catch (err) {
      res.status(500).json({
        success: false,
        message: err?.message || "Bulk registration failed",
      });
    }
  }
);

router.post("/signup/begin",
  [body("email").exists().isEmail(), handleValidationErrors],
  async (req, res) => {
    const email = normalizeEmail(req.body.email);
    const reg = await prisma.registration.findUnique({ where: { email } });
    if (!reg || !["PENDING", "VERIFIED"].includes(reg.status)) {
      return res.status(404).json({
        success: false,
        message: "Registration not found or already completed",
      });
    }

    const otp = genOtp();
    const otpHash = await hashOtp(otp);
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await prisma.registration.update({
      where: { id: reg.id },
      data: { otpHash, otpExpires, status: "PENDING" },
    });

    try {
      await sendEmail({
        to: email,
        subject: "Your OTP Code",
        text: `Your OTP is ${otp}. It expires in 10 minutes.`,
        html: `<p>Your OTP is <b>${otp}</b>. It expires in 10 minutes.</p>`,
      });
    } catch (_e) {
      return res
        .status(500)
        .json({ success: false, message: "Failed to send OTP email" });
    }

    res.json({ success: true, message: "OTP sent to email" });
  }
);

router.post("/signup/verify",
  [
    body("email").exists().isEmail(),
    body("otp").exists().isLength({ min: 6, max: 6 }),
    handleValidationErrors,
  ],
  async (req, res) => {
    const email = normalizeEmail(req.body.email);
    const { otp } = req.body;

    const reg = await prisma.registration.findUnique({
      where: { email },
      include: {
        department: true, // This will fetch the full department object
      },
    });
    if (!reg || reg.status === "COMPLETED") {
      return res.status(404).json({
        success: false,
        message: "Registration not found or already completed",
      });
    }

    if (!reg.otpHash || !reg.otpExpires || reg.otpExpires < new Date()) {
      return res.status(400).json({
        success: false,
        message: "OTP expired. Please request a new one.",
      });
    }

    const ok = await bcrypt.compare(String(otp), reg.otpHash);
    if (!ok) {
      return res.status(400).json({
        success: false,
        message: "Invalid OTP",
      });
    }

    // After OTP is verified, allow 'complete' for next 30 minutes
    const completeBy = new Date(Date.now() + 30 * 60 * 1000);

    const updated = await prisma.registration.update({
      where: { id: reg.id },
      data: {
        status: "VERIFIED",
        otpHash: null, // cannot reuse the OTP
        otpExpires: completeBy, // repurpose as "complete-by" deadline
      },
    });

    // send registration data back with response
    return res.json({
      success: true,
      message: "OTP verified. Please complete signup within 30 minutes.",
      registration: {
        id: reg.id,
        fullName: reg.fullName,
        email: reg.email,
        role: reg.role,
        collegeId: reg.collegeId,
        year: reg.year,
        mobile: reg.mobile,
        // Pass the department object itself, or just its name
        department: reg.department, // This will now be an object like { id, name, ... }
        academicYear: reg.academicYear,
        rollNumber: reg.rollNumber,
        status: reg.status,
        otpExpires: completeBy,
      },
    });
  }
);

// router.post("/signup/complete",
//   [
//     body("email").exists().isEmail(),
//     body("password").exists().isLength({ min: 6 }),
//     body("fullName").exists().isLength({ min: 2, max: 100 }),
//     body("year").optional().isString().isLength({ max: 10 }),
//     body("department").optional().isString().isLength({ max: 100 }),
//     body("mobile").optional().isString().isLength({ max: 20 }),
//     body("rollNumber").optional().isString().isLength({ max: 100 }),
//     handleValidationErrors,
//   ],
//   async (req, res) => {
//     try {
//       const normEmail = normalizeEmail(req.body.email);
//       const { password, fullName, year, department, mobile, rollNumber } = req.body;

//       const reg = await prisma.registration.findUnique({
//         where: { email: normEmail },
//       });
//       if (!reg) {
//         return res
//           .status(404)
//           .json({ success: false, message: "Registration not found" });
//       }
//       if (reg.status !== "VERIFIED") {
//         return res
//           .status(400)
//           .json({ success: false, message: "Please verify OTP first" });
//       }
//       if (!reg.otpExpires || reg.otpExpires < new Date()) {
//         return res.status(400).json({
//           success: false,
//           message: "Signup session expired. Please verify OTP again.",
//         });
//       }

//       // 2) Prevent duplicates
//       const exists = await prisma.user.findUnique({
//         where: { email: normEmail },
//       });
//       if (exists) {
//         return res
//           .status(409)
//           .json({
//             success: false,
//             message: "User already exists with this email",
//           });
//       }

//       // 3) Hash password
//       const hash = await bcrypt.hash(String(password), 10);

//       // 4) Role is determined by registration data
//       const role = String(reg.role || "student").toLowerCase();

//       // 5) Build user data
//       const userData = {
//         email: normEmail,
//         password: hash,
//         authProvider: "credentials",
//         role,
//         tokenVersion: 0,
//         isEmailVerified: true,
//         isActive: true,
//         fullName: String(fullName).trim(),
//         year: year ?? null,
//         department: department ?? null,
//         mobile: mobile ?? null,
//         rollNumber: rollNumber ?? null,
//         mustChangePassword: false,
//         permissions: {},
//       };

//       // 6) Create user + mark registration completed (transactional)
//       const result = await prisma.$transaction(async (tx) => {
//         const createdUser = await tx.user.create({
//           data: userData,
//           select: {
//             id: true,
//             email: true,
//             fullName: true,
//             role: true,
//             isActive: true,
//             permissions: true,
//             authProvider: true,
//           },
//         });

//         await tx.registration.update({
//           where: { id: reg.id },
//           data: { status: "COMPLETED" },
//         });

//         return createdUser;
//       });

//       return res.status(201).json({
//         success: true,
//         message: "Account created. Please log in to receive a token.",
//         data: { user: result },
//       });
//     } catch (err) {
//       if (err?.code === "P2002") {
//         return res
//           .status(400)
//           .json({ success: false, message: "Email already in use" });
//       }
//       return res
//         .status(500)
//         .json({ success: false, message: err?.message || "Signup failed" });
//     }
//   }
// );

router.post(
  "/register-user",
  [
    optionalProtect,
    body("fullName").exists().trim().isLength({ min: 2, max: 100 }),
    body("email").exists().isEmail(),
    body("role").exists().isString(),
    body("authProvider").optional().isString(),
    body("password").optional().isLength({ min: 6 }),
    body("year").optional().isString(),
    body("department").optional().isString(),
    body("mobile").optional().isString(),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const fullName = String(req.body.fullName).trim();
      const email = String(req.body.email || "")
        .trim()
        .toLowerCase();
      const roleLower = String(req.body.role).trim().toLowerCase();
      const authProvider = String(req.body.authProvider || "credentials")
        .trim()
        .toLowerCase();
      const password = req.body.password;

      if (roleLower !== "superadmin") {
        return res.status(400).json({
          success: false,
          message:
            "Only SUPERADMIN can be created directly. Use /api/auth/registrations + OTP for other roles.",
        });
      }
      if (authProvider === "credentials" && !password) {
        return res.status(400).json({
          success: false,
          message: "password is required for credentials authProvider",
        });
      }

      // Count existing super admins
      const saCount = await prisma.user.count({
        where: { role: "superadmin" },
      });

      if (saCount > 0) {
        // Identify the FIRST (root) super admin by earliest createdAt
        const rootSA = await prisma.user.findFirst({
          where: { role: "superadmin" },
          orderBy: { createdAt: "asc" },
          select: { id: true },
        });

        // Must be authenticated AND be the root SA
        if (!req.user) {
          return res
            .status(401)
            .json({ success: false, message: "Unauthorized" });
        }
        const isSuper =
          String(req.user.role || "").toLowerCase() === "superadmin";
        const isRoot = String(req.user.id) === String(rootSA?.id);

        if (!isSuper || !isRoot) {
          return res.status(403).json({
            success: false,
            message: "Only the first SUPERADMIN can add another SUPERADMIN",
          });
        }
      }
      // else: bootstrap mode, allowed without token

      // Email uniqueness
      const exists = await prisma.user.findUnique({ where: { email } });
      if (exists) {
        return res
          .status(400)
          .json({ success: false, message: "Email already in use" });
      }

      // Hash password if credentials
      let hash = null;
      if (authProvider === "credentials") {
        hash = await bcrypt.hash(String(password), 10);
      }

      const created = await prisma.user.create({
        data: {
          fullName,
          email,
          password: hash,
          authProvider,
          role: roleLower,
          isActive: true,
          isEmailVerified: true,
          year: req.body.year || null,
          department: req.body.department || null,
          mobile: req.body.mobile || null,
          permissions: req.body.permissions ?? {},
        },
        select: {
          id: true,
          fullName: true,
          email: true,
          role: true,
          isActive: true,
          permissions: true,
          authProvider: true,
        },
      });

      res.status(201).json({
        success: true,
        message: "User created. They must log in to receive a token.",
        data: { user: created },
      });
    } catch (err) {
      if (err?.code === "P2002") {
        return res
          .status(400)
          .json({ success: false, message: "Email already in use" });
      }
      next(err);
    }
  }
);

router.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ success: false, message: "Email and password are required" });
    }

    const user = await prisma.user.findUnique({
      where: { email: normalizeEmail(email) },
    });
    if (!user) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid credentials" });
    }

    if (user.authProvider !== "credentials" || !user.password) {
      return res.status(400).json({
        success: false,
        message: "Use your configured provider to sign in",
      });
    }

    const passwordMatches = await bcrypt.compare(password, user.password);
    if (!passwordMatches) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid credentials" });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    const token = signToken(user);

    const payload = {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      permissions: user.permissions || {},
      authProvider: user.authProvider,
    };

    res.json({ success: true, data: { user: payload, token } });
  } catch (err) {
    next(err); // Pass error to the error handler
  }
});

router.post("/logout", protect, async (req, res) => {
  await prisma.user.update({
    where: { id: req.user.id },
    data: { tokenVersion: { increment: 1 } },
  });
  res.json({ success: true, message: "Logged out" });
});

router.post(
  "/password/forgot-otp",
  [body("email").exists().isEmail(), handleValidationErrors],
  async (req, res) => {
    const email = normalizeEmail(req.body.email);

    const neutral = () =>
      res.json({
        success: true,
        message:
          "If this email is registered, an OTP has been sent and will expire in 10 minutes.",
      });

    try {
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) return neutral();

      const isCreds =
        String(user.authProvider || "credentials").toLowerCase() ===
          "credentials" && !!user.password;
      if (!isCreds) return neutral();

      const otp = genOtp();
      const otpHash = await hashOtp(otp);
      const otpExpires = new Date(Date.now() + 10 * 60 * 1000);

      await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordResetToken: otpHash,
          passwordResetExpires: otpExpires,
        },
      });

      await sendEmail({
        to: email,
        subject: "Your password reset OTP",
        text: `Your OTP is ${otp}. It expires in 10 minutes.`,
        html: `<p>Your OTP is <b>${otp}</b>. It expires in 10 minutes.</p>`,
      });

      return neutral();
    } catch (_e) {
      return neutral();
    }
  }
);

router.post(
  "/password/verify-otp",
  [
    body("email").exists().isEmail(),
    body("otp").exists().isLength({ min: 6, max: 6 }),
    handleValidationErrors,
  ],
  async (req, res) => {
    const email = normalizeEmail(req.body.email);
    const { otp } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user)
      return res
        .status(400)
        .json({ success: false, message: "Invalid OTP or email" });

    const isCreds =
      String(user.authProvider || "credentials").toLowerCase() ===
        "credentials" && !!user.password;
    if (!isCreds)
      return res
        .status(400)
        .json({ success: false, message: "Use your SSO provider to sign in" });

    if (
      !user.passwordResetToken ||
      !user.passwordResetExpires ||
      user.passwordResetExpires < new Date()
    ) {
      return res
        .status(400)
        .json({ success: false, message: "OTP expired or invalid" });
    }

    const ok = await bcrypt.compare(String(otp), user.passwordResetToken);
    if (!ok)
      return res
        .status(400)
        .json({ success: false, message: "OTP expired or invalid" });

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordResetToken: null, passwordResetExpires: null },
    });

    const resetToken = jwt.sign(
      { kind: "pwd_reset", sub: user.id, email: user.email },
      process.env.JWT_SECRET || "dev-secret",
      { expiresIn: "10m" }
    );

    return res.json({
      success: true,
      message: "OTP verified. You can now set a new password.",
      data: { token: resetToken },
    });
  }
);

router.post(
  "/password/reset-with-token",
  [
    body("token").exists().isString(),
    body("newPassword").exists().isLength({ min: 6 }),
    body("confirmPassword").exists().isLength({ min: 6 }),
    handleValidationErrors,
  ],
  async (req, res) => {
    try {
      const { token, newPassword, confirmPassword } = req.body;
      if (newPassword !== confirmPassword) {
        return res
          .status(400)
          .json({ success: false, message: "Passwords do not match" });
      }

      let decoded;
      try {
        decoded = jwt.verify(token, process.env.JWT_SECRET || "dev-secret");
      } catch {
        return res
          .status(400)
          .json({ success: false, message: "Invalid or expired token" });
      }
      if (decoded.kind !== "pwd_reset")
        return res
          .status(400)
          .json({ success: false, message: "Invalid token kind" });

      const user = await prisma.user.findUnique({ where: { id: decoded.sub } });
      if (
        !user ||
        normalizeEmail(user.email) !== normalizeEmail(decoded.email)
      ) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid or expired token" });
      }

      const isCreds =
        String(user.authProvider || "credentials").toLowerCase() ===
        "credentials";
      if (!isCreds)
        return res.status(400).json({
          success: false,
          message: "Use your SSO provider to sign in",
        });

      const hashed = await bcrypt.hash(String(newPassword), 10);
      await prisma.user.update({
        where: { id: user.id },
        data: {
          password: hashed,
        },
      });

      return res.json({
        success: true,
        message: "Password updated. Please log in.",
      });
    } catch (err) {
      return res
        .status(500)
        .json({ success: false, message: err?.message || "Reset failed" });
    }
  }
);

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
        authProvider: true,
        isEmailVerified: true,
        isActive: true,
        lastLogin: true,
        createdAt: true,
        updatedAt: true,
        permissions: true,
        year: true,
        department: true,
        mobile: true,
        collegeId: true,
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
    body("fullName").optional().trim().isLength({ min: 2, max: 100 }),
    body("email").optional().isEmail(),
    body("currentPassword").optional().isLength({ min: 6 }),
    body("newPassword").optional().isLength({ min: 6 }),
    body("year").optional().isString(),
    body("department").optional().isString(),
    body("mobile").optional().isString(),
    body("collegeId").optional().isUUID(), // ✅ validation for collegeId
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
      const me = await prisma.user.findUnique({ where: { id: req.user.id } });
      if (!me)
        return res
          .status(404)
          .json({ success: false, message: "User not found" });

      const data = {};
      const {
        fullName,
        email,
        currentPassword,
        newPassword,
        year,
        department,
        mobile,
        collegeId,
      } = req.body;

      if (
        typeof fullName === "string" &&
        fullName.trim() &&
        fullName !== me.fullName
      ) {
        data.fullName = fullName.trim();
      }

      if (email) {
        const normalized = normalizeEmail(email);
        const exists =
          normalized !== normalizeEmail(me.email) &&
          (await prisma.user.findUnique({ where: { email: normalized } }));
        if (exists)
          return res
            .status(400)
            .json({ success: false, message: "Email already in use" });
        if (normalized !== normalizeEmail(me.email)) data.email = normalized;
      }

      if (currentPassword && newPassword) {
        if (
          String(me.authProvider || "credentials").toLowerCase() !==
            "credentials" ||
          !me.password
        ) {
          return res.status(400).json({
            success: false,
            message: "Password change not allowed for non-credentials accounts",
          });
        }
        const ok = await bcrypt.compare(currentPassword, me.password);
        if (!ok)
          return res
            .status(400)
            .json({ success: false, message: "Current password is incorrect" });
        data.password = await bcrypt.hash(newPassword, 10);
      }

      if (typeof year !== "undefined") data.year = year || null;
      if (typeof department !== "undefined")
        data.department = department || null;
      if (typeof mobile !== "undefined") data.mobile = mobile || null;

      // ✅ Add support for collegeId
      if (typeof collegeId !== "undefined") {
        data.college = { connect: { id: collegeId } }; // assumes relation
      }

      if (Object.keys(data).length === 0)
        return res
          .status(400)
          .json({ success: false, message: "No changes provided" });

      const updated = await prisma.user.update({
        where: { id: req.user.id },
        data,
        select: {
          id: true,
          fullName: true,
          email: true,
          role: true,
          authProvider: true,
          isEmailVerified: true,
          isActive: true,
          lastLogin: true,
          createdAt: true,
          updatedAt: true,
          permissions: true,
          year: true,
          department: true,
          mobile: true,
          college: { select: { id: true, name: true } }, // include college info
        },
      });

      res.json({
        success: true,
        message: "Profile updated",
        data: { user: updated },
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

router.delete(
  "/me",
  [body("password").optional().isLength({ min: 6 }), handleValidationErrors],
  async (req, res, next) => {
    try {
      const me = await prisma.user.findUnique({ where: { id: req.user.id } });
      if (!me)
        return res
          .status(404)
          .json({ success: false, message: "User not found" });

      // If credentials user, require password
      if (
        String(me.authProvider || "credentials").toLowerCase() === "credentials"
      ) {
        const pwd = req.body.password;
        if (!pwd)
          return res.status(400).json({
            success: false,
            message: "Password is required to delete your account",
          });
        const ok = await bcrypt.compare(pwd, me.password || "");
        if (!ok)
          return res
            .status(400)
            .json({ success: false, message: "Password is incorrect" });
      }

      const createdCount = await prisma.course.count({
        where: { creatorId: req.user.id },
      });
      if (createdCount > 0)
        return res.status(409).json({
          success: false,
          message:
            "You are creator of courses. Reassign or delete those courses first.",
        });

      await prisma.$transaction(async (tx) => {
        await tx.assessmentAttempt.deleteMany({
          where: { studentId: req.user.id },
        });
        await tx.chapterProgress.deleteMany({
          where: { studentId: req.user.id },
        });
        await tx.courseReview.deleteMany({ where: { studentId: req.user.id } });
        await tx.enrollment.deleteMany({ where: { studentId: req.user.id } });
        await tx.user.delete({ where: { id: req.user.id } });
      });

      res.json({ success: true, message: "Account deleted successfully" });
    } catch (err) {
      if (err.code === "P2003")
        return res.status(409).json({
          success: false,
          message:
            "Cannot delete due to related data. Consider soft delete (isActive=false).",
        });
      next(err);
    }
  }
);

export default router;
