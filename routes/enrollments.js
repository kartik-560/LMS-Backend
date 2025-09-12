// routes/enrollments.js
import express from "express";
import { prisma } from "../config/prisma.js";

const router = express.Router();

const norm = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]+/g, "_");
const isUuid = (s) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    s
  );
const coerceId = (v) => String(v);

// --- guards ---
function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });
  if (!isAdmin(req.user.role)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
}
function isAdmin(role) {
  const r = norm(role);
  return r === "ADMIN" || r === "SUPER_ADMIN";
}
function isInstructor(role) {
  return norm(role) === "INSTRUCTOR";
}
function isStudent(role) {
  return norm(role) === "STUDENT";
}

// --- existing endpoints ---
router.get("/enrollments", async (req, res) => {
  try {
    const { studentId, courseId } = req.query;
    const where = {};
    if (studentId) {
      if (!isUuid(studentId))
        return res.status(400).json({ error: "Invalid studentId format" });
      where.studentId = studentId;
    }
    if (courseId) {
      if (!isUuid(courseId))
        return res.status(400).json({ error: "Invalid courseId format" });
      where.courseId = courseId;
    }

    const enrollments = await prisma.enrollment.findMany({ where });
    res.json(enrollments);
  } catch (err) {
    console.error("GET /enrollments error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Admin: direct create enrollment
router.post("/enrollments", requireAdmin, async (req, res) => {
  try {
    const { studentId, courseId } = req.body;
    if (!studentId || !courseId) {
      return res
        .status(400)
        .json({ error: "studentId and courseId are required" });
    }
    if (!isUuid(studentId) || !isUuid(courseId)) {
      return res.status(400).json({ error: "Invalid ID format" });
    }

    const enrollment = await prisma.enrollment.create({
      data: { studentId, courseId, status: "APPROVED" },
    });

    res.status(201).json(enrollment);
  } catch (err) {
    console.error("POST /enrollments error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});


router.get("/enrollments/self", async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    const rows = await prisma.enrollment.findMany({
      where: { studentId: String(req.user.id) },
      select: {
        id: true,
        courseId: true,
        studentId: true,
        status: true,
        progress: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: "desc" }, // now recognized by the regenerated client
    });

    res.json(rows);
  } catch (e) {
    console.error("GET /api/enrollments/self error:", e);
    res.status(500).json({ error: "Internal error" });
  }
});
// Admin: list enrollments for a course
router.get("/courses/:courseId/enrollments", requireAdmin, async (req, res) => {
  try {
    const courseId = coerceId(req.params.courseId);
    const rows = await prisma.enrollment.findMany({
      where: { courseId },
      include: {
        student: { select: { id: true, fullName: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    res.json(
      rows.map((e) => ({
        id: e.id,
        studentId: e.studentId,
        studentName: e.student?.fullName || null,
        status: e.status,
        progress: e.progress,
      }))
    );
  } catch (e) {
    console.error("GET /courses/:courseId/enrollments error:", e);
    res.status(500).json({ error: "Internal error" });
  }
});

// Admin: create enrollment for a course
router.post("/courses/:courseId/enrollments", requireAdmin, async (req, res) => {
  const { courseId } = req.params;
  const { studentId } = req.body || {};
  if (!studentId)
    return res.status(400).json({ error: "studentId required" });

  const created = await prisma.enrollment.create({
    data: { courseId: String(courseId), studentId: String(studentId), status: "APPROVED" },
  });
  res.json({ id: created.id });
});

// Delete enrollment
router.delete("/enrollments/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    if (!isUuid(id)) {
      return res.status(400).json({ error: "Invalid enrollment ID format" });
    }

    await prisma.enrollment.delete({ where: { id } });
    res.json({ message: "Enrollment deleted successfully" });
  } catch (err) {
    console.error("DELETE /enrollments/:id error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// --- new: enrollment request flow ---

// Student requests enrollment
router.post(
  "/courses/:courseId/enrollment-requests",
  requireAuth,
  async (req, res) => {
    try {
      const courseId = coerceId(req.params.courseId);
      const studentId = String(req.user.id);

      if (!isUuid(courseId))
        return res.status(400).json({ error: "Invalid courseId" });
      if (!isStudent(req.user.role))
        return res.status(403).json({ error: "Only students can request enrollment" });

      const existing = await prisma.enrollment.findFirst({
        where: { courseId, studentId },
      });
      if (existing) return res.json(existing);

      const created = await prisma.enrollment.create({
        data: { courseId, studentId, status: "PENDING" },
      });
      res.status(201).json(created);
    } catch (e) {
      console.error("POST /courses/:courseId/enrollment-requests error:", e);
      res.status(500).json({ error: "Internal error" });
    }
  }
);

// Student: my requests
router.get('/enrollment-requests/me', requireAuth, async (req, res) => {
  try {
    const rows = await prisma.enrollment.findMany({
      where: { studentId: String(req.user.id) },
      select: {
        id: true, courseId: true, status: true,
        progress: true, createdAt: true, updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    })
    res.json(rows)
  } catch (e) {
    console.error('GET /api/enrollment-requests/me error:', e)
    res.status(500).json({ error: 'Internal error' })
  }
})


router.get("/instructor/enrollment-requests", requireAuth, async (req, res) => {
  try {
    if (!(isInstructor(req.user.role) || isAdmin(req.user.role)))
      return res.status(403).json({ error: "Forbidden" });

    const myCourseIds = await prisma.courseInstructor.findMany({
      where: { instructorId: String(req.user.id) },
      select: { courseId: true },
    }).then((rows) => rows.map((r) => r.courseId));

    const rows = await prisma.enrollment.findMany({
      where: { courseId: { in: myCourseIds }, status: "PENDING" },
      include: {
        student: { select: { id: true, fullName: true, email: true } },
        course: { select: { id: true, title: true } },
      },
    });

    res.json(
      rows.map((e) => ({
        id: e.id,
        courseId: e.courseId,
        courseTitle: e.course?.title,
        studentId: e.studentId,
        studentName: e.student?.fullName,
        studentEmail: e.student?.email,
        status: e.status,
      }))
    );
  } catch (e) {
    console.error("GET /instructor/enrollment-requests error:", e);
    res.status(500).json({ error: "Internal error" });
  }
});

// Instructor/Admin: approve/reject a request
router.patch("/enrollment-requests/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { action } = req.body || {};
    if (!isUuid(id)) return res.status(400).json({ error: "Invalid id" });

    if (!["APPROVE", "REJECT"].includes(String(action || "").toUpperCase())) {
      return res.status(400).json({ error: "Invalid action" });
    }

    const enr = await prisma.enrollment.findUnique({
      where: { id },
      include: { course: { select: { id: true } } },
    });
    if (!enr) return res.status(404).json({ error: "Not found" });

    // TODO: check ownership if needed

    const nextStatus =
      action.toUpperCase() === "APPROVE" ? "APPROVED" : "REJECTED";
    const updated = await prisma.enrollment.update({
      where: { id },
      data: { status: nextStatus },
    });

    res.json(updated);
  } catch (e) {
    console.error("PATCH /enrollment-requests/:id error:", e);
    res.status(500).json({ error: "Internal error" });
  }
});

export default router;
