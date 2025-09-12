import express from "express";
import { prisma } from "../config/prisma.js";

const router = express.Router();

const up = (s) => String(s || "").toUpperCase();

// This middleware is correct, no changes needed.
function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });
  const r = up(req.user.role);
  if (r !== "ADMIN" && r !== "SUPER_ADMIN") {
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
}

// This helper function is correct, no changes needed.
async function getAdminCourseIds(adminId) {
  const cs = await prisma.course.findMany({
    where: { OR: [{ creatorId: adminId }, { managerId: adminId }] },
    select: { id: true },
  });
  return cs.map((c) => c.id);
}

// This route is correct, no changes needed.
router.get("/overview", requireAdmin, async (req, res, next) => {
  try {
    const adminId = req.user.id;
    const courseIds = await getAdminCourseIds(adminId);

    if (courseIds.length === 0) {
      return res.json({
        totals: { courses: 0, students: 0, instructors: 0 },
        courseIds: [],
      });
    }

    const [enrollments, courseInstructors] = await Promise.all([
      prisma.enrollment.findMany({
        where: { courseId: { in: courseIds } },
        select: { studentId: true },
      }),
      prisma.courseInstructor.findMany({
        where: { courseId: { in: courseIds } },
        select: { instructorId: true },
      }),
    ]);

    const uniqueStudents = new Set(enrollments.map((e) => e.studentId));
    const uniqueInstructors = new Set(
      courseInstructors.map((ci) => ci.instructorId)
    );

    res.json({
      totals: {
        courses: courseIds.length,
        students: uniqueStudents.size,
        instructors: uniqueInstructors.size,
      },
      courseIds,
    });
  } catch (err) {
    next(err);
  }
});

// This route is correct, no changes needed.
router.get("/courses", requireAdmin, async (req, res, next) => {
  try {
    const adminId = req.user.id;

    const rows = await prisma.course.findMany({
      where: { OR: [{ creatorId: adminId }, { managerId: adminId }] },
      select: {
        id: true,
        title: true,
        description: true,
        thumbnail: true,
        status: true,
        enrollments: { select: { id: true } },
        instructors: {
          select: {
            instructor: { select: { id: true, fullName: true } },
          },
        },
      },
      orderBy: { id: "desc" },
    });

    const mapped = rows.map((c) => ({
      id: c.id,
      title: c.title,
      description: c.description || "",
      thumbnail: c.thumbnail || null,
      status: c.status || "draft",
      level: null,
      totalModules: 0, // Placeholder
      totalChapters: 0, // Placeholder
      studentCount: c.enrollments.length,
      instructorNames: c.instructors.map((i) => i.instructor.fullName),
      instructorIds: c.instructors.map((i) => i.instructor.id), // Added for consistency
    }));

    res.json(mapped);
  } catch (err) {
    next(err);
  }
});


// --- UPDATED: Students Route ---
// Removed the `fallback` logic to ensure admins only ever see students
// enrolled in their own courses.
router.get("/students", requireAdmin, async (req, res, next) => {
  try {
    const adminId = req.user.id;
    const courseIds = await getAdminCourseIds(adminId);

    // If the admin manages no courses, they have no students.
    if (courseIds.length === 0) {
      return res.json([]);
    }

    // Get all enrollments for the admin's courses
    const enrollments = await prisma.enrollment.findMany({
      where: { courseId: { in: courseIds } },
      select: {
        courseId: true,
        student: {
          select: { id: true, fullName: true, email: true, isActive: true, lastLogin: true },
        },
      },
    });

    // De-duplicate students and list the courses they are enrolled in within this admin's scope
    const studentsById = new Map();
    for (const enrollment of enrollments) {
        const student = enrollment.student;
        if (!studentsById.has(student.id)) {
            studentsById.set(student.id, {
                ...student,
                assignedCourses: new Set(),
            });
        }
        studentsById.get(student.id).assignedCourses.add(enrollment.courseId);
    }

    const result = Array.from(studentsById.values()).map(s => ({
      ...s,
      assignedCourses: Array.from(s.assignedCourses),
    }));

    res.json(result);
  } catch (err) {
    next(err);
  }
});


// --- UPDATED: Instructors Route ---
// Removed the `fallback` logic to ensure admins only ever see instructors
// assigned to their own courses.
router.get("/instructors", requireAdmin, async (req, res, next) => {
  try {
    const adminId = req.user.id;
    const courseIds = await getAdminCourseIds(adminId);

    // If the admin manages no courses, they have no instructors.
    if (courseIds.length === 0) {
        return res.json([]);
    }

    // Get all instructor assignments for the admin's courses
    const links = await prisma.courseInstructor.findMany({
      where: { courseId: { in: courseIds } },
      select: {
        courseId: true,
        instructor: {
          select: { id: true, fullName: true, email: true, isActive: true, lastLogin: true },
        },
      },
    });

    // De-duplicate instructors and list the courses they are assigned to within this admin's scope
    const instructorsById = new Map();
    for (const link of links) {
        const instructor = link.instructor;
        if (!instructorsById.has(instructor.id)) {
            instructorsById.set(instructor.id, {
                ...instructor,
                assignedCourses: new Set(),
            });
        }
        instructorsById.get(instructor.id).assignedCourses.add(link.courseId);
    }

    const result = Array.from(instructorsById.values()).map(i => ({
        ...i,
        assignedCourses: Array.from(i.assignedCourses),
    }));

    res.json(result);
  } catch (err) {
    next(err);
  }
});


// --- UPDATED: Permissions Route ---
// Added a security check to ensure the admin manages the instructor
// they are attempting to modify.
router.patch(
  "/instructors/:id/permissions",
  requireAdmin,
  async (req, res, next) => {
    try {
      const adminId = req.user.id;
      const instructorId = req.params.id;

      const user = await prisma.user.findUnique({
        where: { id: instructorId },
        select: { id: true, role: true },
      });

      if (!user || up(user.role) !== "INSTRUCTOR") {
        return res.status(404).json({ error: "Instructor not found" });
      }

      // SECURITY CHECK: Verify this instructor is linked to one of the admin's courses
      const adminCourseIds = await getAdminCourseIds(adminId);
      const linkCount = await prisma.courseInstructor.count({
          where: {
              instructorId: instructorId,
              courseId: { in: adminCourseIds },
          },
      });

      if (linkCount === 0) {
          return res.status(403).json({ error: "Forbidden: You do not manage this instructor." });
      }
      // END SECURITY CHECK

      const updated = await prisma.user.update({
        where: { id: instructorId },
        data: { permissions: req.body || {} },
        select: { id: true, permissions: true },
      });

      res.json(updated);
    } catch (err) {
      next(err);
    }
  }
);

export default router;