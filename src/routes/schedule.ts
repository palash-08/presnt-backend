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
    const id = req.params.id as string;
    const entry = await prisma.schedule.findUnique({ where: { id } });
    if (!entry) {
      res.status(404).json({ error: 'Schedule entry not found' });
      return;
    }

    // Restrict deletion if slot time has passed in the current week
    const dayIndexMap: Record<string, number> = {
      'Sunday': 0, 'Monday': 1, 'Tuesday': 2, 'Wednesday': 3,
      'Thursday': 4, 'Friday': 5, 'Saturday': 6
    };
    
    const today = new Date();
    const todayDayIndex = today.getDay();
    const targetDayIndex = dayIndexMap[entry.dayOfWeek];
    
    if (targetDayIndex !== undefined) {
      const todayOrder = todayDayIndex === 0 ? 7 : todayDayIndex;
      const targetOrder = targetDayIndex === 0 ? 7 : targetDayIndex;
      
      let isPassed = false;
      if (targetOrder < todayOrder) {
        isPassed = true;
      } else if (targetOrder === todayOrder) {
        const parts = entry.time.split('-');
        if (parts.length === 2) {
          const endTimeStr = parts[1].trim();
          const [hoursStr, minutesStr] = endTimeStr.split(':');
          const hours = parseInt(hoursStr, 10);
          const minutes = parseInt(minutesStr, 10);
          if (!isNaN(hours) && !isNaN(minutes)) {
            const slotEndTime = new Date(today);
            slotEndTime.setHours(hours, minutes, 0, 0);
            isPassed = today.getTime() > slotEndTime.getTime();
          }
        }
      }
      
      if (isPassed) {
        res.status(400).json({ error: 'Cannot delete a schedule slot whose time has already passed' });
        return;
      }
    }

    // ─── Attendance Rollback Logic ───────────────────────────────────────────
    const histories = await prisma.attendanceHistory.findMany({
      where: { slotId: id },
    });

    if (histories.length > 0) {
      const historyIds = histories.map(h => h.id);
      const uniqueDateKeys = Array.from(new Set(histories.map(h => h.dateKey)));
      
      await prisma.$transaction(async (tx) => {
        // 1. Rollback Subject totals
        if (uniqueDateKeys.length > 0) {
          const subject = await tx.subject.findUnique({ where: { id: entry.subjectId } });
          if (subject) {
            const newClassDates = subject.classDates.filter(dk => !uniqueDateKeys.includes(dk));
            const newTotalClasses = Math.max(0, subject.totalClasses - uniqueDateKeys.length);
            await tx.subject.update({
              where: { id: entry.subjectId },
              data: { classDates: newClassDates, totalClasses: newTotalClasses }
            });
          }
        }

        // 2. Rollback AttendanceRecords
        const userHistories = new Map<string, any[]>();
        for (const h of histories) {
          if (!userHistories.has(h.userId)) userHistories.set(h.userId, []);
          userHistories.get(h.userId)!.push(h);
        }

        for (const [userId, userHists] of userHistories.entries()) {
          const record = await tx.attendanceRecord.findUnique({
            where: { userId_subjectId: { userId, subjectId: entry.subjectId } }
          });
          if (record) {
            const presentsToSubtract = userHists.filter(h => h.present).length;
            const totalToSubtract = userHists.length; // total marked classes for this user for this slot
            await tx.attendanceRecord.update({
              where: { id: record.id },
              data: {
                attended: Math.max(0, record.attended - presentsToSubtract),
                total: Math.max(0, record.total - totalToSubtract),
              }
            });
          }
        }

        // 3. Delete AttendanceHistory logs
        await tx.attendanceHistory.deleteMany({
          where: { id: { in: historyIds } }
        });
      });
    }

    // ─── End Attendance Rollback ─────────────────────────────────────────────

    await prisma.schedule.delete({ where: { id } });
    getIO().to(`group:${entry.groupId}`).emit('schedule-deleted', {
      groupId: entry.groupId,
      scheduleId: id,
    });
    // Also emit schedule-updated so all frontend tabs reload automatically
    getIO().to(`group:${entry.groupId}`).emit('schedule-updated', { groupId: entry.groupId });
    if (histories.length > 0) {
      getIO().to(`group:${entry.groupId}`).emit('attendance-updated', { groupId: entry.groupId });
      getIO().to(`group:${entry.groupId}`).emit('subjects-updated', { groupId: entry.groupId });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting schedule entry:', error);
    res.status(500).json({ error: 'Failed to delete schedule entry' });
  }
});

export default router;
