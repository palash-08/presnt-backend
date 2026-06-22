import { Router, Response } from 'express';
import { prisma } from '../config/database';
import { AuthRequest, requireAuth } from '../middleware/auth';
import { getIO } from '../socket';
import { sendPushNotification } from '../utils/pushNotifications';

const router = Router();

/**
 * GET /api/attendance?userId=X
 * Get a user's attendance records (summary per subject).
 * The frontend indexes these by subjectId.
 */
router.get('/', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = (req.query.userId as string) || req.user!.id;

    const records = await prisma.attendanceRecord.findMany({
      where: { userId },
    });

    res.json(records);
  } catch (error) {
    console.error('Error fetching attendance:', error);
    res.status(500).json({ error: 'Failed to fetch attendance' });
  }
});

/**
 * GET /api/attendance/students?groupId=X&subjectId=X&date=X&slotId=X
 * Get students in a group with their attendance status for a specific date/slot.
 * Used by the admin attendance marking panel.
 */
router.get('/students', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { groupId, subjectId, date, slotId } = req.query;
    if (!groupId || !subjectId || !date) {
      res.status(400).json({ error: 'groupId, subjectId, and date are required' });
      return;
    }

    const dateKey = slotId ? `${date}_${slotId}` : (date as string);

    const group = await prisma.group.findUnique({
      where: { id: groupId as string },
    });

    // Fetch group members with their profiles
    const members = await prisma.groupMember.findMany({
      where: { groupId: groupId as string },
      include: {
        user: {
          select: { id: true, name: true, email: true, rollNumber: true, role: true },
        },
      },
    });

    // Filter out non-students (Teachers, Admins, Co-Admins), EXCEPT in personal groups
    const NON_STUDENT_ROLES = ['Teacher', 'Admin', 'Co-Admin'];
    const students = group?.isPersonal
      ? members
      : members.filter(
          (m) => !NON_STUDENT_ROLES.includes(m.role) && m.user.role !== 'teacher' && m.user.role !== 'admin'
        );

    // Fetch attendance history for all students in one query
    const histories = await prisma.attendanceHistory.findMany({
      where: {
        subjectId: subjectId as string,
        dateKey,
        userId: { in: students.map((s) => s.user.id) },
      },
    });

    const historyMap = new Map(histories.map((h) => [h.userId, h.present]));

    // Build response
    const result = students.map((m) => ({
      id: m.user.id,
      name: m.user.name,
      email: m.user.email,
      rollNumber: m.user.rollNumber,
      role: m.user.role,
      wasPresent: historyMap.has(m.user.id) ? historyMap.get(m.user.id)! : true,
    }));

    // Sort: roll numbers first (natural sort), then alphabetically by name
    result.sort((a, b) => {
      const hasRollA = !!a.rollNumber && a.rollNumber.trim() !== '';
      const hasRollB = !!b.rollNumber && b.rollNumber.trim() !== '';

      if (hasRollA && !hasRollB) return -1;
      if (!hasRollA && hasRollB) return 1;

      if (hasRollA && hasRollB) {
        return a.rollNumber!.trim().localeCompare(b.rollNumber!.trim(), undefined, {
          numeric: true,
          sensitivity: 'base',
        });
      }

      return (a.name || '').localeCompare(b.name || '');
    });

    res.json(result);
  } catch (error) {
    console.error('Error fetching students for attendance:', error);
    res.status(500).json({ error: 'Failed to fetch students' });
  }
});

/**
 * GET /api/attendance/:subjectId/history?userId=X
 * Get detailed attendance history for a subject.
 */
router.get('/:subjectId/history', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = (req.query.userId as string) || req.user!.id;

    const history = await prisma.attendanceHistory.findMany({
      where: {
        userId,
        subjectId: req.params.subjectId as string,
      },
      orderBy: { date: 'desc' },
    });

    res.json(history);
  } catch (error) {
    console.error('Error fetching attendance history:', error);
    res.status(500).json({ error: 'Failed to fetch attendance history' });
  }
});

/**
 * POST /api/attendance/mark
 * Admin bulk mark attendance for all students in a group.
 * This is the most complex endpoint — mirrors the old Firestore writeBatch logic.
 */
router.post('/mark', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const {
      subjectId,
      subjectName,
      subjectCode,
      date,
      slotId,
      slotTime,
      students, // { [studentId]: boolean }
      groupId,
      groupName,
    } = req.body;

    if (!subjectId || !date || !students || !groupId) {
      res.status(400).json({ error: 'subjectId, date, students, and groupId are required' });
      return;
    }

    const dateKey = slotId ? `${date}_${slotId}` : date;
    const parts = date.split('-');
    const classDateObj = new Date(
      parseInt(parts[0], 10),
      parseInt(parts[1], 10) - 1,
      parseInt(parts[2], 10)
    );

    // Fetch subject to check totalClasses and classDates
    const subject = await prisma.subject.findUnique({ where: { id: subjectId } });
    if (!subject) {
      res.status(404).json({ error: 'Subject not found' });
      return;
    }

    const alreadyMarked = subject.classDates.includes(dateKey);
    const studentIds = Object.keys(students);

    // Fetch all existing records and histories in bulk
    const [existingRecords, existingHistories, studentUsers] = await Promise.all([
      prisma.attendanceRecord.findMany({
        where: { subjectId, userId: { in: studentIds } },
      }),
      prisma.attendanceHistory.findMany({
        where: { subjectId, dateKey, userId: { in: studentIds } },
      }),
      prisma.user.findMany({
        where: { id: { in: studentIds } },
        select: { id: true, name: true, expoPushToken: true },
      }),
    ]);

    const recordMap = new Map(existingRecords.map((r) => [r.userId, r]));
    const historyMap = new Map(existingHistories.map((h) => [h.userId, h]));
    const userMap = new Map(studentUsers.map((u) => [u.id, u]));

    // Use a transaction for atomicity
    await prisma.$transaction(async (tx) => {
      for (const studentId of studentIds) {
        const isPresent = students[studentId];
        const existingRecord = recordMap.get(studentId);
        const existingHistory = historyMap.get(studentId);

        let attended = existingRecord?.attended || 0;
        let total = existingRecord?.total || 0;

        if (existingHistory) {
          // Class was already marked — check for status change
          const wasPresent = existingHistory.present;
          if (isPresent && !wasPresent) {
            attended += 1;
          } else if (!isPresent && wasPresent) {
            attended = Math.max(0, attended - 1);
          }
          // total stays the same for re-marks
        } else {
          // New class session
          total += 1;
          if (isPresent) {
            attended += 1;
          }
        }

        // Upsert attendance record
        await tx.attendanceRecord.upsert({
          where: { userId_subjectId: { userId: studentId, subjectId } },
          update: { attended, total, subjectName, subjectCode: subjectCode || null },
          create: {
            userId: studentId,
            subjectId,
            subjectName,
            subjectCode: subjectCode || null,
            attended,
            total,
          },
        });

        // Upsert attendance history
        await tx.attendanceHistory.upsert({
          where: { userId_subjectId_dateKey: { userId: studentId, subjectId, dateKey } },
          update: { present: isPresent },
          create: {
            userId: studentId,
            subjectId,
            date: classDateObj,
            slotId: slotId || null,
            slotTime: slotTime || null,
            present: isPresent,
            dateKey,
          },
        });

        // Create notification
        const displaySubName = subjectCode ? `${subjectCode} - ${subjectName}` : subjectName;
        const groupNameText = groupName ? ` in ${groupName}` : '';
        const notifBody = `You were marked ${isPresent ? 'PRESENT' : 'ABSENT'} for ${displaySubName}${groupNameText} on ${date}${slotTime ? ` at ${slotTime}` : ''}.`;

        const notification = await tx.notification.create({
          data: {
            userId: studentId,
            title: 'Attendance Marked',
            body: notifBody,
            data: {},
          },
        });

        // Emit real-time notification
        getIO().to(`user:${studentId}`).emit('notification-received', notification);

        // Send push notification asynchronously (don't block transaction)
        const user = userMap.get(studentId);
        if (user?.expoPushToken) {
          sendPushNotification(user.expoPushToken, 'Attendance Marked', notifBody).catch((err) =>
            console.error(`Push notification failed for ${studentId}:`, err)
          );
        }
      }

      // Update subject totalClasses if not already marked
      if (!alreadyMarked) {
        await tx.subject.update({
          where: { id: subjectId },
          data: {
            totalClasses: subject.totalClasses + 1,
            classDates: [...subject.classDates, dateKey],
          },
        });
      }
    });

    const newTotalClasses = alreadyMarked ? subject.totalClasses : subject.totalClasses + 1;

    getIO().to(`group:${groupId}`).emit('attendance-updated', { groupId });
    getIO().to(`group:${groupId}`).emit('subjects-updated', { groupId });

    res.json({ success: true, totalClasses: newTotalClasses });
  } catch (error) {
    console.error('Error marking attendance:', error);
    res.status(500).json({ error: 'Failed to submit attendance' });
  }
});

/**
 * POST /api/attendance/self-mark
 * Student self-mark attendance (quick attend/bunk buttons).
 */
router.post('/self-mark', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { subjectId, subjectName, type } = req.body;
    if (!subjectId || !type) {
      res.status(400).json({ error: 'subjectId and type are required' });
      return;
    }

    const existing = await prisma.attendanceRecord.findUnique({
      where: { userId_subjectId: { userId: req.user!.id, subjectId } },
    });

    const attended = (existing?.attended || 0) + (type === 'attend' ? 1 : 0);
    const total = (existing?.total || 0) + 1;

    const record = await prisma.attendanceRecord.upsert({
      where: { userId_subjectId: { userId: req.user!.id, subjectId } },
      update: { attended, total, subjectName },
      create: {
        userId: req.user!.id,
        subjectId,
        subjectName,
        attended,
        total,
      },
    });

    res.json(record);
  } catch (error) {
    console.error('Error self-marking attendance:', error);
    res.status(500).json({ error: 'Failed to mark attendance' });
  }
});

/**
 * POST /api/attendance/reset
 * Reset attendance counters for a subject (student resets their own).
 */
router.post('/reset', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { subjectId, subjectName } = req.body;
    if (!subjectId) {
      res.status(400).json({ error: 'subjectId is required' });
      return;
    }

    const record = await prisma.attendanceRecord.upsert({
      where: { userId_subjectId: { userId: req.user!.id, subjectId } },
      update: { attended: 0, total: 0 },
      create: {
        userId: req.user!.id,
        subjectId,
        subjectName: subjectName || '',
        attended: 0,
        total: 0,
      },
    });

    res.json(record);
  } catch (error) {
    console.error('Error resetting attendance:', error);
    res.status(500).json({ error: 'Failed to reset attendance' });
  }
});

export default router;
