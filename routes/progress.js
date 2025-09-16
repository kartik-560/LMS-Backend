import express from "express";
import { prisma } from "../config/prisma.js";
import { protect } from "../middleware/auth.js"; // Protect middleware to ensure user is authenticated

const router = express.Router();


router.post("/chapters/:chapterId/complete", protect, async (req, res) => {
  try {
    const studentId = req.user.id;
    const chapterId = String(req.params.chapterId);

   
    const chapter = await prisma.chapter.findUnique({
      where: { id: chapterId },
      select: { id: true },
    });

    if (!chapter) return res.status(404).json({ error: "Chapter not found" });

    const now = new Date();
  
    await prisma.chapterProgress.upsert({
      where: { chapterId_studentId: { chapterId, studentId } },
      update: { isCompleted: true, completedAt: now },
      create: {
        chapterId,
        studentId,
        isCompleted: true,
        completedAt: now,
      },
    });

    res.json({ ok: true });
  } catch (e) {
    console.error("complete chapter", e);
    res.status(500).json({ error: "Internal error" });
  }
});


router.get("/course/:courseId/completed", protect, async (req, res) => {
  const studentId = req.user.id;
  const courseId = String(req.params.courseId);

  try {
    const rows = await prisma.chapterProgress.findMany({
      where: {
        studentId,
        isCompleted: true,
        chapter: { courseId },
      },
      select: { chapterId: true },
    });

    res.json({ data: rows.map(r => r.chapterId) });
  } catch (e) {
    console.error("Get completed chapters", e);
    res.status(500).json({ error: "Internal error" });
  }
});


router.get("/course/:courseId/summary", protect, async (req, res) => {
  try {
    const studentId = req.user.id;
    const courseId = String(req.params.courseId);


    const [chaptersTotal, textChaptersTotal] = await Promise.all([
      prisma.chapter.count({ where: { courseId } }),
      prisma.chapter.count({
        where: {
          courseId,
          assessments: { none: {} }, 
        },
      }),
    ]);

    const [chaptersDone, textChaptersDone] = await Promise.all([
      prisma.chapterProgress.count({
        where: {
          studentId,
          isCompleted: true,
          chapter: { courseId },
        },
      }),
      prisma.chapterProgress.count({
        where: {
          studentId,
          isCompleted: true,
          chapter: { courseId, assessments: { none: {} } }, 
        },
      }),
    ]);


    const attempts = await prisma.assessmentAttempt.findMany({
      where: {
        studentId,
        status: "submitted",
        submittedAt: { not: null },
        assessment: { courseId },
      },
      orderBy: { submittedAt: "desc" },
      select: { assessmentId: true, score: true, maxScore: true },
    });

   
    const seen = new Set();
    let sumPct = 0;
    let taken = 0;
    for (const a of attempts) {
      if (seen.has(a.assessmentId)) continue;
      seen.add(a.assessmentId);
      if ((a.maxScore ?? 0) > 0) {
        sumPct += (a.score / a.maxScore) * 100;
        taken += 1;
      }
    }
    const averagePercent = taken ? Math.round(sumPct / taken) : 0;


    const timeAgg = await prisma.chapterProgress.aggregate({
      where: { studentId, chapter: { courseId } },
      _sum: { timeSpent: true },
    });
    const totalTimeSpent = timeAgg._sum.timeSpent || 0;

    res.json({
      data: {
        chapters: { done: chaptersDone, total: chaptersTotal },
        modules: { done: textChaptersDone, total: textChaptersTotal },
        tests: { averagePercent, taken },
        totalTimeSpent,
      },
    });
  } catch (e) {
    console.error("progress summary", e);
    res.status(500).json({ error: "Internal error" });
  }
});

export default router;
