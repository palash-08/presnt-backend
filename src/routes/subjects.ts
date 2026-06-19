import { Router, Response } from 'express';
import { prisma } from '../config/database';
import { AuthRequest, requireAuth } from '../middleware/auth';
import { getIO } from '../socket';

const router = Router();

/**
 * GET /api/subjects?groupId=X
 * Get all subjects for a group, sorted alphabetically.
 */
router.get('/', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { groupId } = req.query;
    if (!groupId) {
      res.status(400).json({ error: 'groupId is required' });
      return;
    }

    const subjects = await prisma.subject.findMany({
      where: { groupId: groupId as string },
      orderBy: { name: 'asc' },
    });

    res.json(subjects);
  } catch (error) {
    console.error('Error fetching subjects:', error);
    res.status(500).json({ error: 'Failed to fetch subjects' });
  }
});

/**
 * POST /api/subjects
 * Create a new subject in a group.
 */
router.post('/', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { groupId, name, code, credits, totalClasses } = req.body;
    if (!groupId || !name) {
      res.status(400).json({ error: 'groupId and name are required' });
      return;
    }

    const subject = await prisma.subject.create({
      data: {
        groupId,
        name,
        code: code || null,
        credits: credits !== undefined ? Number(credits) : 3,
        totalClasses: totalClasses || 0,
      },
    });

    getIO().to(`group:${groupId}`).emit('subjects-updated', { groupId });
    res.status(201).json(subject);
  } catch (error) {
    console.error('Error creating subject:', error);
    res.status(500).json({ error: 'Failed to create subject' });
  }
});

/**
 * PATCH /api/subjects/:id
 * Update a subject (name, code, credits, totalClasses, classDates).
 */
router.patch('/:id', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, code, credits, totalClasses, classDates } = req.body;
    const updateData: Record<string, any> = {};

    if (name !== undefined) updateData.name = name;
    if (code !== undefined) updateData.code = code;
    if (credits !== undefined) updateData.credits = Number(credits);
    if (totalClasses !== undefined) updateData.totalClasses = Number(totalClasses);
    if (classDates !== undefined) updateData.classDates = classDates;

    const subject = await prisma.subject.update({
      where: { id: req.params.id },
      data: updateData,
    });

    getIO().to(`group:${subject.groupId}`).emit('subjects-updated', { groupId: subject.groupId });
    res.json(subject);
  } catch (error) {
    console.error('Error updating subject:', error);
    res.status(500).json({ error: 'Failed to update subject' });
  }
});

/**
 * DELETE /api/subjects/:id
 * Delete a subject.
 */
router.delete('/:id', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const subject = await prisma.subject.findUnique({ where: { id: req.params.id } });
    if (!subject) {
      res.status(404).json({ error: 'Subject not found' });
      return;
    }

    await prisma.subject.delete({ where: { id: req.params.id } });
    getIO().to(`group:${subject.groupId}`).emit('subject-deleted', {
      groupId: subject.groupId,
      subjectId: req.params.id,
    });
    // Also emit updated events so all frontend tabs reload automatically
    getIO().to(`group:${subject.groupId}`).emit('subjects-updated', { groupId: subject.groupId });
    getIO().to(`group:${subject.groupId}`).emit('attendance-updated', { groupId: subject.groupId });
    getIO().to(`group:${subject.groupId}`).emit('schedule-updated', { groupId: subject.groupId });

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting subject:', error);
    res.status(500).json({ error: 'Failed to delete subject' });
  }
});

export default router;
