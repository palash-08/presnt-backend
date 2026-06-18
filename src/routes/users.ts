import { Router, Response } from 'express';
import { prisma } from '../config/database';
import { AuthRequest, requireAuth } from '../middleware/auth';

const router = Router();

/**
 * PATCH /api/users/:id
 * Update user profile (rollNumber, expoPushToken).
 * Only the authenticated user can update their own profile.
 */
router.patch('/:id', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (req.user!.id !== req.params.id) {
      res.status(403).json({ error: 'You can only update your own profile' });
      return;
    }

    const { rollNumber, expoPushToken } = req.body;
    const updateData: Record<string, any> = {};

    if (rollNumber !== undefined) updateData.rollNumber = rollNumber;
    if (expoPushToken !== undefined) updateData.expoPushToken = expoPushToken;

    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: updateData,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        rollNumber: true,
        expoPushToken: true,
      },
    });

    res.json(user);
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

/**
 * GET /api/users/:id/notifications
 * Get all notifications for a user, ordered by most recent first.
 */
router.get('/:id/notifications', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (req.user!.id !== req.params.id) {
      res.status(403).json({ error: 'You can only view your own notifications' });
      return;
    }

    const notifications = await prisma.notification.findMany({
      where: { userId: req.params.id },
      orderBy: { createdAt: 'desc' },
    });

    res.json(notifications);
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

export default router;
