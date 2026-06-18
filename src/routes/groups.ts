import { Router, Response } from 'express';
import { prisma } from '../config/database';
import { AuthRequest, requireAuth } from '../middleware/auth';
import { getIO } from '../socket';

const router = Router();

// ─── Helper: build group response shape ──────────────────────────────────────
async function buildGroupResponse(groupId: string) {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    include: { members: true },
  });
  if (!group) return null;

  const members = group.members.map((m) => m.userId);
  const roles: Record<string, string> = {};
  group.members.forEach((m) => {
    roles[m.userId] = m.role;
  });

  return {
    id: group.id,
    name: group.name,
    creatorId: group.creatorId,
    createdAt: group.createdAt,
    members,
    roles,
  };
}

/**
 * GET /api/groups
 * Get all groups the authenticated user belongs to.
 */
router.get('/', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const memberships = await prisma.groupMember.findMany({
      where: { userId: req.user!.id },
      select: { groupId: true },
    });

    const groups = await Promise.all(
      memberships.map((m) => buildGroupResponse(m.groupId))
    );

    res.json(groups.filter(Boolean));
  } catch (error) {
    console.error('Error fetching groups:', error);
    res.status(500).json({ error: 'Failed to fetch groups' });
  }
});

/**
 * POST /api/groups
 * Create a new group. The creator becomes a member with their chosen role.
 */
router.post('/', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, role } = req.body;
    if (!name?.trim()) {
      res.status(400).json({ error: 'Group name is required' });
      return;
    }

    const group = await prisma.group.create({
      data: {
        name: name.trim(),
        creatorId: req.user!.id,
        members: {
          create: {
            userId: req.user!.id,
            role: role || 'Admin',
          },
        },
      },
    });

    res.status(201).json({ id: group.id, name: group.name, creatorId: group.creatorId });
  } catch (error) {
    console.error('Error creating group:', error);
    res.status(500).json({ error: 'Failed to create group' });
  }
});

/**
 * GET /api/groups/:id
 * Get a single group's details.
 */
router.get('/:id', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const group = await buildGroupResponse(req.params.id);
    if (!group) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }
    res.json(group);
  } catch (error) {
    console.error('Error fetching group:', error);
    res.status(500).json({ error: 'Failed to fetch group' });
  }
});

/**
 * DELETE /api/groups/:id
 * Delete a group. Only the creator can delete.
 */
router.delete('/:id', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const group = await prisma.group.findUnique({ where: { id: req.params.id } });
    if (!group) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }
    if (group.creatorId !== req.user!.id) {
      res.status(403).json({ error: 'Only the creator can delete this group' });
      return;
    }

    await prisma.group.delete({ where: { id: req.params.id } });
    getIO().to(`group:${req.params.id}`).emit('group-deleted', { groupId: req.params.id });

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting group:', error);
    res.status(500).json({ error: 'Failed to delete group' });
  }
});

/**
 * GET /api/groups/:id/members
 * Get all member profiles for a group.
 */
router.get('/:id/members', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const members = await prisma.groupMember.findMany({
      where: { groupId: req.params.id },
      include: {
        user: {
          select: { id: true, name: true, email: true, rollNumber: true },
        },
      },
    });

    const result = members.map((m) => ({
      id: m.user.id,
      name: m.user.name,
      email: m.user.email,
      rollNumber: m.user.rollNumber,
      role: m.role,
    }));

    res.json(result);
  } catch (error) {
    console.error('Error fetching members:', error);
    res.status(500).json({ error: 'Failed to fetch members' });
  }
});

/**
 * POST /api/groups/:id/join
 * Join a group using its invite code (the group ID).
 */
router.post('/:id/join', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const group = await prisma.group.findUnique({ where: { id: req.params.id } });
    if (!group) {
      res.status(404).json({ error: 'Invalid invite code. Group not found.' });
      return;
    }

    // Check if already a member
    const existing = await prisma.groupMember.findUnique({
      where: { userId_groupId: { userId: req.user!.id, groupId: req.params.id } },
    });
    if (existing) {
      res.status(400).json({ error: 'You are already a member of this group.' });
      return;
    }

    await prisma.groupMember.create({
      data: {
        userId: req.user!.id,
        groupId: req.params.id,
        role: 'Student',
      },
    });

    getIO().to(`group:${req.params.id}`).emit('member-joined', {
      groupId: req.params.id,
      userId: req.user!.id,
    });

    res.json({ success: true, groupName: group.name });
  } catch (error) {
    console.error('Error joining group:', error);
    res.status(500).json({ error: 'Failed to join group' });
  }
});

/**
 * POST /api/groups/:id/leave
 * Leave a group.
 */
router.post('/:id/leave', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await prisma.groupMember.delete({
      where: { userId_groupId: { userId: req.user!.id, groupId: req.params.id } },
    });

    getIO().to(`group:${req.params.id}`).emit('member-left', {
      groupId: req.params.id,
      userId: req.user!.id,
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Error leaving group:', error);
    res.status(500).json({ error: 'Failed to leave group' });
  }
});

/**
 * PATCH /api/groups/:id/roles
 * Change a member's role. Only Admin/Co-Admin/Teacher can do this.
 */
router.patch('/:id/roles', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { memberId, role } = req.body;
    if (!memberId || !role) {
      res.status(400).json({ error: 'memberId and role are required' });
      return;
    }

    // Verify requester has permission
    const requesterMember = await prisma.groupMember.findUnique({
      where: { userId_groupId: { userId: req.user!.id, groupId: req.params.id } },
    });
    const group = await prisma.group.findUnique({ where: { id: req.params.id } });

    if (!requesterMember || !group) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }

    const isCreator = group.creatorId === req.user!.id;
    const requesterRole = isCreator ? 'Admin' : requesterMember.role;
    const canChangeRoles = ['Admin', 'Co-Admin', 'Teacher'].includes(requesterRole);

    if (!canChangeRoles) {
      res.status(403).json({ error: 'Only Admin, Co-Admin, or Teacher can change roles' });
      return;
    }

    await prisma.groupMember.update({
      where: { userId_groupId: { userId: memberId, groupId: req.params.id } },
      data: { role },
    });

    getIO().to(`group:${req.params.id}`).emit('group-updated', { groupId: req.params.id });

    res.json({ success: true });
  } catch (error) {
    console.error('Error updating role:', error);
    res.status(500).json({ error: 'Failed to update role' });
  }
});

export default router;
