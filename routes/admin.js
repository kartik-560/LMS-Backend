import express from "express";
import { prisma } from "../config/prisma.js";

const router = express.Router();

const up = (s) => String(s || "").toUpperCase();
const isAdmin = (u) => up(u?.role) === "ADMIN";

// Middleware: only ADMINs allowed
function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });
  if (!isAdmin(req.user)) return res.status(403).json({ error: "Forbidden" });
  next();
}

router.get("/overview", requireAdmin, async (req, res) => {
  const collegeId = req.user.collegeId;
  if (!collegeId) return res.status(400).json({ error: "No collegeId" });

  const [students, instructors, courses, activeUsers] = await Promise.all([
    prisma.user.count({ where: { role: "student", collegeId } }),
    prisma.user.count({ where: { role: "instructor", collegeId } }),
    prisma.course.count({
      where: { CoursesAssigned: { some: { collegeId } } },
    }),
    prisma.user.count({ where: { isActive: true, collegeId } }),
  ]);

  const [completedChapters, totalChapters] = await Promise.all([
    prisma.chapterProgress.count({
      where: { isCompleted: true, student: { collegeId } },
    }),
    prisma.chapterProgress.count({
      where: { student: { collegeId } },
    }),
  ]);

  const avgCourseCompletion =
    totalChapters === 0
      ? 0
      : Math.round((completedChapters / totalChapters) * 100);

  res.json({
    data: {
      overview: {
        students: students,
        instructors: instructors,
        courses: courses,
        users: activeUsers,
        avgCourseCompletion,
      },
    },
  });
});

router.get("/instructors", requireAdmin, async (req, res) => {
  const collegeId = req.user.collegeId;
  const rows = await prisma.user.findMany({
    where: { role: "instructor", collegeId },
    select: {
      id: true,
      fullName: true,
      email: true,
      isActive: true,
      lastLogin: true,
    },
    orderBy: { fullName: "asc" },
  });
  res.json({ data: rows });
});


router.get("/students", requireAdmin, async (req, res) => {
  const collegeId = req.user.collegeId;
  const rows = await prisma.user.findMany({
    where: { role: "student", collegeId },
    select: {
      id: true,
      fullName: true,
      email: true,
      isActive: true,
      lastLogin: true,
      enrollments: { select: { courseId: true } },
    //   _count: {
    //     select: {
    //       testResults: true,
    //       interviews: true,
    //       certifications: true,
    //     },
    //   },
    },
    orderBy: { fullName: "asc" },
  });

  const data = rows.map((u) => ({
    ...u,
    assignedCourses: u.enrollments.map((e) => e.courseId),
    // finalTests: u._count.testResults,
    // interviews: u._count.interviews,
    // certifications: u._count.certifications,
  }));
  res.json({ data });
});

router.get("/courses", requireAdmin, async (req, res) => {
  const collegeId = req.user.collegeId;
  const { search, status, category } = req.query;

  const where = {
  
    CoursesAssigned: { some: { collegeId } },
    ...(search ? { title: { contains: search, mode: "insensitive" } } : {}),
    ...(status ? { status } : {}),
    ...(category ? { category } : {}),
  };

  const rows = await prisma.course.findMany({
    where,
    select: {
      id: true,
      title: true,
      description: true,
      status: true,
      thumbnail: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: {
          // ❌ modules (not in model)
          chapters: true,
          enrollments: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const data = rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    status: r.status,
    thumbnail: r.thumbnail,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    totalChapters: r._count.chapters ?? 0,
    studentCount: r._count.enrollments ?? 0,
  }));

  res.json({ data });
});

export default router;
