import express from "express";
import { prisma } from "../config/prisma.js";  
const router = express.Router();

const up = (s) => String(s || "").toUpperCase();

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
});


function requireSuperAdmin(req, res, next) {

  const role = up(req?.user?.role);
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });
  if (role !== "SUPER_ADMIN") return res.status(403).json({ error: "Forbidden" });
  next();
}

router.get("/overview", requireSuperAdmin, async (_req, res) => {
  const [users, totalCourses] = await Promise.all([
    prisma.user.findMany({ select: { role: true, isActive: true } }),
    prisma.course.count(),
  ]);

  const totalSuperAdmins = users.filter((u) => up(u.role) === "SUPER_ADMIN").length;
  const totalAdmins      = users.filter((u) => up(u.role) === "ADMIN").length;   // <-- only ADMIN
  const totalInstructors = users.filter((u) => up(u.role) === "INSTRUCTOR").length;
  const totalStudents    = users.filter((u) => up(u.role) === "STUDENT").length;
  const activeUsers      = users.filter((u) => u.isActive).length;

  const courseRows = await prisma.course.findMany({
    select: {
      id: true,
      title: true,
      status: true,
      instructors: { select: { id: true } },
      enrollments: { select: { id: true } },
    },
  });

  const courseBreakdown = {};
  for (const c of courseRows) {
    courseBreakdown[c.id] = {
      title: c.title,
      status: c.status,
      instructors: c.instructors.length,
      students: c.enrollments.length,
    };
  }

  const performanceMetrics = {
    apiUsage: 47,
    dbUsage: 61,
    errorRate: 1.1,
    avgResponseTimeMs: 118,
    backgroundJobs: 33,
  };

  const overview = {
    totalAdmins,         
    totalSuperAdmins,   
    totalInstructors,
    totalStudents,
    totalCourses,
    systemUptime: "99.9%",
    activeUsers,
    avgCourseCompletion: 64,
    totalRevenue: 0,
  };

  res.json({ overview, courseBreakdown, performanceMetrics });
});

router.get("/admins", requireSuperAdmin, async (_req, res) => {
  const rows = await prisma.user.findMany({
    where: {
      role: { equals: "ADMIN", mode: "insensitive" }  
    },
    select: {
      id: true,
      fullName: true,
      email: true,
      role: true,
      isActive: true,
    },
  });

  res.json(rows.map(toUserPayload));
});


router.get("/instructors", requireSuperAdmin, async (_req, res) => {
  const rows = await prisma.user.findMany({
    where: { OR: [{ role: "INSTRUCTOR" }, { role: "instructor" }] },
    include: { instructorCourses: { select: { courseId: true } } },
  });

  const data = rows.map((u) => ({
    ...toUserPayload(u),
    assignedCourses: u.instructorCourses.map((ic) => ic.courseId),
  }));

  res.json(data);
});

router.get("/students", requireSuperAdmin, async (_req, res) => {
  const rows = await prisma.user.findMany({
    where: { OR: [{ role: "STUDENT" }, { role: "student" }] },
    include: { enrollments: { select: { courseId: true } } },
  });

  const data = rows.map((u) => ({
    ...toUserPayload(u),
    assignedCourses: u.enrollments.map((e) => e.courseId),
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

  const [createdCount, managedCount] = await Promise.all([
    prisma.course.count({ where: { creatorId: id } }),
    prisma.course.count({ where: { managerId: id } }),
  ]);
  if (createdCount > 0) return res.status(400).json({ error: "User is creator of courses. Reassign or delete those courses first." });
  if (managedCount > 0) return res.status(400).json({ error: "User manages courses. Reassign manager first." });

 
  await prisma.assessmentAttempt.deleteMany({ where: { studentId: id } });
  await prisma.chapterProgress.deleteMany({ where: { studentId: id } });
  await prisma.courseReview.deleteMany({ where: { studentId: id } });
  await prisma.enrollment.deleteMany({ where: { studentId: id } });
  await prisma.courseInstructor.deleteMany({ where: { instructorId: id } });

  await prisma.user.delete({ where: { id } });
  res.json({ ok: true });
});

router.get("/courses", requireSuperAdmin, async (_req, res) => {
  const rows = await prisma.course.findMany({
    select: {
      id: true,
      title: true,
      thumbnail: true,
      status: true,
      creatorId: true,   
      managerId: true,   
    },
  });

  // return a PLAIN ARRAY
  res.json(
    rows.map((c) => ({
      id: c.id,
      title: c.title,
      thumbnail: c.thumbnail,
      status: c.status,
      creatorId: c.creatorId ?? null,
      managerId: c.managerId ?? null,
    }))
  );
});

router.post("/courses", requireSuperAdmin, async (req, res) => {
  const { title, thumbnail, creatorId, managerId, status } = req.body || {};
  if (!title || !creatorId) return res.status(400).json({ error: "title and creatorId are required" });


  const creator = await prisma.user.findUnique({ where: { id: creatorId } });
  if (!creator) return res.status(400).json({ error: "Invalid creatorId" });

  const created = await prisma.course.create({
    data: { title, thumbnail, status: status ?? "draft", creatorId, managerId },
  });
  res.json(toCoursePayload(created));
});

router.patch("/courses/:id", requireSuperAdmin, async (req, res) => {
  const { id } = req.params;
  const { title, thumbnail, status, managerId } = req.body || {};
  const updated = await prisma.course.update({
    where: { id },
    data: { title, thumbnail, status, managerId },
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
  await prisma.courseInstructor.deleteMany({ where: { courseId: id } });

  await prisma.course.delete({ where: { id } });
  res.json({ ok: true });
});

router.post("/courses/:id/instructors", requireSuperAdmin, async (req, res) => {
  const { id } = req.params;
  const { instructorIds } = req.body || {};
  if (!Array.isArray(instructorIds)) return res.status(400).json({ error: "instructorIds must be an array" });

  await prisma.courseInstructor.deleteMany({ where: { courseId: id } });
  await prisma.courseInstructor.createMany({
    data: instructorIds.map((instructorId) => ({ courseId: id, instructorId })),
    skipDuplicates: true,
  });

  res.json({ ok: true, count: instructorIds.length });
});

router.get("/courses/:courseId/chapters", requireSuperAdmin, async (req, res) => {
  const { courseId } = req.params;
  const rows = await prisma.chapter.findMany({
    where: { courseId },
    orderBy: { order: "asc" },
    select: { id: true, title: true, slug: true, order: true, isPreview: true, isPublished: true },
  });
  res.json(rows);
});

export default router;
