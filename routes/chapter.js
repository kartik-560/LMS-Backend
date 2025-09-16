import express from "express";
import { prisma } from "../config/prisma.js";
import { requireAdmin } from "../middleware/roles.js";  // assuming roles.js contains the requireRole function

const router = express.Router();

// GET /courses/:courseId/chapters - Admin & SuperAdmin accessible (with different data)
router.get("/courses/:courseId/chapters", requireAdmin, async (req, res) => {
  const courseId = String(req.params.courseId);

  // Check if user is super admin
  const isSuperAdmin = String(req.user?.role || "").toUpperCase() === "SUPER_ADMIN";

  // Define fields to be selected based on role
  const baseSelect = { 
    id: true, 
    title: true, 
    order: true, 
    isPublished: true 
  };

  const superAdminSelect = { 
    ...baseSelect, 
    slug: true, 
    isPreview: true 
  };

  const select = isSuperAdmin ? superAdminSelect : baseSelect;

  try {
    const rows = await prisma.chapter.findMany({
      where: { courseId },
      orderBy: { order: "asc" },
      select,  
    });
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch chapters" });
  }
});

router.get("/chapters/:id", requireAdmin, async (req, res) => {
  const chapterId = String(req.params.id);

  try {
    const chapter = await prisma.chapter.findUnique({
      where: { id: chapterId },
      include: { assessments: { select: { id: true } } },
    });

    if (!chapter) return res.status(404).json({ error: "Chapter not found" });

    res.json(chapter);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch chapter" });
  }
});

router.post("/courses/:courseId/chapters", requireAdmin, async (req, res) => {
  const { courseId } = req.params;
  const { title, description, content, attachments, order, isPublished, isPreview } = req.body;

  try {
    const created = await prisma.chapter.create({
      data: {
        title,
        description,
        content,
        attachments,
        order,
        isPublished,
        isPreview,
        courseId: String(courseId),
      },
    });
    res.json({ id: created.id });
  } catch (error) {
    res.status(500).json({ error: "Failed to create chapter" });
  }
});

router.patch("/chapters/:id", requireAdmin, async (req, res) => {
  const { title, content, attachments, order, isPublished, isPreview } = req.body;

  try {
    const updated = await prisma.chapter.update({
      where: { id: String(req.params.id) },
      data: {
        ...(title !== undefined ? { title } : {}),
        ...(content !== undefined ? { content } : {}),
        ...(attachments !== undefined ? { attachments } : {}),
        ...(order !== undefined ? { order } : {}),
        ...(isPublished !== undefined ? { isPublished } : {}),
        ...(isPreview !== undefined ? { isPreview } : {}),
      },
    });

    res.json({ data: updated });
  } catch (error) {
    res.status(500).json({ error: "Failed to update chapter" });
  }
});

// DELETE /chapters/:id - Admin & SuperAdmin can delete a chapter
router.delete("/chapters/:id", requireAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    await prisma.$transaction([
      prisma.chapterProgress.deleteMany({ where: { chapterId: id } }),
      prisma.assessment.deleteMany({ where: { chapterId: id } }),
      prisma.chapter.delete({ where: { id } }),
    ]);

    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete chapter" });
  }
});

export default router;
