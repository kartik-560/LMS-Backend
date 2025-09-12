import express from "express";
import { prisma } from "../config/prisma.js";   

const router = express.Router();

const up = (s) => String(s || "").toUpperCase();

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });
  const r = up(req.user.role);
  if (r !== "ADMIN" && r !== "SUPER_ADMIN") {
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
}


router.get("/chapters", async (req, res) => {
  const { courseId } = req.query;
  if (!courseId) return res.status(400).json({ error: "courseId required" });

  const chapters = await prisma.chapter.findMany({
    where: { courseId: String(courseId)},
    orderBy: { order: "asc" },
    include: { assessments: { select: { id: true } } },
  });

  res.json(chapters);
});

router.get("/chapters/:id", async (req, res) => {
  const chapter = await prisma.chapter.findUnique({
    where: { id: String(req.params.id) },
    include: { assessments: { select: { id: true } } },
  });
  if (!chapter) return res.status(404).json({ error: "Not found" });
  res.json(chapter);
});


router.get("/courses/:courseId/chapters", requireAdmin, async (req, res) => {
  const rows = await prisma.chapter.findMany({
    where: { courseId: String(req.params.courseId) },
    orderBy: { order: "asc" },
  });
  res.json(rows);
});

router.post("/courses/:courseId/chapters", requireAdmin, async (req, res) => {
  const created = await prisma.chapter.create({
    data: { ...req.body, courseId: String(req.params.courseId) },
  });
  res.json({ id: created.id });
});

router.patch("/chapters/:id", requireAdmin, async (req, res) => {
  const { title, content, attachments, order, isPublished } = req.body;

  const updated = await prisma.chapter.update({
    where: { id: String(req.params.id) },
    data: {
      ...(title !== undefined ? { title } : {}),
      ...(content !== undefined ? { content } : {}),
      ...(attachments !== undefined ? { attachments } : {}), // overwrites array
      ...(order !== undefined ? { order } : {}),
      ...(isPublished !== undefined ? { isPublished } : {}),
    },
  });

  res.json({ data: updated });
});


router.delete("/chapters/:id", requireAdmin, async (req, res) => {
  const { id } = req.params;
  await prisma.chapterProgress.deleteMany({ where: { chapterId: id } });
  await prisma.assessment.deleteMany({ where: { chapterId: id } });
  await prisma.chapter.delete({ where: { id } });
  res.json({ ok: true });
});

export default router;
