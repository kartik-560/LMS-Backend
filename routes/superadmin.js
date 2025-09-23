import express from "express";
import { prisma } from "../config/prisma.js";

const router = express.Router();

const up = (s) => String(s || "").toUpperCase();
const isSuperAdmin = (u) => up(u?.role) === "SUPERADMIN";
const isCollegeAdmin = (u) => up(u?.role) === "ADMIN";

const effectiveCollegeId = (u) =>
  u?.collegeId || u?.permissions?.collegeId || null;

const collegeScope = (user) => {
  if (isSuperAdmin(user)) return {};
  const cid = effectiveCollegeId(user);
  if (!cid) return {};
  // If you store collegeId on users table, the first clause works.
  // If you also keep it inside JSON `permissions.collegeId`, the second covers that.
  return {
    OR: [
      { collegeId: cid },
      { permissions: { path: ["collegeId"], equals: cid } }, // Postgres JSONB path
    ],
  };
};

const toUserPayload = (u) => ({
  id: u.id,
  name: u.fullName ?? u.name ?? "",
  email: u.email ?? "",
  role: String(u.role ?? "").toLowerCase(), // "admin" | "instructor" | "superadmin"
  isActive: !!u.isActive,
  permissions: u.permissions ?? {},
});

const toCoursePayload = (c) => ({
  id: c.id,
  title: c.title,
  thumbnail: c.thumbnail,
  status: c.status,
  creatorId: c.creatorId,
  category: c.category ?? null,
  description: c.description ?? null,
  createdAt: c.createdAt,
  updatedAt: c.updatedAt,
});

// --- auth helpers ---
function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    if (up(req.user.role) !== up(role)) {
      return res
        .status(403)
        .json({ error: `Forbidden: You need ${role} role` });
    }
    next();
  };
}

function requireAnyRole(...roles) {
  const want = roles.map(up);
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    const have = up(req.user.role);
    if (!want.includes(have)) {
      return res
        .status(403)
        .json({ error: `Forbidden: You need one of ${roles.join(", ")}` });
    }
    next();
  };
}
async function fetchAllUsersMinimal() {
  const rows = await prisma.user.findMany({
    select: {
      id: true,
      fullName: true,
      email: true,
      role: true,
      isActive: true,
      permissions: true,
      collegeId: true, // optional but useful for scoping/debug
    },
    orderBy: [{ fullName: "asc" }],
  });
  console.log("[users] total:", rows.length);
  return rows;
}

async function assertAdminBelongsToCollege(user, collegeId) {
  if (!isCollegeAdmin(user)) return false;
  return String(user.collegeId) === String(collegeId);
}

function requireSuperAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });
  if (!isSuperAdmin(req.user))
    return res.status(403).json({ error: "Forbidden" });
  next();
}

// --- overview (SUPERADMIN only) ---
router.get("/overview", requireSuperAdmin, async (_req, res) => {
  const [users, totalCourses] = await Promise.all([
    prisma.user.findMany({ select: { role: true, isActive: true } }),
    prisma.course.count(),
  ]);

  const counts = (role) => users.filter((u) => up(u.role) === role).length;
  const totalSuperAdmins = counts("SUPERADMIN");
  const totalAdmins = counts("ADMIN");
  const totalInstructors = counts("INSTRUCTOR");
  const totalStudents = counts("STUDENT");
  const activeUsers = users.filter((u) => u.isActive).length;
  const totalColleges = await prisma.college.count();

  const courseRows = await prisma.course.findMany({
    select: {
      id: true,
      title: true,
      status: true,
      enrollments: { select: { id: true } },
      CoursesAssigned: { select: { id: true } },
      reviews: { select: { rating: true } },
    },
  });

  const courseBreakdown = {};
  for (const c of courseRows) {
    const ratings = c.reviews.map((r) => r.rating);
    const avgRating = ratings.length
      ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) /
        10
      : null;
    courseBreakdown[c.id] = {
      title: c.title,
      status: c.status,
      students: c.enrollments.length,
      assignedColleges: c.CoursesAssigned.length,
      avgRating,
    };
  }

  const [completedChapters, totalChapters] = await Promise.all([
    prisma.chapterProgress.count({ where: { isCompleted: true } }),
    prisma.chapterProgress.count(),
  ]);
  const avgCourseCompletion =
    totalChapters === 0
      ? 0
      : Math.round((completedChapters / totalChapters) * 100);

  res.json({
    data: {
      overview: {
        totalAdmins,
        totalSuperAdmins,
        totalInstructors,
        totalStudents,
        totalCourses,
        activeUsers,
        totalColleges,
        avgCourseCompletion,
      },
      courseBreakdown,
    },
  });
});

router.get(
  "/admins",
  requireAnyRole("SUPERADMIN", "ADMIN"),
  async (req, res, next) => {
    try {
      const all = await fetchAllUsersMinimal();

      // role filter in JS (robust to case/whitespace)
      let list = all.filter(
        (u) =>
          String(u.role || "")
            .trim()
            .toLowerCase() === "admin"
      );

      if (!isSuperAdmin(req.user)) {
        const cid = effectiveCollegeId(req.user);
        if (cid) {
          list = list.filter(
            (u) => u.collegeId === cid || u?.permissions?.collegeId === cid
          );
        }
      }

      console.log(
        "[admins] count:",
        list.length,
        "req.user.role:",
        req?.user?.role,
        "cid:",
        effectiveCollegeId(req.user)
      );
      return res.json(list.map(toUserPayload));
    } catch (err) {
      return next(err);
    }
  }
);

// ---------- Instructors ----------
router.get(
  "/instructors",
  requireAnyRole("SUPERADMIN", "ADMIN"),
  async (req, res, next) => {
    try {
      const all = await fetchAllUsersMinimal();

      let list = all.filter(
        (u) =>
          String(u.role || "")
            .trim()
            .toLowerCase() === "instructor"
      );

      if (!isSuperAdmin(req.user)) {
        const cid = effectiveCollegeId(req.user);
        if (cid) {
          list = list.filter(
            (u) => u.collegeId === cid || u?.permissions?.collegeId === cid
          );
        }
      }

      console.log(
        "[instructors] count:",
        list.length,
        "req.user.role:",
        req?.user?.role,
        "cid:",
        effectiveCollegeId(req.user)
      );
      return res.json(list.map(toUserPayload));
    } catch (err) {
      return next(err);
    }
  }
);

router.get(
  "/students",
  requireAnyRole("SUPERADMIN", "ADMIN"),
  async (req, res) => {
    const whereBase = isSuperAdmin(req.user)
      ? { role: { equals: "STUDENT", mode: "insensitive" } }
      : {
          role: { equals: "STUDENT", mode: "insensitive" },
          collegeId: req.user.collegeId,
        };

    const rows = await prisma.user.findMany({
      where: whereBase,
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        isActive: true,
        permissions: true,
        enrollments: { select: { courseId: true } },
      },
      orderBy: { fullName: "asc" },
    });

    const data = rows.map((u) => ({
      ...toUserPayload(u),
      assignedCourses: u.enrollments?.map((e) => e.courseId) ?? [],
    }));

    res.json({ data });
  }
);

router.get(
  "/students/:departmentId",
  requireRole("INSTRUCTOR"),
  async (req, res) => {
    const departmentId = req.params.departmentId;
    const instructorId = req.user.id;

    const courses = await prisma.coursesAssigned.findMany({
      where: { departmentId },
      select: { courseId: true },
    });

    const courseIds = courses.map((c) => c.courseId);

    const students = await prisma.enrollment.findMany({
      where: { courseId: { in: courseIds } },
      select: { studentId: true, courseId: true },
    });

    const studentIds = students.map((s) => s.studentId);

    const studentDetails = await prisma.user.findMany({
      where: { id: { in: studentIds } },
      select: { id: true, fullName: true, email: true },
    });

    res.json(studentDetails);
  }
);

router.patch("/users/:id/permissions", requireSuperAdmin, async (_req, res) => {
  return res
    .status(501)
    .json({ error: "Permissions not supported on User model" });
});

router.post("/users/bulk-update", requireSuperAdmin, async (req, res) => {
  const { ids, data } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0)
    return res.status(400).json({ error: "ids required" });
  const result = await prisma.user.updateMany({
    where: { id: { in: ids } },
    data,
  });
  res.json({ count: result.count });
});

router.delete("/users/:id", requireSuperAdmin, async (req, res) => {
  const { id } = req.params;

  const createdCount = await prisma.course.count({ where: { creatorId: id } });
  if (createdCount > 0) {
    return res.status(400).json({
      error:
        "User is creator of courses. Reassign or delete those courses first.",
    });
  }

  await prisma.assessmentAttempt.deleteMany({ where: { studentId: id } });
  await prisma.chapterProgress.deleteMany({ where: { studentId: id } });
  await prisma.courseReview.deleteMany({ where: { studentId: id } });
  await prisma.enrollment.deleteMany({ where: { studentId: id } });

  await prisma.user.delete({ where: { id } });
  res.json({ ok: true });
});

router.get("/courses", async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    const role = up(req.user.role);
    const {
      view = role === "STUDENT" ? "enrolled" : "catalog",
      collegeId, // optional for superadmin, required for others (or pulled from user if present)
      search,
      status,
      category,
      page = "1",
      pageSize = "20",
    } = req.query;

    const p = Math.max(parseInt(String(page), 10) || 1, 1);
    const ps = Math.min(Math.max(parseInt(String(pageSize), 10) || 20, 1), 100);

    const baseSelect = {
      id: true, title: true, thumbnail: true, status: true,
      creatorId: true, category: true, description: true,
      createdAt: true, updatedAt: true,
    };

    const commonFilter = {
      AND: [
        search ? { title: { contains: String(search), mode: "insensitive" } } : {},
        status ? { status: String(status) } : {},
        category ? { category: String(category) } : {},
      ],
    };

    // ---------- SUPERADMIN: see all courses; can optionally filter by collegeId ----------
    if (role === "SUPERADMIN") {
      const where = {
        ...commonFilter,
        ...(collegeId ? { CoursesAssigned: { some: { collegeId: String(collegeId) } } } : {}),
      };

      const [rows, total] = await Promise.all([
        prisma.course.findMany({
          where, select: baseSelect, orderBy: { createdAt: "desc" }, skip: (p - 1) * ps, take: ps,
        }),
        prisma.course.count({ where }),
      ]);

      return res.json({
        page: p, pageSize: ps, total, data: rows.map(toCoursePayload),
      });
    }

    // ---------- NON-SUPERADMIN: require a college context ----------
    // Resolve college for ADMIN/INSTRUCTOR/STUDENT: prefer query, else user.collegeId
    const resolvedCollegeId = String(collegeId || req.user.collegeId || "");
    if (!resolvedCollegeId) {
      return res.status(400).json({ error: "collegeId is required for this role" });
    }

    if (role === "STUDENT") {
      const sid = String(req.user.id);

      if (view === "catalog") {
        const where = {
          ...commonFilter,
          CoursesAssigned: { some: { collegeId: resolvedCollegeId } },
        };
        const [rows, total] = await Promise.all([
          prisma.course.findMany({
            where, select: baseSelect, orderBy: { createdAt: "desc" }, skip: (p - 1) * ps, take: ps,
          }),
          prisma.course.count({ where }),
        ]);
        return res.json({ page: p, pageSize: ps, total, data: rows.map(toCoursePayload) });
      }

      // default: enrolled
      const whereEnroll = {
        studentId: sid,
        AND: [
          { course: commonFilter },
          { course: { CoursesAssigned: { some: { collegeId: resolvedCollegeId } } } },
        ],
      };
      const [enrolls, total] = await Promise.all([
        prisma.enrollment.findMany({
          where: whereEnroll,
          select: { course: { select: baseSelect } },
          orderBy: { createdAt: "desc" }, skip: (p - 1) * ps, take: ps,
        }),
        prisma.enrollment.count({ where: whereEnroll }),
      ]);
      return res.json({
        page: p, pageSize: ps, total, data: enrolls.map((e) => toCoursePayload(e.course)),
      });
    }

    // ADMIN / INSTRUCTOR: courses assigned to their college
    const whereAssignedToCollege = {
      ...commonFilter,
      CoursesAssigned: { some: { collegeId: resolvedCollegeId } },
    };
    const [rows, total] = await Promise.all([
      prisma.course.findMany({
        where: whereAssignedToCollege,
        select: baseSelect,
        orderBy: { createdAt: "desc" }, skip: (p - 1) * ps, take: ps,
      }),
      prisma.course.count({ where: whereAssignedToCollege }),
    ]);
    return res.json({ page: p, pageSize: ps, total, data: rows.map(toCoursePayload) });
  } catch (err) {
    console.error("GET /courses error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});


router.post("/courses", requireSuperAdmin, async (req, res) => {
  const { title, thumbnail, creatorId, status, category, description } =
    req.body || {};
  if (!title || !creatorId)
    return res.status(400).json({ error: "title and creatorId are required" });

  const creator = await prisma.user.findUnique({ where: { id: creatorId } });
  if (!creator) return res.status(400).json({ error: "Invalid creatorId" });

  const created = await prisma.course.create({
    data: {
      title,
      thumbnail,
      status: status ?? "draft",
      creatorId,
      category: category ?? null,
      description: description ?? null,
      madeBySuperAdmin: true,
    },
  });
  res.json(toCoursePayload(created));
});

router.patch("/courses/:id", requireSuperAdmin, async (req, res) => {
  const { id } = req.params;
  const { title, thumbnail, status, category, description } = req.body || {};
  const updated = await prisma.course.update({
    where: { id },
    data: { title, thumbnail, status, category, description },
  });
  res.json(toCoursePayload(updated));
});

router.delete("/courses/:id", requireSuperAdmin, async (req, res) => {
  const { id } = req.params;

  await prisma.assessmentAttempt.deleteMany({
    where: { assessment: { courseId: id } },
  });
  await prisma.assessmentQuestion.deleteMany({
    where: { assessment: { courseId: id } },
  });
  await prisma.assessment.deleteMany({ where: { courseId: id } });

  await prisma.chapterProgress.deleteMany({
    where: { chapter: { courseId: id } },
  });
  await prisma.chapter.deleteMany({ where: { courseId: id } });

  await prisma.courseReview.deleteMany({ where: { courseId: id } });
  await prisma.enrollment.deleteMany({ where: { courseId: id } });
  await prisma.coursesAssigned.deleteMany({ where: { courseId: id } });

  await prisma.course.delete({ where: { id } });
  res.json({ ok: true });
});

// GET a single course by id (superadmin)
// router.get("/courses/:id", requireSuperAdmin, async (req, res) => {
//   const { id } = req.params;

//   // Select just the fields your client needs
//   const course = await prisma.course.findUnique({
//     where: { id },
//     select: {
//       id: true,
//       title: true,
//       thumbnail: true,
//       status: true,
//       creatorId: true,
//       category: true,
//       description: true,
//       createdAt: true,
//       updatedAt: true,
//     },
//   });

//   if (!course) return res.status(404).json({ error: "Course not found" });

//   // Keep response shape consistent with your other endpoints
//   res.json({
//     id: course.id,
//     title: course.title,
//     thumbnail: course.thumbnail,
//     status: course.status,
//     creatorId: course.creatorId,
//     category: course.category,
//     description: course.description,
//     createdAt: course.createdAt,
//     updatedAt: course.updatedAt,
//   });
// });

// superadmin.js (same router)
router.get("/courses/:id", async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    const role = String(req.user.role || "").toUpperCase();
    const id = String(req.params.id);
    const collegeId = String(req.query.collegeId || req.user.collegeId || "");
    const baseSelect = {
      id: true, title: true, thumbnail: true, status: true,
      creatorId: true, category: true, description: true,
      createdAt: true, updatedAt: true,
    };

    if (role === "SUPERADMIN") {
      const course = await prisma.course.findUnique({ where: { id }, select: baseSelect });
      if (!course) return res.status(404).json({ error: "Not found" });
      return res.json(course);
    }

    if (!collegeId) return res.status(400).json({ error: "collegeId is required for this role" });

    if (role === "STUDENT") {
      const sid = String(req.user.id);
      const enroll = await prisma.enrollment.findFirst({
        where: {
          studentId: sid,
          courseId: id,
          course: { CoursesAssigned: { some: { collegeId } } },
        },
        select: { course: { select: baseSelect } },
      });
      if (!enroll) return res.status(404).json({ error: "Not found" });
      return res.json(enroll.course);
    }

    // ADMIN / INSTRUCTOR
    const course = await prisma.course.findFirst({
      where: { id, CoursesAssigned: { some: { collegeId } } },
      select: baseSelect,
    });
    if (!course) return res.status(404).json({ error: "Not found" });
    return res.json(course);
  } catch (err) {
    console.error("GET /courses/:id error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/courses/:id/assign", async (req, res) => {
  try {
    const { id: courseId } = req.params;
    const { collegeId, departmentId = null, capacity = null } = req.body || {};

    if (!collegeId)
      return res.status(400).json({ error: "collegeId is required" });

    // Check if the user is a College Admin or Super Admin
    const isCollegeAdminUser = isCollegeAdmin(req.user);

    if (isCollegeAdminUser) {
      // College Admin can only assign courses to their own college’s department, not the college level
      const allowed = await assertAdminBelongsToCollege(req.user, collegeId);
      if (!allowed)
        return res
          .status(403)
          .json({ error: "Forbidden: You are not an admin of this college" });

      if (!departmentId) {
        return res.status(403).json({
          error:
            "Forbidden: You can only assign courses to departments within your college",
        });
      }

      const departmentAssignment = await prisma.coursesAssigned.findUnique({
        where: {
          courseId_collegeId_departmentId: {
            courseId,
            collegeId,
            departmentId,
          },
        },
      });

      if (departmentAssignment) {
        return res
          .status(409)
          .json({ error: "Course already assigned to this department" });
      }

      const row = await prisma.coursesAssigned.upsert({
        where: {
          courseId_collegeId_departmentId: {
            courseId,
            collegeId,
            departmentId,
          },
        },
        create: { courseId, collegeId, departmentId, capacity },
        update: { capacity },
      });

      return res.json({ ok: true, assignment: row });
    }

    if (isSuperAdmin(req.user)) {
      // Superadmin can assign the course at both college and department levels
      if (!departmentId) {
        // Assign to college-level
        const row = await prisma.coursesAssigned.upsert({
          where: {
            courseId_collegeId_departmentId: {
              courseId,
              collegeId,
              departmentId: null,
            },
          },
          create: { courseId, collegeId, departmentId: null, capacity },
          update: { capacity },
        });

        return res.json({ ok: true, assignment: row });
      } else {
        // Assign to department-level
        const row = await prisma.coursesAssigned.upsert({
          where: {
            courseId_collegeId_departmentId: {
              courseId,
              collegeId,
              departmentId,
            },
          },
          create: { courseId, collegeId, departmentId, capacity },
          update: { capacity },
        });

        return res.json({ ok: true, assignment: row });
      }
    }

    return res.status(403).json({
      error: "Forbidden: User is neither Super Admin nor College Admin",
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.delete("/courses/:id/unassign", async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    const { id: courseId } = req.params;
    const { collegeId, departmentId = null } = req.body || {};
    if (!collegeId)
      return res.status(400).json({ error: "collegeId is required" });

    if (isCollegeAdmin(req.user)) {
      const allowed = await assertAdminBelongsToCollege(req.user, collegeId);
      if (!allowed)
        return res
          .status(403)
          .json({ error: "Forbidden: not an admin of this college" });

      if (!departmentId) {
        return res
          .status(403)
          .json({ error: "Forbidden: cannot remove college-level assignment" });
      }

      await prisma.coursesAssigned.delete({
        where: {
          courseId_collegeId_departmentId: {
            courseId,
            collegeId,
            departmentId,
          },
        },
      });
      return res.json({ ok: true });
    }

    if (isSuperAdmin(req.user)) {
      if (departmentId) {
        await prisma.coursesAssigned.delete({
          where: {
            courseId_collegeId_departmentId: {
              courseId,
              collegeId,
              departmentId,
            },
          },
        });
      } else {
        await prisma.$transaction([
          prisma.coursesAssigned.deleteMany({
            where: { courseId, collegeId, NOT: { departmentId: null } },
          }),
          prisma.coursesAssigned.delete({
            where: {
              courseId_collegeId_departmentId: {
                courseId,
                collegeId,
                departmentId: null,
              },
            },
          }),
        ]);
      }
      return res.json({ ok: true });
    }

    return res.status(403).json({ error: "Forbidden" });
  } catch (e) {
    if (e.code === "P2025") {
      return res.status(404).json({ error: "Assignment not found" });
    }
    console.error(e);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/courses/:id/assignments", async (req, res) => {
  try {
    const { id: courseId } = req.params;
    const rows = await prisma.coursesAssigned.findMany({
      where: { courseId },
      orderBy: [{ collegeId: "asc" }, { departmentId: "asc" }],
    });
    // group by college for convenience
    const grouped = rows.reduce((acc, r) => {
      const key = r.collegeId;
      acc[key] = acc[key] || { collegeLevel: null, departments: [] };
      if (r.departmentId === null) acc[key].collegeLevel = r;
      else acc[key].departments.push(r);
      return acc;
    }, {});
    res.json({ ok: true, assignments: grouped });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
