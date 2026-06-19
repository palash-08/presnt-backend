import { Router, Response } from 'express';
import { prisma } from '../config/database';
import { AuthRequest, requireAuth } from '../middleware/auth';
import { getIO } from '../socket';

const router = Router();

/**
 * GET /api/schedule?groupId=X
 * Get all schedule entries for a group.
 */
router.get('/', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { groupId } = req.query;
    if (!groupId) {
      res.status(400).json({ error: 'groupId is required' });
      return;
    }

    const schedule = await prisma.schedule.findMany({
      where: { groupId: groupId as string },
    });

    res.json(schedule);
  } catch (error) {
    console.error('Error fetching schedule:', error);
    res.status(500).json({ error: 'Failed to fetch schedule' });
  }
});

/**
 * POST /api/schedule
 * Create a new schedule entry.
 */
router.post('/', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { groupId, subjectId, subjectName, subjectCode, dayOfWeek, time, room } = req.body;
    if (!groupId || !subjectId || !subjectName || !dayOfWeek || !time) {
      res.status(400).json({ error: 'groupId, subjectId, subjectName, dayOfWeek, and time are required' });
      return;
    }

    const entry = await prisma.schedule.create({
      data: {
        groupId,
        subjectId,
        subjectName,
        subjectCode: subjectCode || null,
        dayOfWeek,
        time,
        room: room || 'N/A',
      },
    });

    getIO().to(`group:${groupId}`).emit('schedule-updated', { groupId });
    res.status(201).json(entry);
  } catch (error) {
    console.error('Error creating schedule entry:', error);
    res.status(500).json({ error: 'Failed to create schedule entry' });
  }
});

/**
 * DELETE /api/schedule/:id
 * Delete a schedule entry.
 */
router.delete('/:id', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const entry = await prisma.schedule.findUnique({ where: { id: req.params.id } });
    if (!entry) {
      res.status(404).json({ error: 'Schedule entry not found' });
      return;
    }

    await prisma.schedule.delete({ where: { id: req.params.id } });
    getIO().to(`group:${entry.groupId}`).emit('schedule-deleted', {
      groupId: entry.groupId,
      scheduleId: req.params.id,
    });
    // Also emit schedule-updated so all frontend tabs reload automatically
    getIO().to(`group:${entry.groupId}`).emit('schedule-updated', { groupId: entry.groupId });

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting schedule entry:', error);
    res.status(500).json({ error: 'Failed to delete schedule entry' });
  }
});

export default router;
