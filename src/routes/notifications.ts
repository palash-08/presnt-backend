import { Router, Response } from 'express';
import { prisma } from '../config/database';
import { AuthRequest, requireAuth } from '../middleware/auth';
import { getIO } from '../socket';
import { sendPushNotification } from '../utils/pushNotifications';

const router = Router();

/**
 * POST /api/notifications/group/:id
 * Send a notification to all members of a group.
 */
router.post('/group/:id', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { title, body, data } = req.body;
    if (!title || !body) {
      res.status(400).json({ error: 'title and body are required' });
      return;
    }

    // Fetch group members with push tokens
    const members = await prisma.groupMember.findMany({
      where: { groupId: req.params.id },
      include: {
        user: {
          select: { id: true, expoPushToken: true },
        },
      },
    });

    let notified = 0;
    for (const member of members) {
      // Create in-app notification
      const notification = await prisma.notification.create({
        data: {
          userId: member.user.id,
          title,
          body,
          data: data || {},
        },
      });

      // Emit real-time notification via WebSocket
      getIO().to(`user:${member.user.id}`).emit('notification-received', notification);

      // Send push notification if token exists
      if (member.user.expoPushToken) {
        sendPushNotification(member.user.expoPushToken, title, body, data || {}).catch((err) =>
          console.error(`Push failed for ${member.user.id}:`, err)
        );
      }

      notified++;
    }

    res.json({ success: true, notified });
  } catch (error) {
    console.error('Error notifying group:', error);
    res.status(500).json({ error: 'Failed to notify group members' });
  }
});

/**
 * POST /api/notifications/user/:id
 * Send a notification to a specific user.
 */
router.post('/user/:id', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { title, body, data } = req.body;
    if (!title || !body) {
      res.status(400).json({ error: 'title and body are required' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: { id: true, expoPushToken: true },
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Create in-app notification
    const notification = await prisma.notification.create({
      data: {
        userId: user.id,
        title,
        body,
        data: data || {},
      },
    });

    // Emit real-time notification
    getIO().to(`user:${user.id}`).emit('notification-received', notification);

    // Send push notification
    if (user.expoPushToken) {
      sendPushNotification(user.expoPushToken, title, body, data || {}).catch((err) =>
        console.error(`Push failed for ${user.id}:`, err)
      );
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error notifying user:', error);
    res.status(500).json({ error: 'Failed to notify user' });
  }
});

/**
 * GET /api/notifications/user/:id
 * Get all notifications for a user.
 */
router.get('/user/:id', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
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
