import express from "express";
import { prisma } from "../config/prisma.js";
import { protect, authorize } from "../middleware/auth.js"; 

const router = express.Router();
const up = (s) => String(s || "").toUpperCase();
const isAdmin = (req) => ['ADMIN', 'SUPERADMIN', 'SUPER_ADMIN'].includes(up(req.user?.role));

// Ensure Admin is authorized to view or edit course data
function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  const r = up(req.user.role);
  if (r !== 'ADMIN' && r !== 'SUPER_ADMIN') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}
const isCollegeAdmin = (user) => {
  return user.role === "ADMIN" && user.collegeId; // Ensure user is an admin and belongs to a college
};
// Helper function to check if Admin belongs to the college
async function assertAdminBelongsToCollege(user, collegeId) {
  if (!user.permissions || !user.permissions.collegeId) {
    return false; // Handle cases where collegeId is not found in permissions
  }
  
  // Compare the collegeId in the user permissions with the one sent in the request
  return String(user.permissions.collegeId) === String(collegeId);
}


router.post("/courses", requireAdmin, async (req, res) => {
  try {
    const { title, thumbnail, status = "draft", category, description, collegeId } = req.body || {};
    
    // Log to debug if the admin's permissions are being passed correctly
    console.log('User Permissions:', req.user.permissions);
    console.log('Requested College ID:', collegeId);

    if (!title || !collegeId) {
      return res.status(400).json({ error: "Title and collegeId are required" });
    }

    // Check if the Admin belongs to the college
    const allowed = await assertAdminBelongsToCollege(req.user, collegeId);
    if (!allowed) {
      return res.status(403).json({ error: "Forbidden: You do not manage this college" });
    }

    // Create the course
    const createdCourse = await prisma.course.create({
      data: {
        title,
        thumbnail,
        status,
        creatorId: req.user.id, // Admin creating the course
        category,
        description,
      },
    });

    res.status(201).json(createdCourse);
  } catch (err) {
    console.error("POST /courses error:", err);
    res.status(500).json({ error: "Internal error creating course" });
  }
});

router.get("/courses", requireAdmin, async (req, res) => {
  try {
    const adminId = req.user.id;

    const rows = await prisma.course.findMany({
      where: {
        CoursesAssigned: {
          some: {
            collegeId: req.user.collegeId,  // Ensuring the course is assigned to the admin's college
          }
        }
      },
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
      orderBy: { id: 'desc' },
    });

    const mapped = rows.map((c) => ({
      id: c.id,
      title: c.title,
      description: c.description || "",
      thumbnail: c.thumbnail || null,
      status: c.status || "draft",
      studentCount: c.enrollments.length,
      instructorNames: c.instructors.map((i) => i.instructor.fullName),
    }));

    res.json(mapped);
  } catch (err) {
    console.error("GET /courses error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

router.post("/courses/:id/assign", requireAdmin, async (req, res) => {
  try {
    const { id: courseId } = req.params;
    const { collegeId, departmentId = null, capacity = null } = req.body || {};

    if (!collegeId) return res.status(400).json({ error: "collegeId is required" });

    // Check if the Admin belongs to the college
    const allowed = await assertAdminBelongsToCollege(req.user, collegeId);
    if (!allowed) return res.status(403).json({ error: "Forbidden: You are not an admin of this college" });

    // Assign the course
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

router.delete("/courses/:id/unassign", requireAdmin, async (req, res) => {
  try {
    const { id: courseId } = req.params;
    const { collegeId, departmentId = null } = req.body || {};

    if (!collegeId) return res.status(400).json({ error: "collegeId is required" });

    // Check if the Admin belongs to the college
    const allowed = await assertAdminBelongsToCollege(req.user, collegeId);
    if (!allowed) return res.status(403).json({ error: "Forbidden: You are not an admin of this college" });

    // Admins can only remove dept-level rows
    if (!departmentId) {
      return res.status(403).json({ error: "Forbidden: You cannot remove college-level assignment" });
    }

    await prisma.coursesAssigned.delete({
      where: { courseId_collegeId_departmentId: { courseId, collegeId, departmentId } },
    });

    return res.json({ ok: true });
  } catch (e) {
    // Handle cases where the assignment doesn't exist
    if (e.code === "P2025") {
      return res.status(404).json({ error: "Assignment not found" });
    }
    console.error(e);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/courses/assignments", requireAdmin, async (req, res) => {
  try {
    const { collegeId } = req.query;

    if (!collegeId) return res.status(400).json({ error: "collegeId is required" });

    const rows = await prisma.coursesAssigned.findMany({
      where: { collegeId },
      orderBy: [{ departmentId: "asc" }, { courseId: "asc" }],
    });

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
