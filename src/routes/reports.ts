import { Router, Response } from 'express';
import { prisma } from '../config/database';
import { AuthRequest, requireAuth } from '../middleware/auth';

const router = Router();

/**
 * GET /api/reports/attendance?groupId=X&date=YYYY-MM-DD
 * Generate a CSV attendance report for a specific date.
 * Returns { csvContent, groupName } so the frontend can save and share it.
 */
router.get('/attendance', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { groupId, date } = req.query;
    if (!groupId || !date) {
      res.status(400).json({ error: 'groupId and date are required' });
      return;
    }

    const dateStr = date as string;

    // 1. Fetch group info
    const group = await prisma.group.findUnique({
      where: { id: groupId as string },
      include: {
        members: {
          include: {
            user: {
              select: { id: true, name: true, email: true, rollNumber: true, role: true },
            },
          },
        },
      },
    });

    if (!group) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }

    // Filter out teachers, EXCEPT in personal groups where we just want the members
    const students = group.isPersonal
      ? group.members
      : group.members.filter(
          (m) => m.role !== 'Teacher' && m.user.role !== 'teacher'
        );

    const studentProfiles: Record<string, { name: string; email: string; rollNumber: string }> = {};
    students.forEach((m) => {
      studentProfiles[m.user.id] = {
        name: m.user.name || 'Anonymous Student',
        email: m.user.email || '',
        rollNumber: m.user.rollNumber || 'N/A',
      };
    });

    // 3. Fetch subjects for the group
    const subjects = await prisma.subject.findMany({
      where: { groupId: groupId as string },
    });

    if (subjects.length === 0) {
      res.status(400).json({ error: 'No subjects found in this group to export.' });
      return;
    }

    // 4. Find classes on the requested date
    const classDateEntries: Record<string, string[]> = {};
    subjects.forEach((sub) => {
      const dates = sub.classDates || [];
      classDateEntries[sub.id] = dates.filter((d: string) => d.startsWith(dateStr));
    });

    const totalClassesTaught = Object.values(classDateEntries).reduce(
      (sum, list) => sum + list.length, 0
    );

    if (totalClassesTaught === 0) {
      res.status(400).json({ error: `No classes were recorded on ${dateStr}.` });
      return;
    }

    // 5. Fetch schedule for slot time resolution
    const scheduleItems = await prisma.schedule.findMany({
      where: { groupId: groupId as string },
    });

    // 6. Fetch all attendance history for the date
    const studentIds = Object.keys(studentProfiles);
    const allHistories = await prisma.attendanceHistory.findMany({
      where: {
        userId: { in: studentIds },
        dateKey: {
          in: Object.values(classDateEntries).flat(),
        },
      },
    });

    // Index histories by `userId:subjectId:dateKey`
    const historyIndex = new Map<string, boolean>();
    allHistories.forEach((h) => {
      historyIndex.set(`${h.userId}:${h.subjectId}:${h.dateKey}`, h.present);
    });

    // 7. Build rows and summary
    interface AttendanceRow {
      subjectName: string;
      timeSlot: string;
      studentName: string;
      studentRollNumber: string;
      studentEmail: string;
      status: 'Present' | 'Absent' | 'Not Marked';
    }

    const rows: AttendanceRow[] = [];
    const summaryStats: Record<string, {
      subjectName: string;
      timeSlot: string;
      total: number;
      present: number;
      absent: number;
    }> = {};

    Object.entries(classDateEntries).forEach(([subjectId, dates]) => {
      const sub = subjects.find((s) => s.id === subjectId);
      const subjectName = sub && sub.code ? `${sub.code} - ${sub.name}` : (sub?.name || 'Unknown');

      dates.forEach((classEntryKey) => {
        const parts = classEntryKey.split('_');
        const timeSlotLabel = parts.length > 1
          ? (scheduleItems.find((s) => s.id === parts[1])?.time || 'Scheduled Class')
          : 'Standard Class';

        summaryStats[classEntryKey] = {
          subjectName,
          timeSlot: timeSlotLabel,
          total: 0,
          present: 0,
          absent: 0,
        };

        studentIds.forEach((studentId) => {
          const student = studentProfiles[studentId];
          if (!student) return;

          const key = `${studentId}:${subjectId}:${classEntryKey}`;
          let status: 'Present' | 'Absent' | 'Not Marked' = 'Not Marked';

          if (historyIndex.has(key)) {
            const isPresent = historyIndex.get(key)!;
            status = isPresent ? 'Present' : 'Absent';
            summaryStats[classEntryKey].total += 1;
            if (isPresent) {
              summaryStats[classEntryKey].present += 1;
            } else {
              summaryStats[classEntryKey].absent += 1;
            }
          }

          rows.push({
            subjectName,
            timeSlot: timeSlotLabel,
            studentName: student.name,
            studentRollNumber: student.rollNumber,
            studentEmail: student.email,
            status,
          });
        });
      });
    });

    // Sort rows
    rows.sort((a, b) => {
      const subComp = a.subjectName.localeCompare(b.subjectName);
      if (subComp !== 0) return subComp;

      const timeComp = a.timeSlot.localeCompare(b.timeSlot);
      if (timeComp !== 0) return timeComp;

      const hasRollA = !!a.studentRollNumber && a.studentRollNumber.trim() !== '' && a.studentRollNumber !== 'N/A';
      const hasRollB = !!b.studentRollNumber && b.studentRollNumber.trim() !== '' && b.studentRollNumber !== 'N/A';

      if (hasRollA && !hasRollB) return -1;
      if (!hasRollA && hasRollB) return 1;

      if (hasRollA && hasRollB) {
        return a.studentRollNumber.trim().localeCompare(b.studentRollNumber.trim(), undefined, {
          numeric: true,
          sensitivity: 'base',
        });
      }

      return (a.studentName || '').localeCompare(b.studentName || '');
    });

    // 8. Build CSV
    let csvContent = `Presnt Attendance Report - ${dateStr}\n`;
    csvContent += `Group/Workspace: ${group.name} (Code: ${groupId})\n`;
    csvContent += `Exported On: ${new Date().toLocaleString()}\n\n`;

    csvContent += `CLASS SUMMARY\n`;
    csvContent += `Subject,Time Slot,Total Students,Present,Absent,Attendance Rate\n`;
    Object.values(summaryStats).forEach((stat) => {
      const rate = stat.total === 0 ? '0%' : `${Math.round((stat.present / stat.total) * 100)}%`;
      csvContent += `"${stat.subjectName}","${stat.timeSlot}","${stat.total}","${stat.present}","${stat.absent}","${rate}"\n`;
    });
    csvContent += `\n`;

    csvContent += `DETAILED STUDENT ATTENDANCE LIST\n`;
    csvContent += `Subject,Time Slot,Student Name,Roll Number,Email,Status\n`;
    rows.forEach((row) => {
      csvContent += `"${row.subjectName}","${row.timeSlot}","${row.studentName}","${row.studentRollNumber}","${row.studentEmail}","${row.status}"\n`;
    });

    res.json({ csvContent, groupName: group.name });
  } catch (error) {
    console.error('Error generating report:', error);
    res.status(500).json({ error: 'Failed to generate report' });
  }
});

export default router;
