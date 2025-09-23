import express from "express";
import { body, validationResult } from "express-validator";
import { prisma } from "../config/prisma.js";
import { protect } from "../middleware/auth.js";

const router = express.Router();

const normalizeEmail = (e) =>
  typeof e === "string" ? e.trim().toLowerCase() : e;

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty())
    return res.status(400).json({ success: false, errors: errors.array() });
  next();
};

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

const asIntOrNull = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Create College (SUPERADMIN) */
router.post(
  "/",
  [
    protect,
    authorize("SUPERADMIN"),
    body("name").exists().trim().isLength({ min: 2, max: 200 }),
    body("contactPerson").exists().trim().isLength({ min: 2, max: 150 }),
    body("mobileNumber").exists().trim().isLength({ min: 5, max: 20 }),
    body("email").exists().isEmail(),
    body("validity").exists().isISO8601(), // e.g. "2026-03-31"
    body("studentLimit").optional().isInt({ min: 1 }),
    body("adminLimit").optional().isInt({ min: 1 }),
    body("instructorLimit").optional().isInt({ min: 1 }),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const data = {
        name: String(req.body.name).trim(),
        contactPerson: String(req.body.contactPerson).trim(),
        mobileNumber: String(req.body.mobileNumber).trim(),
        email: normalizeEmail(req.body.email),
        validity: new Date(req.body.validity),
        studentLimit: asIntOrNull(req.body.studentLimit) ?? 1,
        adminLimit: asIntOrNull(req.body.adminLimit) ?? 1,
        instructorLimit: asIntOrNull(req.body.instructorLimit) ?? 1,
      };

      const dupe = await prisma.college.findFirst({
        where: { name: data.name, email: data.email },
      });
      if (dupe) {
        return res.status(400).json({
          success: false,
          message: "College with this name & email already exists",
        });
      }

      const created = await prisma.college.create({ data });
      res.status(201).json({ success: true, data: { college: created } });
    } catch (err) {
      next(err);
    }
  }
);

router.get("/", [protect, authorize("SUPERADMIN")], async (req, res, next) => {
  try {
    const { q, take = "50", skip = "0" } = req.query;

    const where = q
      ? {
          OR: [
            { name: { contains: String(q), mode: "insensitive" } },
            { contactPerson: { contains: String(q), mode: "insensitive" } },
            { email: { contains: String(q), mode: "insensitive" } },
            { mobileNumber: { contains: String(q), mode: "insensitive" } },
          ],
        }
      : {};

    const takeNum = Number(take) || 50;
    const skipNum = Number(skip) || 0;

    const [colleges, total] = await Promise.all([
      prisma.college.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: takeNum,
        skip: skipNum,
        select: {
          id: true,
          name: true,
          email: true,
          contactPerson: true,
          mobileNumber: true,
        },
      }),
      prisma.college.count({ where }),
    ]);

    if (colleges.length === 0) {
      return res.json({ success: true, data: { items: [], total } });
    }

    const collegeIds = colleges.map((c) => c.id);
    const collegeIdSet = new Set(collegeIds);

    // ---------- helpers ----------
    const safeParse = (v) => {
      if (typeof v === "string") {
        try { return JSON.parse(v); } catch { return v; }
      }
      return v;
    };

    // Recursively search any nested object/array for a value equal to one of our collegeIds
    const findCollegeIdInJson = (val) => {
      val = safeParse(val);
      if (!val) return null;

      if (typeof val === "string") {
        return collegeIdSet.has(val) ? val : null;
      }
      if (Array.isArray(val)) {
        for (const x of val) {
          const hit = findCollegeIdInJson(x);
          if (hit) return hit;
        }
        return null;
      }
      if (typeof val === "object") {
        // common shapes
        if (val.collegeId && collegeIdSet.has(val.collegeId)) return val.collegeId;
        if (val.collegeID && collegeIdSet.has(val.collegeID)) return val.collegeID;
        if (val.college?.id && collegeIdSet.has(val.college.id)) return val.college.id;

        for (const k of Object.keys(val)) {
          const hit = findCollegeIdInJson(val[k]);
          if (hit) return hit;
        }
      }
      return null;
    };

    // ---------- users ----------
    // Map users -> college via permissions JSON
    const users = await prisma.user.findMany({
      where: { role: { in: ["ADMIN", "INSTRUCTOR", "STUDENT"] } },
      select: {
        id: true,
        role: true,
        permissions: true,   // Json column (may be stringified/nested)
      },
    });

    const instrCount = new Map(collegeIds.map((id) => [id, 0]));
    const studAssignedCount = new Map(collegeIds.map((id) => [id, 0]));
    const userCollegeId = new Map(); // userId -> resolved collegeId

    for (const u of users) {
      const cid = findCollegeIdInJson(u.permissions);
      if (cid && collegeIdSet.has(cid)) {
        userCollegeId.set(u.id, cid);
        const role = String(u.role || "").toUpperCase();
        if (role === "INSTRUCTOR") {
          instrCount.set(cid, (instrCount.get(cid) || 0) + 1);
        } else if (role === "STUDENT") {
          studAssignedCount.set(cid, (studAssignedCount.get(cid) || 0) + 1);
        }
      }
    }

const sample = await prisma.user.findMany({
  take: 5,
  select: {
    id: true,
    role: true,
    permissions: true,
  },
});
console.log(JSON.stringify(sample, null, 2));


    const courses = await prisma.course.findMany({
      select: {
        id: true,
        title: true,
        description: true,
        thumbnail: true,
        collegeId: true,
        creatorId: true,
      },
    });

    const coursesByCollege = new Map(collegeIds.map((id) => [id, []]));
    const courseToCollege = new Map(); // courseId -> resolved collegeId

    for (const c of courses) {
      let cid = c.collegeId && collegeIdSet.has(c.collegeId) ? c.collegeId : null;

      if (!cid && c.creatorId && userCollegeId.has(c.creatorId)) {
        cid = userCollegeId.get(c.creatorId);
      }

      if (cid && coursesByCollege.has(cid)) {
        coursesByCollege.get(cid).push({
          id: c.id,
          title: c.title,
          description: c.description,
          thumbnail: c.thumbnail,
        });
        courseToCollege.set(c.id, cid);
      }
    }

    // ---------- enrollments ----------
    // Distinct enrolled students per college (via courses we just attributed)
    let enrollments = [];
    const courseIdsWeAttributed = Array.from(courseToCollege.keys());
    if (courseIdsWeAttributed.length > 0) {
      enrollments = await prisma.enrollment.findMany({
        where: { courseId: { in: courseIdsWeAttributed } },
        select: { courseId: true, studentId: true },
      });
    }

    const enrolledByCollege = new Map(collegeIds.map((id) => [id, new Set()]));
    for (const e of enrollments) {
      const cid = courseToCollege.get(e.courseId);
      if (cid && enrolledByCollege.has(cid)) {
        enrolledByCollege.get(cid).add(e.studentId);
      }
    }

    // ---------- assemble payload ----------
    const items = colleges.map((c) => {
      const cCourses = coursesByCollege.get(c.id) || [];
      const enrolledSet = enrolledByCollege.get(c.id) || new Set();

      return {
        id: c.id,
        name: c.name,
        email: c.email,
        contactPerson: c.contactPerson,
        mobileNumber: c.mobileNumber,

        instructorCount: instrCount.get(c.id) || 0,          // from permissions.collegeId
        studentCount: (studAssignedCount.get(c.id) || 0),     // assigned via permissions
        enrolledStudents: enrolledSet.size,                   // distinct enrollments

        managedCourseIds: cCourses.map((x) => x.id),
        assignedCourses: cCourses.map((x) => x.title),

        certificatesGenerated: 0, // TODO: wire to your real certificates source
      };
    });

    res.json({ success: true, data: { items, total } });
  } catch (err) {
    next(err);
  }
});


router.get("/:id",
  [protect, authorize("SUPERADMIN")],
  async (req, res, next) => {
    try {
      const college = await prisma.college.findUnique({
        where: { id: String(req.params.id) },
        include: { departments: true },
      });
      if (!college)
        return res
          .status(404)
          .json({ success: false, message: "College not found" });
      res.json({ success: true, data: { college } });
    } catch (err) {
      next(err);
    }
  }
);

/** Update College */
router.put(
  "/:id",
  [
    protect,
    authorize("SUPERADMIN"),
    body("name").optional().trim().isLength({ min: 2, max: 200 }),
    body("contactPerson").optional().trim().isLength({ min: 2, max: 150 }),
    body("mobileNumber").optional().trim().isLength({ min: 5, max: 20 }),
    body("email").optional().isEmail(),
    body("validity").optional().isISO8601(),
    body("studentLimit").optional().isInt({ min: 1 }),
    body("adminLimit").optional().isInt({ min: 1 }),
    body("instructorLimit").optional().isInt({ min: 1 }),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const update = {};
      if (typeof req.body.name === "string") update.name = req.body.name.trim();
      if (typeof req.body.contactPerson === "string")
        update.contactPerson = req.body.contactPerson.trim();
      if (typeof req.body.mobileNumber === "string")
        update.mobileNumber = req.body.mobileNumber.trim();
      if (typeof req.body.email === "string")
        update.email = normalizeEmail(req.body.email);
      if (typeof req.body.validity === "string")
        update.validity = new Date(req.body.validity);
      if (typeof req.body.studentLimit !== "undefined")
        update.studentLimit = asIntOrNull(req.body.studentLimit);
      if (typeof req.body.adminLimit !== "undefined")
        update.adminLimit = asIntOrNull(req.body.adminLimit);
      if (typeof req.body.instructorLimit !== "undefined")
        update.instructorLimit = asIntOrNull(req.body.instructorLimit);

      if (Object.keys(update).length === 0)
        return res
          .status(400)
          .json({ success: false, message: "No changes provided" });

      const college = await prisma.college.update({
        where: { id: String(req.params.id) },
        data: update,
      });

      res.json({
        success: true,
        message: "College updated",
        data: { college },
      });
    } catch (err) {
      if (err.code === "P2025")
        return res
          .status(404)
          .json({ success: false, message: "College not found" });
      next(err);
    }
  }
);

/** Delete College (cascade per schema) */
router.delete(
  "/:id",
  [protect, authorize("SUPERADMIN")],
  async (req, res, next) => {
    try {
      await prisma.college.delete({ where: { id: String(req.params.id) } });
      res.json({ success: true, message: "College deleted" });
    } catch (err) {
      if (err.code === "P2025")
        return res
          .status(404)
          .json({ success: false, message: "College not found" });
      next(err);
    }
  }
);

/** Create Department under a College */
router.post(
  "/:collegeId/departments",
  [
    protect,
    authorize("SUPERADMIN"),
    body("name").exists().trim().isLength({ min: 2, max: 150 }),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const collegeId = String(req.params.collegeId);
      const college = await prisma.college.findUnique({
        where: { id: collegeId },
      });
      if (!college)
        return res
          .status(404)
          .json({ success: false, message: "College not found" });

      // prevent obvious duplicates by name within a college
      const dup = await prisma.department.findFirst({
        where: {
          collegeId,
          name: { equals: String(req.body.name).trim(), mode: "insensitive" },
        },
      });
      if (dup) {
        return res.status(400).json({
          success: false,
          message: "Department already exists in this college",
        });
      }

      const created = await prisma.department.create({
        data: { name: String(req.body.name).trim(), collegeId },
      });

      res.status(201).json({ success: true, data: { department: created } });
    } catch (err) {
      next(err);
    }
  }
);

/** List Departments for a College */
router.get(
  "/:collegeId/departments",
  [protect, authorize("SUPERADMIN")],
  async (req, res, next) => {
    try {
      const collegeId = String(req.params.collegeId);
      const college = await prisma.college.findUnique({
        where: { id: collegeId },
      });
      if (!college)
        return res
          .status(404)
          .json({ success: false, message: "College not found" });

      const departments = await prisma.department.findMany({
        where: { collegeId },
        orderBy: { name: "asc" },
      });
      res.json({ success: true, data: { items: departments } });
    } catch (err) {
      next(err);
    }
  }
);

/** Update Department (ensuring it belongs to the college) */
router.put(
  "/:collegeId/departments/:departmentId",
  [
    protect,
    authorize("SUPERADMIN"),
    body("name").optional().trim().isLength({ min: 2, max: 150 }),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const collegeId = String(req.params.collegeId);
      const departmentId = String(req.params.departmentId);

      const dept = await prisma.department.findUnique({
        where: { id: departmentId },
      });
      if (!dept || dept.collegeId !== collegeId)
        return res.status(404).json({
          success: false,
          message: "Department not found for this college",
        });

      const update = {};
      if (typeof req.body.name === "string") update.name = req.body.name.trim();
      if (Object.keys(update).length === 0)
        return res
          .status(400)
          .json({ success: false, message: "No changes provided" });

      const updated = await prisma.department.update({
        where: { id: departmentId },
        data: update,
      });

      res.json({
        success: true,
        message: "Department updated",
        data: { department: updated },
      });
    } catch (err) {
      if (err.code === "P2025")
        return res
          .status(404)
          .json({ success: false, message: "Department not found" });
      next(err);
    }
  }
);

/** Delete Department (ensuring it belongs to the college) */
router.delete(
  "/:collegeId/departments/:departmentId",
  [protect, authorize("SUPERADMIN")],
  async (req, res, next) => {
    try {
      const collegeId = String(req.params.collegeId);
      const departmentId = String(req.params.departmentId);

      const dept = await prisma.department.findUnique({
        where: { id: departmentId },
      });
      if (!dept || dept.collegeId !== collegeId)
        return res.status(404).json({
          success: false,
          message: "Department not found for this college",
        });

      await prisma.department.delete({ where: { id: departmentId } });
      res.json({ success: true, message: "Department deleted" });
    } catch (err) {
      if (err.code === "P2025")
        return res
          .status(404)
          .json({ success: false, message: "Department not found" });
      next(err);
    }
  }
);

/** department getting route fro the admin/college */
router.get("/departments", protect, async (req, res) => {
  try {
    const setting = await prisma.setting.findUnique({
      where: { key: "departments" },
    });

    if (!setting) {
      return res.status(404).json({ error: "Departments setting not found" });
    }

    const departments = setting.value;

    res.json({ departments });
  } catch (e) {
    console.error("GET /settings/departments error:", e);
    res.status(500).json({ error: "Internal error" });
  }
});

export default router;
