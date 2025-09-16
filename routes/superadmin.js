import express from "express";
import { prisma } from "../config/prisma.js";

const router = express.Router();

const up = (s) => String(s || "").toUpperCase();
const isSuperAdmin = (u) => up(u?.role) === "SUPER_ADMIN";
const isCollegeAdmin = (u) => up(u?.role) === "ADMIN";

async function assertAdminBelongsToCollege(user, collegeId) {
  if (!isCollegeAdmin(user)) return false;
  return String(user.collegeId) === String(collegeId);
}

const toUserPayload = (u) => ({
  id: u.id,
  name: u.fullName,
  email: u.email,
  role: u.role,
  isActive: u.isActive,
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

function requireSuperAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });
  const role = up(req.user.role);
  if (role !== "SUPER_ADMIN") return res.status(403).json({ error: "Forbidden" });
  next();
}

router.get("/overview", requireSuperAdmin, async (_req, res) => {
  const [users, totalCourses] = await Promise.all([
    prisma.user.findMany({ select: { role: true, isActive: true } }),
    prisma.course.count(),
  ]);

  const totalSuperAdmins = users.filter((u) => up(u.role) === "SUPER_ADMIN").length;
  const totalAdmins = users.filter((u) => up(u.role) === "ADMIN").length;
  const totalInstructors = users.filter((u) => up(u.role) === "INSTRUCTOR").length;
  const totalStudents = users.filter((u) => up(u.role) === "STUDENT").length;
  const activeUsers = users.filter((u) => u.isActive).length;

  // Course breakdown
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
      ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10
      : null;
    courseBreakdown[c.id] = {
      title: c.title,
      status: c.status,
      students: c.enrollments.length,
      assignedColleges: c.CoursesAssigned.length,
      avgRating,
    };
  }

  // Avg course completion from ChapterProgress
  const [completedChapters, totalChapters] = await Promise.all([
    prisma.chapterProgress.count({ where: { isCompleted: true } }),
    prisma.chapterProgress.count(),
  ]);
  const avgCourseCompletion =
    totalChapters === 0 ? 0 : Math.round((completedChapters / totalChapters) * 100);

  const overview = {
    totalAdmins,
    totalSuperAdmins,
    totalInstructors,
    totalStudents,
    totalCourses,
    activeUsers,
    avgCourseCompletion,
  };

  res.json({ overview, courseBreakdown });
});


router.get("/admins", requireSuperAdmin, async (_req, res) => {
  const rows = await prisma.user.findMany({
    where: { role: { equals: "ADMIN", mode: "insensitive" } },
    select: { id: true, fullName: true, email: true, role: true, isActive: true, permissions: true },
  });
  res.json(rows.map(toUserPayload));
});

router.get("/instructors", requireSuperAdmin, async (_req, res) => {
  const rows = await prisma.user.findMany({
    where: { role: { equals: "INSTRUCTOR", mode: "insensitive" } },
    select: { id: true, fullName: true, email: true, role: true, isActive: true, permissions: true },
  });
  res.json(rows.map(toUserPayload));
});

router.get("/students", requireSuperAdmin, async (_req, res) => {
  const rows = await prisma.user.findMany({
    where: { role: { equals: "STUDENT", mode: "insensitive" } },
    select: {
      id: true,
      fullName: true,
      email: true,
      role: true,
      isActive: true,
      permissions: true,
      enrollments: { select: { courseId: true } },
    },
  });

  const data = rows.map((u) => ({
    ...toUserPayload(u),
    assignedCourses: u.enrollments?.map((e) => e.courseId) ?? [],
  }));
  res.json(data);
});


router.patch("/users/:id/permissions", requireSuperAdmin, async (_req, res) => {
  return res.status(501).json({ error: "Permissions not supported on User model" });
});

router.post("/users/bulk-update", requireSuperAdmin, async (req, res) => {
  const { ids, data } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: "ids required" });
  const result = await prisma.user.updateMany({ where: { id: { in: ids } }, data });
  res.json({ count: result.count });
});

router.delete("/users/:id", requireSuperAdmin, async (req, res) => {
  const { id } = req.params;

  const createdCount = await prisma.course.count({ where: { creatorId: id } });
  if (createdCount > 0) {
    return res.status(400).json({ error: "User is creator of courses. Reassign or delete those courses first." });
  }

  await prisma.assessmentAttempt.deleteMany({ where: { studentId: id } });
  await prisma.chapterProgress.deleteMany({ where: { studentId: id } });
  await prisma.courseReview.deleteMany({ where: { studentId: id } });
  await prisma.enrollment.deleteMany({ where: { studentId: id } });

  await prisma.user.delete({ where: { id } });
  res.json({ ok: true });
});

router.get("/courses", async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });

  const role = up(req.user.role);
  const {
    view = role === "SUPER_ADMIN" ? "all" : role === "STUDENT" ? "enrolled" : "assigned",
    collegeId,
    departmentId,
    studentId,
    creatorId,
    search,
    status,
    category,
    page = "1",
    pageSize = "20",
  } = req.query;

  const p = Math.max(parseInt(String(page), 10) || 1, 1);
  const ps = Math.min(Math.max(parseInt(String(pageSize), 10) || 20, 1), 100);

  const baseSelect = {
    id: true,
    title: true,
    thumbnail: true,
    status: true,
    creatorId: true,
    category: true,
    description: true,
    createdAt: true,
    updatedAt: true,
  };

  const commonFilter = {
    AND: [
      search ? { title: { contains: String(search), mode: "insensitive" } } : {},
      status ? { status: String(status) } : {},
      category ? { category: String(category) } : {},
    ],
  };

  if (view === "all") {
    if (role !== "SUPER_ADMIN") return res.status(403).json({ error: "Forbidden" });

    const [rows, total] = await Promise.all([
      prisma.course.findMany({
        where: commonFilter,
        select: baseSelect,
        orderBy: { createdAt: "desc" },
        skip: (p - 1) * ps,
        take: ps,
      }),
      prisma.course.count({ where: commonFilter }),
    ]);

    return res.json({
      page: p,
      pageSize: ps,
      total,
      data: rows.map(toCoursePayload),
    });
  }

  if (view === "assigned") {
    if (!collegeId) return res.status(400).json({ error: "collegeId is required for view=assigned" });

    const whereAssigned = {
      AND: [
        commonFilter,
        {
          CoursesAssigned: {
            some: {
              collegeId: String(collegeId),
              ...(departmentId ? { departmentId: String(departmentId) } : {}),
            },
          },
        },
      ],
    };

    const [rows, total] = await Promise.all([
      prisma.course.findMany({
        where: whereAssigned,
        select: {
          ...baseSelect,
          CoursesAssigned: {
            where: {
              collegeId: String(collegeId),
              ...(departmentId ? { departmentId: String(departmentId) } : {}),
            },
            select: { id: true, departmentId: true },
          },
        },
        orderBy: { createdAt: "desc" },
        skip: (p - 1) * ps,
        take: ps,
      }),
      prisma.course.count({ where: whereAssigned }),
    ]);

    return res.json({
      page: p,
      pageSize: ps,
      total,
      data: rows.map((c) => ({
        ...toCoursePayload(c),
        assignmentCount: c.CoursesAssigned.length,
      })),
    });
  }

  if (view === "enrolled") {
    const sid = studentId || req.user?.id;
    if (!sid) return res.status(400).json({ error: "studentId is required for view=enrolled" });

    const enrolls = await prisma.enrollment.findMany({
      where: {
        studentId: String(sid),
        course: commonFilter,
      },
      select: { course: { select: baseSelect } },
      orderBy: { createdAt: "desc" },
      skip: (p - 1) * ps,
      take: ps,
    });

    const total = await prisma.enrollment.count({
      where: { studentId: String(sid), course: commonFilter },
    });

    return res.json({
      page: p,
      pageSize: ps,
      total,
      data: enrolls.map((e) => toCoursePayload(e.course)),
    });
  }

  if (view === "createdBy") {
    if (!creatorId) return res.status(400).json({ error: "creatorId is required for view=createdBy" });

    const whereCreated = { AND: [commonFilter, { creatorId: String(creatorId) }] };

    const [rows, total] = await Promise.all([
      prisma.course.findMany({
        where: whereCreated,
        select: baseSelect,
        orderBy: { createdAt: "desc" },
        skip: (p - 1) * ps,
        take: ps,
      }),
      prisma.course.count({ where: whereCreated }),
    ]);

    return res.json({
      page: p,
      pageSize: ps,
      total,
      data: rows.map(toCoursePayload),
    });
  }

  return res.status(400).json({ error: `Unknown view '${view}'` });
});

router.post("/courses", requireSuperAdmin, async (req, res) => {
  const { title, thumbnail, creatorId, status, category, description } = req.body || {};
  if (!title || !creatorId) return res.status(400).json({ error: "title and creatorId are required" });

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

  await prisma.assessmentAttempt.deleteMany({ where: { assessment: { courseId: id } } });
  await prisma.assessmentQuestion.deleteMany({ where: { assessment: { courseId: id } } });
  await prisma.assessment.deleteMany({ where: { courseId: id } });

  await prisma.chapterProgress.deleteMany({ where: { chapter: { courseId: id } } });
  await prisma.chapter.deleteMany({ where: { courseId: id } });

  await prisma.courseReview.deleteMany({ where: { courseId: id } });
  await prisma.enrollment.deleteMany({ where: { courseId: id } });
  await prisma.coursesAssigned.deleteMany({ where: { courseId: id } });

  await prisma.course.delete({ where: { id } });
  res.json({ ok: true });
});

router.post("/courses/:id/assign", async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    const { id: courseId } = req.params;
    const { collegeId, departmentId = null, capacity = null } = req.body || {};
    if (!collegeId) return res.status(400).json({ error: "collegeId is required" });

    // ADMIN guardrails
    if (isCollegeAdmin(req.user)) {
      const allowed = await assertAdminBelongsToCollege(req.user, collegeId);
      if (!allowed) return res.status(403).json({ error: "Forbidden: not an admin of this college" });

      // Admins may NOT create/modify the college-level row
      if (!departmentId) {
        return res.status(403).json({ error: "Forbidden: college-level assignment can only be created by SUPER_ADMIN" });
      }

      // Admins can only assign to departments if the college-level assignment exists
      const collegeLevel = await prisma.coursesAssigned.findUnique({
        where: { courseId_collegeId_departmentId: { courseId, collegeId, departmentId: null } },
        select: { id: true },
      });
      if (!collegeLevel) {
        return res.status(409).json({ error: "Course is not assigned to this college yet (SUPER_ADMIN must assign first)" });
      }
    }

    // SUPER_ADMIN has no extra checks; ADMIN passed the above checks.
    const row = await prisma.coursesAssigned.upsert({
      where: { courseId_collegeId_departmentId: { courseId, collegeId, departmentId } },
      create: { courseId, collegeId, departmentId, capacity },
      update: { capacity },
    });

    return res.json({ ok: true, assignment: row });
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
    if (!collegeId) return res.status(400).json({ error: "collegeId is required" });

    if (isCollegeAdmin(req.user)) {
      const allowed = await assertAdminBelongsToCollege(req.user, collegeId);
      if (!allowed) return res.status(403).json({ error: "Forbidden: not an admin of this college" });

      // Admins may only remove dept-level rows
      if (!departmentId) {
        return res.status(403).json({ error: "Forbidden: cannot remove college-level assignment" });
      }

      await prisma.coursesAssigned.delete({
        where: { courseId_collegeId_departmentId: { courseId, collegeId, departmentId } },
      });
      return res.json({ ok: true });
    }

    if (isSuperAdmin(req.user)) {
      if (departmentId) {
        // remove specific dept-level row
        await prisma.coursesAssigned.delete({
          where: { courseId_collegeId_departmentId: { courseId, collegeId, departmentId } },
        });
      } else {
        // remove college-level row + all its department rows atomically
        await prisma.$transaction([
          prisma.coursesAssigned.deleteMany({
            where: { courseId, collegeId, NOT: { departmentId: null } },
          }),
          prisma.coursesAssigned.delete({
            where: { courseId_collegeId_departmentId: { courseId, collegeId, departmentId: null } },
          }),
        ]);
      }
      return res.json({ ok: true });
    }

    return res.status(403).json({ error: "Forbidden" });
  } catch (e) {
    // if trying to delete non-existing row, handle gracefully
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
