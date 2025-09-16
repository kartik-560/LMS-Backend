// routes/enrollments.js
import express from "express";
import { prisma } from "../config/prisma.js";

const router = express.Router();

// ------------- utils -------------
const norm = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]+/g, "_");
const isUuid = (s) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(s)
  );
const coerceId = (v) => String(v);

function normStatus(s) {
  return String(s || "").trim().toUpperCase();
}

const isAdmin = (role) => ["ADMIN", "SUPER_ADMIN"].includes(norm(role));
const isInstructor = (role) => norm(role) === "INSTRUCTOR";
const isStudent = (role) => norm(role) === "STUDENT";

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });
  if (!isAdmin(req.user.role)) return res.status(403).json({ error: "Forbidden" });
  next();
}

async function findAssignmentForContext(courseId, collegeId, departmentId) {
  if (!collegeId) return null;

  if (departmentId) {
    const deptAssign = await prisma.coursesAssigned.findFirst({
      where: { courseId, collegeId, departmentId },
    });
    if (deptAssign) return deptAssign;
  }

  return prisma.coursesAssigned.findFirst({
    where: { courseId, collegeId, departmentId: null },
  });
}

async function countApprovedLikeAtDepartment(courseId, departmentId, approvedLikeStatuses) {
  if (!departmentId) return 0;
  return prisma.enrollment.count({
    where: {
      courseId,
      departmentId,
      status: { in: approvedLikeStatuses },
    },
  });
}

// ------------- schema-aware helpers -------------
const up = (s) => String(s || "").toUpperCase();

async function getInstructorAffiliation(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, role: true, permissions: true }
  });
  if (!user) return null;

  // First preference: approved Registration row (if you use it)
  const reg = await prisma.registration.findFirst({
    where: {
      email: user.email,
      role: { equals: "INSTRUCTOR", mode: "insensitive" },
      status: "APPROVED",
    },
    orderBy: { createdAt: "desc" },
    select: { collegeId: true, departmentId: true },
  });

  if (reg) {
    return {
      collegeId: reg.collegeId || null,
      departmentIds: reg.departmentId ? [reg.departmentId] : [],
    };
  }

  // Fallback to user.permissions (your screenshot shows this is set)
  const perms = (user.permissions || {});
  const depIds = Array.isArray(perms.departmentIds) ? perms.departmentIds : [];
  return {
    collegeId: perms.collegeId || null,
    departmentIds: depIds.filter(Boolean),
  };
}

async function isEligibleInstructorForEnrollment(userId, enrollmentId) {
  // Super/Admin bypass
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true }
  });
  if (!u) return false;
  const role = up(u.role);
  if (role === "SUPER_ADMIN" || role === "ADMIN") return true;
  if (role !== "INSTRUCTOR") return false;


  const enr = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    select: {
      id: true,
      courseId: true,
      departmentId: true,   
      course: {
        select: {
          id: true,
          CoursesAssigned: {  
            select: { collegeId: true, departmentId: true }
          }
        }
      }
    }
  });
  if (!enr) return false;

  const aff = await getInstructorAffiliation(userId);
  if (!aff) return false;
  const instructorCollegeId = aff.collegeId;
  const instructorDeptSet = new Set(aff.departmentIds || []);


  if (enr.departmentId) {
    if (instructorDeptSet.has(enr.departmentId)) return true;

    return false;
  }


  for (const a of enr.course.CoursesAssigned) {
    if (a.departmentId && instructorDeptSet.has(a.departmentId)) return true;
    if (!a.departmentId && instructorCollegeId && instructorCollegeId === a.collegeId) return true;
  }
  return false;
}

async function requireEligibleInstructorForEnrollment(req, res, next) {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    const ok = await isEligibleInstructorForEnrollment(req.user.id, req.params.id);
    if (!ok) return res.status(403).json({ error: "Forbidden: not eligible instructor for this course" });
    next();
  } catch (e) {
    console.error("eligibility error:", e);
    res.status(500).json({ error: "Internal error" });
  }
}
// Student org from latest Registration by email
async function getStudentOrgContext(userLike) {
  const email = String(userLike.email || "");
  if (!email) return null;
  const reg = await prisma.registration.findFirst({
    where: { email },
    orderBy: { updatedAt: "desc" },
    select: { collegeId: true, departmentId: true },
  });
  return reg || null;
}

// College-level assignment only (department ignored for student eligibility)
async function findAssignmentForCollege(courseId, collegeId) {
  if (!courseId || !collegeId) return null;
  return prisma.coursesAssigned.findFirst({ where: { courseId, collegeId } });
}

// ---- NEW: Instructor moderation must match department assignment ----
async function ensureCanModerateCourse(user, courseId) {
  if (isAdmin(user.role)) return true;
  if (!isInstructor(user.role)) return false;

  // Instructor's latest dept
  const instrReg = await prisma.registration.findFirst({
    where: { email: String(user.email || "") },
    orderBy: { updatedAt: "desc" },
    select: { departmentId: true },
  });
  if (!instrReg?.departmentId) return false;

  // Course must be assigned to THIS department
  const assigned = await prisma.coursesAssigned.findFirst({
    where: { courseId: String(courseId), departmentId: instrReg.departmentId },
    select: { id: true },
  });
  return !!assigned;
}

async function loadEnrollmentStatusConfig() {
  const rec = await prisma.setting.findUnique({ where: { key: "enrollment.statusConfig" } });
  if (!rec?.value) {
    return { allowed: ["PENDING", "APPROVED", "REJECTED"], approved_like: ["APPROVED"] };
  }
  const v = rec.value || {};
  return {
    allowed: Array.isArray(v.allowed) ? v.allowed.map(String) : [],
    approved_like: Array.isArray(v.approved_like) ? v.approved_like.map(String) : [],
  };
}

async function countApprovedLikeAtCollege(courseId, collegeId, approvedLikeStatuses) {
  if (!approvedLikeStatuses?.length) return 0;

  const approvedRows = await prisma.enrollment.findMany({
    where: { courseId, status: { in: approvedLikeStatuses } },
    select: { studentId: true },
  });
  if (approvedRows.length === 0) return 0;

  const studentIds = approvedRows.map((r) => r.studentId);
  const students = await prisma.user.findMany({
    where: { id: { in: studentIds } },
    select: { id: true, email: true },
  });

  const emails = students.map((s) => s.email);
  if (emails.length === 0) return 0;

  const regs = await prisma.registration.findMany({
    where: { email: { in: emails } },
    orderBy: { updatedAt: "desc" },
    select: { email: true, collegeId: true },
  });

  const latestCollegeByEmail = new Map();
  for (const r of regs) {
    if (!latestCollegeByEmail.has(r.email)) latestCollegeByEmail.set(r.email, r.collegeId);
  }

  const studentById = new Map(students.map((s) => [s.id, s]));
  let used = 0;
  for (const row of approvedRows) {
    const stu = studentById.get(row.studentId);
    if (stu && latestCollegeByEmail.get(stu.email) === collegeId) used += 1;
  }
  return used;
}

// ------------- ROUTES -------------

// List enrollments (filters: studentId, courseId, status, departmentId)
router.get("/enrollments", async (req, res) => {
  try {
    const { studentId, courseId, status, departmentId } = req.query;
    const where = {};
    if (studentId) {
      if (!isUuid(studentId)) return res.status(400).json({ error: "Invalid studentId format" });
      where.studentId = String(studentId);
    }
    if (courseId) {
      if (!isUuid(courseId)) return res.status(400).json({ error: "Invalid courseId format" });
      where.courseId = String(courseId);
    }
    if (status) where.status = String(status);
    if (departmentId) where.departmentId = String(departmentId);

    const rows = await prisma.enrollment.findMany({ where, orderBy: { createdAt: "desc" } });
    res.json(rows);
  } catch (e) {
    console.error("GET /enrollments error:", e);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Admin: create enrollment (auto-approve using first approved_like status)
router.post("/enrollments", requireAdmin, async (req, res) => {
  try {
    const { studentId, courseId } = req.body || {};
    if (!studentId || !courseId) {
      return res.status(400).json({ error: "studentId and courseId are required" });
    }
    if (!isUuid(studentId) || !isUuid(courseId)) {
      return res.status(400).json({ error: "Invalid ID format" });
    }

    const [student, statusCfg] = await Promise.all([
      prisma.user.findUnique({ where: { id: String(studentId) }, select: { id: true, email: true } }),
      loadEnrollmentStatusConfig(),
    ]);
    if (!student) return res.status(404).json({ error: "Student not found" });

    const org = await getStudentOrgContext(student);
    if (!org?.collegeId) return res.status(400).json({ error: "Student has no registration college" });

    const assignment = await findAssignmentForCollege(String(courseId), org.collegeId);
    if (!assignment) {
      return res.status(409).json({ error: "Course not assigned to student's college" });
    }

    const approvedLike = statusCfg.approved_like;
    const approvedStatus = approvedLike[0] || "APPROVED";

    if (assignment.capacity != null && approvedLike.includes(approvedStatus)) {
      const used = await countApprovedLikeAtCollege(String(courseId), org.collegeId, approvedLike);
      if (used >= assignment.capacity) {
        return res.status(409).json({
          error: `Capacity full (${used}/${assignment.capacity}) for this course at the college`,
        });
      }
    }

    const created = await prisma.enrollment.create({
      data: {
        studentId: String(studentId),
        courseId: String(courseId),
        status: approvedStatus,
        departmentId: org.departmentId ?? null, // for reporting
        startedAt: new Date(),
      },
    });

    res.status(201).json(created);
  } catch (e) {
    console.error("POST /enrollments error:", e);
    if (String(e.message || "").includes("Unique constraint"))
      return res.status(409).json({ error: "Student already enrolled in course" });
    res.status(500).json({ error: "Internal server error" });
  }
});

// Self enrollments
router.get("/enrollments/self", requireAuth, async (req, res) => {
  try {
    const rows = await prisma.enrollment.findMany({
      where: { studentId: String(req.user.id) },
      select: {
        id: true,
        courseId: true,
        studentId: true,
        status: true,
        progress: true,
        departmentId: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: "desc" },
    });
    res.json(rows);
  } catch (e) {
    console.error("GET /enrollments/self error:", e);
    res.status(500).json({ error: "Internal error" });
  }
});

// Admin: list enrollments for a course
router.get("/courses/:courseId/enrollments", requireAdmin, async (req, res) => {
  try {
    const courseId = coerceId(req.params.courseId);
    if (!isUuid(courseId)) return res.status(400).json({ error: "Invalid courseId" });

    const rows = await prisma.enrollment.findMany({
      where: { courseId },
      include: {
        student: { select: { id: true, fullName: true, email: true } },
        course: { select: { id: true, title: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json(
      rows.map((e) => ({
        id: e.id,
        courseId: e.courseId,
        courseTitle: e.course?.title || null,
        studentId: e.studentId,
        studentName: e.student?.fullName || null,
        studentEmail: e.student?.email || null,
        status: e.status,
        progress: e.progress,
        departmentId: e.departmentId || null,
      }))
    );
  } catch (e) {
    console.error("GET /courses/:courseId/enrollments error:", e);
    res.status(500).json({ error: "Internal error" });
  }
});

// Admin: create enrollment for a course
router.post("/courses/:courseId/enrollments", requireAdmin, async (req, res) => {
  try {
    const { courseId } = req.params;
    const { studentId } = req.body || {};
    if (!studentId) return res.status(400).json({ error: "studentId required" });
    if (!isUuid(courseId) || !isUuid(studentId))
      return res.status(400).json({ error: "Invalid ID format" });

    req.body.courseId = courseId;
    const fakeNext = { ...req, url: "/enrollments", method: "POST" };
    // @ts-ignore express internals
    return router.handle(fakeNext, res);
  } catch (e) {
    console.error("POST /courses/:courseId/enrollments error:", e);
    res.status(500).json({ error: "Internal error" });
  }
});

// Delete enrollment (admin)
router.delete("/enrollments/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    if (!isUuid(id)) return res.status(400).json({ error: "Invalid enrollment ID format" });
    await prisma.enrollment.delete({ where: { id } });
    res.json({ message: "Enrollment deleted successfully" });
  } catch (e) {
    console.error("DELETE /enrollments/:id error:", e);
    res.status(500).json({ error: "Internal server error" });
  }
});

// -------- Enrollment Request Flow (Student -> Pending) --------

// Student requests enrollment (PENDING or first non-approved allowed)
router.post("/courses/:courseId/enrollment-requests", requireAuth, async (req, res) => {
  try {
    const courseId = coerceId(req.params.courseId);
    const studentId = String(req.user.id);

    if (!isUuid(courseId)) return res.status(400).json({ error: "Invalid courseId" });
    if (!isStudent(req.user.role))
      return res.status(403).json({ error: "Only students can request enrollment" });

    const [statusCfg, existing] = await Promise.all([
      loadEnrollmentStatusConfig(),
      prisma.enrollment.findFirst({ where: { courseId, studentId } }),
    ]);
    if (existing) return res.json(existing);

    const org = await getStudentOrgContext(req.user);
    if (!org?.collegeId) return res.status(400).json({ error: "No registration college for student" });

    const assignment = await findAssignmentForCollege(courseId, org.collegeId);
    if (!assignment) {
      return res.status(409).json({ error: "Course not assigned to your college" });
    }

    const allowed = statusCfg.allowed;
    const pendingStatus = allowed.includes("PENDING")
      ? "PENDING"
      : allowed.find((s) => !statusCfg.approved_like.includes(s)) || (allowed[0] || "PENDING");

    const created = await prisma.enrollment.create({
      data: {
        courseId,
        studentId,
        status: pendingStatus,
        departmentId: org.departmentId ?? null,
      },
    });
    res.status(201).json(created);
  } catch (e) {
    console.error("POST /courses/:courseId/enrollment-requests error:", e);
    res.status(500).json({ error: "Internal error" });
  }
});

// Student: my requests
router.get("/enrollment-requests/me", requireAuth, async (req, res) => {
  try {
    const rows = await prisma.enrollment.findMany({
      where: { studentId: String(req.user.id) },
      select: {
        id: true,
        courseId: true,
        status: true,
        progress: true,
        departmentId: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: "desc" },
    });
    res.json(rows);
  } catch (e) {
    console.error("GET /enrollment-requests/me error:", e);
    res.status(500).json({ error: "Internal error" });
  }
});

// Instructor — pending requests for courses assigned to THEIR department
router.get("/instructor/enrollment-requests", requireAuth, async (req, res) => {
  try {
    if (!isInstructor(req.user.role)) {
      return res.status(403).json({ error: "Forbidden: only instructors can view requests" });
    }

    const instrReg = await prisma.registration.findFirst({
      where: { email: String(req.user.email || "") },
      orderBy: { updatedAt: "desc" },
      select: { departmentId: true },
    });
    if (!instrReg?.departmentId) return res.json([]);

    // Only courses assigned to this department (ignore college-wide assignments)
    const assignments = await prisma.coursesAssigned.findMany({
      where: { departmentId: instrReg.departmentId },
      select: { courseId: true },
    });
    if (assignments.length === 0) return res.json([]);

    const courseIds = [...new Set(assignments.map(a => a.courseId))];

    const rows = await prisma.enrollment.findMany({
      where: { courseId: { in: courseIds }, status: "PENDING" },
      include: {
        student: { select: { id: true, fullName: true, email: true } },
        course:  { select: { id: true, title: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json(rows.map((e) => ({
      id: e.id,
      courseId: e.courseId,
      courseTitle: e.course?.title || null,
      studentId: e.studentId,
      studentName: e.student?.fullName || null,
      studentEmail: e.student?.email || null,
      status: e.status,
    })));
  } catch (e) {
    console.error("GET /instructor/enrollment-requests error:", e);
    res.status(500).json({ error: "Internal error" });
  }
});

router.patch(
  "/enrollment-requests/:id",
  requireEligibleInstructorForEnrollment, // <-- your middleware from earlier
  async (req, res) => {
    try {
      const { id } = req.params;
      const { nextStatus } = req.body || {};

      if (!isUuid(id)) return res.status(400).json({ error: "Invalid id" });
      if (!nextStatus) return res.status(400).json({ error: "nextStatus required" });

      const next = normStatus(nextStatus);

      const statusCfg = await loadEnrollmentStatusConfig(); // { allowed:[], approved_like:[] ... }
      if (!statusCfg.allowed.map(normStatus).includes(next)) {
        return res.status(400).json({ error: "Invalid status" });
      }

      // Fetch enrollment with course + student; we also need departmentId on enrollment
      const enr = await prisma.enrollment.findUnique({
        where: { id },
        include: {
          course: { select: { id: true } },
          student: { select: { id: true, email: true } },
        },
      });
      if (!enr) return res.status(404).json({ error: "Not found" });

      // Capacity checks only when transitioning to an approved-like status
      const isApprovedLike = statusCfg.approved_like.map(normStatus).includes(next);
      if (isApprovedLike) {
        // Determine student org context (you already have this helper)
        const studentOrg = await getStudentOrgContext(enr.student); // -> { collegeId, departmentId? } based on your impl
        const collegeId = studentOrg?.collegeId || null;
        // department precedence: enrollment.departmentId first, otherwise student's org dept (if your flow uses it)
        const deptId = enr.departmentId || studentOrg?.departmentId || null;

        // Find the most specific assignment for this course/org context
        const assignment = await findAssignmentForContext(enr.courseId, collegeId, deptId);
        if (!assignment) {
          return res.status(409).json({ error: "Course not assigned for student's college/department" });
        }

        if (assignment.capacity != null) {
          let used = 0;

          if (assignment.departmentId) {
            // Department-scoped capacity
            used = await countApprovedLikeAtDepartment(
              enr.courseId,
              assignment.departmentId,
              statusCfg.approved_like.map(normStatus)
            );
          } else {
            // College-scoped capacity (your existing helper)
            used = await countApprovedLikeAtCollege(
              enr.courseId,
              assignment.collegeId,
              statusCfg.approved_like.map(normStatus)
            );
          }

          if (used >= assignment.capacity) {
            return res.status(409).json({
              error: `Capacity full (${used}/${assignment.capacity}) for this course${assignment.departmentId ? " in the department" : " at the college"}`,
            });
          }
        }
      }

      const updated = await prisma.enrollment.update({
        where: { id },
        data: {
          status: next,
          startedAt: enr.startedAt ?? new Date(),
        },
        select: {
          id: true,
          studentId: true,
          courseId: true,
          departmentId: true,
          status: true,
          startedAt: true,
          updatedAt: true,
        },
      });

      res.json(updated);
    } catch (e) {
      console.error("PATCH /enrollment-requests/:id error:", e);
      res.status(500).json({ error: "Internal error" });
    }
  }
);

// GET /courses/:courseId/enrollment-requests
// - Student: returns your single enrollment status for that course
// - Instructor/Admin: pass ?studentId=<uuid> to check a specific student; if not provided, returns list
router.get("/courses/:courseId/enrollment-requests", requireAuth, async (req, res) => {
  try {
    const courseId = String(req.params.courseId || "");
    if (!isUuid(courseId)) return res.status(400).json({ error: "Invalid courseId" });

    const statusCfg = await loadEnrollmentStatusConfig();
    const approvedLike = new Set(statusCfg.approved_like.map(normStatus));

    // ---------- Student view: only their own status ----------
    if (isStudent(req.user.role)) {
      const enr = await prisma.enrollment.findFirst({
        where: { courseId, studentId: String(req.user.id) },
        select: {
          id: true,
          courseId: true,
          studentId: true,
          status: true,
          departmentId: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      if (!enr) {
        return res.json({
          exists: false,
          status: null,
          isApproved: false,
          isRejected: false,
          message: "No enrollment request found for this course.",
        });
      }

      const st = normStatus(enr.status);
      return res.json({
        exists: true,
        id: enr.id,
        courseId: enr.courseId,
        studentId: enr.studentId,
        status: st,
        isApproved: approvedLike.has(st),
        isRejected: st === "REJECTED",
        departmentId: enr.departmentId,
        createdAt: enr.createdAt,
        updatedAt: enr.updatedAt,
      });
    }

    // ---------- Instructor/Admin view ----------
    // Optional: check a specific student ?studentId=...
    const { studentId } = req.query;

    // If instructor, ensure they’re allowed to see this course’s requests
    if (isInstructor(req.user.role)) {
      // reuse your existing check
      const ok = await ensureCanModerateCourse(req.user, courseId);
      if (!ok) return res.status(403).json({ error: "Forbidden: not eligible instructor for this course" });
    }

    // Admins do not need the eligibility check

    // If a specific student is provided, return a single status (like student view)
    if (studentId) {
      if (!isUuid(String(studentId))) return res.status(400).json({ error: "Invalid studentId" });

      const enr = await prisma.enrollment.findFirst({
        where: { courseId, studentId: String(studentId) },
        select: {
          id: true,
          courseId: true,
          studentId: true,
          status: true,
          departmentId: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      if (!enr) {
        return res.json({
          exists: false,
          status: null,
          isApproved: false,
          isRejected: false,
          message: "No enrollment request found for this student/course.",
        });
      }

      const st = normStatus(enr.status);
      return res.json({
        exists: true,
        id: enr.id,
        courseId: enr.courseId,
        studentId: enr.studentId,
        status: st,
        isApproved: approvedLike.has(st),
        isRejected: st === "REJECTED",
        departmentId: enr.departmentId,
        createdAt: enr.createdAt,
        updatedAt: enr.updatedAt,
      });
    }

    // No studentId -> return a list + quick counts for the course
    const rows = await prisma.enrollment.findMany({
      where: { courseId },
      select: {
        id: true,
        courseId: true,
        studentId: true,
        status: true,
        departmentId: true,
        createdAt: true,
        updatedAt: true,
        student: { select: { fullName: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    const list = rows.map((e) => {
      const st = normStatus(e.status);
      return {
        id: e.id,
        courseId: e.courseId,
        studentId: e.studentId,
        studentName: e.student?.fullName || null,
        studentEmail: e.student?.email || null,
        status: st,
        isApproved: approvedLike.has(st),
        isRejected: st === "REJECTED",
        departmentId: e.departmentId,
        createdAt: e.createdAt,
        updatedAt: e.updatedAt,
      };
    });

    const summary = list.reduce(
      (acc, r) => {
        if (r.isApproved) acc.approved += 1;
        else if (r.isRejected) acc.rejected += 1;
        else acc.pending += 1;
        acc.total += 1;
        return acc;
      },
      { total: 0, pending: 0, approved: 0, rejected: 0 }
    );

    return res.json({ summary, data: list });
  } catch (e) {
    console.error("GET /courses/:courseId/enrollment-requests error:", e);
    res.status(500).json({ error: "Internal error" });
  }
});

// -------- Bulk status update (INSTRUCTORS ONLY, dept-scoped) --------
router.patch("/enrollment-requests:bulk", requireAuth, async (req, res) => {
  try {
    if (!isInstructor(req.user.role)) {
      return res.status(403).json({ error: "Forbidden: only instructors can bulk update" });
    }

    const { ids = [], nextStatus } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0)
      return res.status(400).json({ error: "ids array required" });
    if (!ids.every(isUuid)) return res.status(400).json({ error: "Invalid IDs" });
    if (!nextStatus || typeof nextStatus !== "string")
      return res.status(400).json({ error: "nextStatus required (string)" });

    const statusCfg = await loadEnrollmentStatusConfig();
    const allowed = statusCfg.allowed;
    const approvedLike = new Set(statusCfg.approved_like);
    if (!allowed.includes(nextStatus)) {
      return res.status(400).json({ error: `Invalid status. Allowed: ${allowed.join(", ")}` });
    }

    const enrs = await prisma.enrollment.findMany({
      where: { id: { in: ids } },
      include: {
        course:  { select: { id: true } },
        student: { select: { id: true, email: true } },
      },
    });
    if (enrs.length === 0) return res.json({ updated: 0 });

    // Must be department-eligible for each course
    for (const enr of enrs) {
      const ok = await ensureCanModerateCourse(req.user, enr.courseId);
      if (!ok) {
        return res.status(403).json({ error: `Forbidden: not eligible instructor for course ${enr.courseId}` });
      }
    }

    if (approvedLike.has(nextStatus)) {
      // group by (courseId, collegeId)
      const buckets = new Map();
      for (const enr of enrs) {
        const org = await getStudentOrgContext(enr.student);
        const assignment = await findAssignmentForCollege(enr.courseId, org?.collegeId || null);
        if (!assignment) {
          return res.status(409).json({
            error: `Course not assigned for student's college (enrollment ${enr.id})`,
          });
        }
        const key = `${enr.courseId}:${assignment.collegeId}`;
        if (!buckets.has(key)) buckets.set(key, { list: [], assignment });
        buckets.get(key).list.push(enr);
      }

      for (const { list, assignment } of buckets.values()) {
        if (assignment.capacity == null) continue;
        const used = await countApprovedLikeAtCollege(
          assignment.courseId,
          assignment.collegeId,
          Array.from(approvedLike)
        );
        if (used + list.length > assignment.capacity) {
          return res.status(409).json({
            error: `Capacity exceeded for course ${assignment.courseId} at college ${assignment.collegeId} (${used}/${assignment.capacity})`,
          });
        }
      }

      const updated = await prisma.$transaction(
        enrs.map((enr) =>
          prisma.enrollment.update({
            where: { id: enr.id },
            data: { status: nextStatus, startedAt: enr.startedAt ?? new Date() },
          })
        )
      );
      return res.json({ updated: updated.length });
    }

    // Non-approved-like: simple bulk update
    const updated = await prisma.$transaction(
      enrs.map((enr) =>
        prisma.enrollment.update({
          where: { id: enr.id },
          data: { status: nextStatus },
        })
      )
    );
    res.json({ updated: updated.length });
  } catch (e) {
    console.error("PATCH /enrollment-requests:bulk error:", e);
    res.status(500).json({ error: "Internal error" });
  }
});

export default router;