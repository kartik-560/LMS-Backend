import express from 'express';
import { prisma } from '../config/prisma.js';
import { protect, authorize } from '../middleware/auth.js';
const router = express.Router();

const up = (s) => String(s || '').toUpperCase();
const isAdmin = (req) => ['ADMIN', 'SUPERADMIN', 'SUPER_ADMIN'].includes(up(req.user?.role));


router.post(
  '/chapters/:chapterId',
  authorize('ADMIN','SUPERADMIN','INSTRUCTOR','SUPER_ADMIN'),
  async (req, res) => {
    try {
      const { chapterId } = req.params;
      const {
        title,
        type = 'quiz',
        scope = 'chapter',
        timeLimitSeconds = null,
        maxAttempts = 1,
        isPublished = true,
        order = 1,
        questions = [],              
      } = req.body;

    
      const chapter = await prisma.chapter.findUnique({
        where: { id: String(chapterId) },
        select: { id: true, courseId: true },
      });
      if (!chapter) return res.status(404).json({ error: 'Chapter not found' });

      // 2) create assessment
      const assessment = await prisma.assessment.create({
        data: {
          title: String(title || 'Untitled Assessment'),
          type, scope,
          timeLimitSeconds,
          maxAttempts,
          isPublished,
          order,
          chapterId: chapter.id,
          courseId: chapter.courseId,
        },
        select: { id: true },
      });

      // 3) create questions if provided
      if (Array.isArray(questions) && questions.length) {
        const qData = questions.map((q, i) => ({
          assessmentId: assessment.id,
          prompt: String(q.prompt || ''),
          type: String(q.type || ''),                   // your UI sends: single/multiple/numerical/match/subjective
          options: Array.isArray(q.options) ? q.options.map(String) : [],
          correctOptionIndex:
            Number.isFinite(q.correctOptionIndex) ? q.correctOptionIndex : null,
          correctOptionIndexes:
            Array.isArray(q.correctOptionIndexes)
              ? q.correctOptionIndexes.map(Number)
              : [],
          correctText: q.correctText ?? null,
          pairs: q.pairs ?? null,                       // JSON field (for match)
          sampleAnswer: q.sampleAnswer ?? null,         // subjective
          points: Number.isFinite(q.points) ? q.points : 1,
          order: Number.isFinite(q.order) ? q.order : i + 1,
        }));

        await prisma.assessmentQuestion.createMany({ data: qData });
      }

      // 4) return assessment with questions
      const full = await prisma.assessment.findUnique({
        where: { id: assessment.id },
        include: { questions: { orderBy: [{ order: 'asc' }, { id: 'asc' }] } },
      });

      return res.status(201).json(full);
    } catch (e) {
      console.error('POST /api/assessments/chapters/:chapterId error:', e);
      return res.status(500).json({ error: 'Internal error' });
    }
  }
);

router.get('/', async (req, res) => {
  try {
    const { chapterId, courseId } = req.query;
    if (!chapterId && !courseId) {
      return res.status(400).json({ error: 'chapterId or courseId required' });
    }

    const where = chapterId
      ? { chapterId: String(chapterId), isPublished: true }
      : { courseId: String(courseId), isPublished: true };

    const rows = await prisma.assessment.findMany({
      where,
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        title: true,
        type: true,    
        scope: true,   
        timeLimitSeconds: true,
        maxAttempts: true,
        isPublished: true,
        order: true,
        chapterId: true,
        courseId: true,
      }
    });

    res.json(rows);
  } catch (e) {
    console.error('GET /assessments error:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});


router.get('/:id', async (req, res) => {
  try {
    const a = await prisma.assessment.findUnique({
      where: { id: String(req.params.id) },
      include: {
        questions: {
          orderBy: [{ order: 'asc' }, { id: 'asc' }],
        },
      },
    });
    if (!a) return res.status(404).json({ error: 'Not found' });

  
    if (!a.isPublished && !isAdmin(req)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    res.json(a);
  } catch (e) {
    console.error('GET /assessments/:id error:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});


router.post('/:id/attempts', async (req, res) => {
  try {
    const assessmentId = String(req.params.id);
    const userId = req.user?.id;

    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const assessment = await prisma.assessment.findUnique({
      where: { id: assessmentId },
      include: { questions: true },
    });
    if (!assessment) return res.status(404).json({ error: 'Not found' });
    if (!assessment.isPublished && !isAdmin(req)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const answers = req.body?.answers || {};
    let score = 0;
    let maxScore = 0;

    for (const q of assessment.questions) {
      const pts = typeof q.points === 'number' ? q.points : 1;
      maxScore += pts;

      const ans = answers[q.id];

      if (typeof q.correctOptionIndex === 'number') {
   
        if (Number(ans) === q.correctOptionIndex) score += pts;
        continue;
      }

      if (Array.isArray(q.correctOptionIndexes)) {
       
        const normalized = Array.isArray(ans) ? ans.map(Number).sort() : [];
        const correct = [...q.correctOptionIndexes].sort();
        if (
          normalized.length === correct.length &&
          normalized.every((v, i) => v === correct[i])
        ) {
          score += pts;
        }
        continue;
      }

  
    }

    const attempt = await prisma.assessmentAttempt.create({
      data: {
        assessmentId,
        studentId: userId,
        status: 'submitted',
        submittedAt: new Date(),
        score,
        maxScore,
        answers, 
      },
    });

    res.json({ attemptId: attempt.id, score, maxScore });
  } catch (e) {
    console.error('POST /assessments/:id/attempts error:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

// GET /api/progress/dashboard
router.get("/dashboard", protect, async (req, res) => {
  try {
    const studentId = req.user.id;

    // total courses enrolled
    const totalCourses = await prisma.enrollment.count({
      where: { studentId },
    });

    // completed chapters
    const completedChapters = await prisma.chapterProgress.count({
      where: { studentId },
    });

    // test average (latest attempt per assessment)
    const attempts = await prisma.assessmentAttempt.findMany({
      where: { studentId, status: "submitted" },
      orderBy: { submittedAt: "desc" },
      select: { assessmentId: true, score: true, maxScore: true },
    });
    const seen = new Set();
    let percentSum = 0, count = 0;
    for (const a of attempts) {
      if (seen.has(a.assessmentId)) continue;
      seen.add(a.assessmentId);
      if (a.maxScore > 0) {
        percentSum += (a.score / a.maxScore) * 100;
        count++;
      }
    }
    const averageTestScore = count ? Math.round(percentSum / count) : 0;

    // total time spent (sum of quiz durations + maybe track chapter open time)
    const totalTimeSpent = await prisma.chapterProgress.aggregate({
      where: { studentId },
      _sum: { timeSpentSeconds: true }, // add this field to ChapterProgress if you want
    });

    // certificates earned (assuming you have a Certificate model)
    const certificatesEarned = await prisma.certificate.count({
      where: { studentId },
    });

    res.json({
      data: {
        totalCourses,
        completedChapters,
        averageTestScore,
        totalTimeSpent: totalTimeSpent._sum.timeSpentSeconds || 0,
        certificatesEarned,
      },
    });
  } catch (e) {
    console.error("dashboard stats error:", e);
    res.status(500).json({ error: "Internal error" });
  }
});


router.put('/:id',
  protect,
  authorize('ADMIN','SUPERADMIN','INSTRUCTOR','SUPER_ADMIN'),
  async (req, res) => {
    try {
      const id = String(req.params.id);
      const {
        title,
        type = 'quiz',
        scope = 'chapter',
        timeLimitSeconds = null,
        maxAttempts = 1,
        isPublished = true,
        order = 1,
        questions = [],
      } = req.body;

      const existing = await prisma.assessment.findUnique({
        where: { id },
        select: { id: true }
      });
      if (!existing) return res.status(404).json({ error: 'Not found' });

      await prisma.assessment.update({
        where: { id },
        data: { title, type, scope, timeLimitSeconds, maxAttempts, isPublished, order }
      });

      // Replace questions (simplest approach)
      await prisma.assessmentQuestion.deleteMany({ where: { assessmentId: id } });

      if (Array.isArray(questions) && questions.length) {
        const qData = questions.map((q, i) => ({
          assessmentId: id,
          prompt: String(q.prompt || ''),
          type: String(q.type || ''),
          options: Array.isArray(q.options) ? q.options.map(String) : [],
          correctOptionIndex: Number.isFinite(q.correctOptionIndex) ? q.correctOptionIndex : null,
          correctOptionIndexes: Array.isArray(q.correctOptionIndexes) ? q.correctOptionIndexes.map(Number) : [],
          correctText: q.correctText ?? null,
          pairs: q.pairs ?? null,
          sampleAnswer: q.sampleAnswer ?? null,
          points: Number.isFinite(q.points) ? q.points : 1,
          order: Number.isFinite(q.order) ? q.order : i + 1,
        }));
        await prisma.assessmentQuestion.createMany({ data: qData });
      }

      const full = await prisma.assessment.findUnique({
        where: { id },
        include: { questions: { orderBy: [{ order: 'asc' }, { id: 'asc' }] } },
      });

      res.json(full);
    } catch (e) {
      console.error('PUT /assessments/:id error:', e);
      res.status(500).json({ error: 'Internal error' });
    }
  }
);


export default router;