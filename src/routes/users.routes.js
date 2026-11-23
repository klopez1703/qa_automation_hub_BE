const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const prisma = require('../config/db');

const router = express.Router();

function createMailTransporter() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    return null;
  }
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

function generateTempPassword() {
  const random = crypto.randomBytes(5).toString('base64').replace(/[^a-zA-Z0-9]/g, '');
  return `QA#${random}${Math.floor(10 + Math.random() * 89)}`;
}

async function resolveRoleId(roleId, roleName) {
  if (roleId) return Number(roleId);
  if (roleName) {
    const found = await prisma.role.findUnique({ where: { name: roleName } });
    if (found) return found.id;
  }
  const defaultRole = await prisma.role.findFirst({
    where: { name: { in: ['QA_MANUAL', 'QA_FUNCIONAL', 'QA'] } },
  });
  return defaultRole ? defaultRole.id : 2;
}

// ==========================================
// ROLES DE USUARIO (TABLA ROLE)
// ==========================================

// GET /api/users/roles - Listar roles desde la tabla Role
router.get('/roles', async (req, res) => {
  try {
    const roles = await prisma.role.findMany({
      orderBy: { id: 'asc' },
    });
    res.json(roles);
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener roles', error: error.message });
  }
});

// POST /api/users/roles - Registrar un nuevo rol en la tabla Role (ej. QA_AUTOMATIZADOR)
router.post('/roles', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'El nombre del rol es obligatorio.' });
    }

    const normalized = name.trim();
    const exists = await prisma.role.findUnique({ where: { name: normalized } });
    if (exists) {
      return res.status(400).json({ message: 'Ese rol ya existe en la base de datos.' });
    }

    const created = await prisma.role.create({
      data: { name: normalized },
    });

    res.status(201).json(created);
  } catch (error) {
    res.status(500).json({ message: 'Error al crear rol', error: error.message });
  }
});

// ==========================================
// ESTRUCTURA ORGANIZACIONAL (JEFE QA -> CHAPTER MEMBER -> SQUADS)
// ==========================================

// GET /api/users/org-structure
router.get('/org-structure', async (req, res) => {
  try {
    const chapterMembers = await prisma.chapterMember.findMany({
      where: { active: true },
      include: {
        squads: {
          where: { active: true },
          include: {
            users: {
              select: {
                id: true,
                name: true,
                email: true,
                roleId: true,
                role: true,
                active: true,
              },
              orderBy: { name: 'asc' },
            },
          },
          orderBy: { name: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    });

    const squads = await prisma.squad.findMany({
      where: { active: true },
      include: {
        chapterMember: true,
        users: {
          select: {
            id: true,
            name: true,
            email: true,
            roleId: true,
            role: true,
            active: true,
          },
          orderBy: { name: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    });

    const qaHeadName = chapterMembers[0]?.qaHeadName || 'Joseph';

    res.json({
      qaHeadName,
      chapterMembers,
      squads,
    });
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener estructura QA', error: error.message });
  }
});

// POST /api/users/chapter-members
router.post('/chapter-members', async (req, res) => {
  try {
    const { name, email, qaHeadName } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'El nombre del Chapter Member es obligatorio.' });
    }

    const exists = await prisma.chapterMember.findUnique({ where: { name: name.trim() } });
    if (exists) {
      return res.status(400).json({ message: 'Ya existe un Chapter Member con ese nombre.' });
    }

    const created = await prisma.chapterMember.create({
      data: {
        name: name.trim(),
        email: email?.trim() || null,
        qaHeadName: qaHeadName?.trim() || 'Joseph',
        active: true,
      },
    });

    res.status(201).json(created);
  } catch (error) {
    res.status(500).json({ message: 'Error al crear Chapter Member', error: error.message });
  }
});

// POST /api/users/squads
router.post('/squads', async (req, res) => {
  try {
    const { name, description, chapterMemberId } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'El nombre del Squad es obligatorio.' });
    }
    if (!chapterMemberId) {
      return res.status(400).json({ message: 'Debes asignar un Chapter Member responsable del Squad.' });
    }

    const exists = await prisma.squad.findUnique({ where: { name: name.trim() } });
    if (exists) {
      return res.status(400).json({ message: 'Ya existe un Squad con ese nombre.' });
    }

    const created = await prisma.squad.create({
      data: {
        name: name.trim(),
        description: description?.trim() || null,
        chapterMemberId: Number(chapterMemberId),
        active: true,
      },
      include: { chapterMember: true },
    });

    res.status(201).json(created);
  } catch (error) {
    res.status(500).json({ message: 'Error al crear Squad', error: error.message });
  }
});

// ==========================================
// USUARIOS Y PERFIL DEL EJECUTADOR
// ==========================================

// GET /api/users
router.get('/', async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      include: {
        role: true,
        squad: {
          include: { chapterMember: true },
        },
        _count: {
          select: { ejecuciones: true },
        },
      },
      orderBy: { id: 'asc' },
    });

    const formatted = users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      roleId: u.roleId,
      role: u.role?.name || 'QA_MANUAL',
      squadId: u.squadId,
      squadName: u.squad?.name || null,
      chapterMemberId: u.squad?.chapterMember?.id || null,
      chapterMemberName: u.squad?.chapterMember?.name || null,
      qaHeadName: u.squad?.chapterMember?.qaHeadName || 'Joseph',
      active: u.active !== false,
      executionsCount: u._count?.ejecuciones || 0,
    }));

    res.json(formatted);
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener usuarios', error: error.message });
  }
});

// GET /api/users/:id/profile
router.get('/:id/profile', async (req, res) => {
  try {
    const userId = Number(req.params.id);
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        role: true,
        squad: {
          include: {
            chapterMember: {
              include: {
                squads: {
                  select: { id: true, name: true },
                  orderBy: { name: 'asc' },
                },
              },
            },
            users: {
              select: {
                id: true,
                name: true,
                email: true,
                roleId: true,
                role: true,
                active: true,
              },
              orderBy: { name: 'asc' },
            },
          },
        },
        ejecuciones: {
          include: {
            scenario: { select: { name: true } },
          },
          orderBy: { id: 'desc' },
          take: 15,
        },
      },
    });

    if (!user) {
      return res.status(404).json({ message: 'Usuario no encontrado.' });
    }

    const allExecutions = await prisma.executionHistory.findMany({
      where: { userId },
    });

    const totalExecutions = allExecutions.length;

    const passedExecutions = allExecutions.filter((e) => {
      const st = String(e.status || e.estado || e.result || '').trim().toUpperCase();
      return ['EXITO', 'ÉXITO', 'EXITOSO', 'COMPLETADO', 'PASSED', 'PASS', 'SUCCESS', 'OK'].includes(st);
    }).length;

    const failedExecutions = allExecutions.filter((e) => {
      const st = String(e.status || e.estado || e.result || '').trim().toUpperCase();
      return ['FALLO', 'FALLIDO', 'FAILED', 'FAIL', 'ERROR'].includes(st);
    }).length;

    const passRate = totalExecutions > 0 ? Math.round((passedExecutions / totalExecutions) * 100) : 0;

    const chapterMember = user.squad?.chapterMember || null;

    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      active: user.active !== false,
      roleId: user.roleId,
      role: user.role?.name || 'QA_MANUAL',
      qaHeadName: chapterMember?.qaHeadName || 'Joseph',
      chapterMember: chapterMember
        ? {
            id: chapterMember.id,
            name: chapterMember.name,
            email: chapterMember.email,
            assignedSquads: chapterMember.squads,
          }
        : null,
      squad: user.squad
        ? {
            id: user.squad.id,
            name: user.squad.name,
            description: user.squad.description,
            members: user.squad.users.map((m) => ({
              id: m.id,
              name: m.name,
              email: m.email,
              role: m.role?.name || 'QA_MANUAL',
              active: m.active,
            })),
          }
        : null,
      stats: {
        totalExecutions,
        passedExecutions,
        failedExecutions,
        passRate,
      },
      recentExecutions: user.ejecuciones.map((e) => ({
        id: e.id,
        title: e.scenario?.name || e.scenarioName || e.nombre || `Ejecución #${e.id}`,
        status: e.status || e.estado || e.result || 'COMPLETADO',
        date: e.startedAt || e.createdAt || null,
      })),
    });
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener perfil del ejecutador', error: error.message });
  }
});

// POST /api/users
router.post('/', async (req, res) => {
  try {
    const { name, email, password, roleId, role, squadId } = req.body;
    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) {
      return res.status(400).json({ message: 'Ya existe un usuario con ese correo.' });
    }

    const resolvedRoleId = await resolveRoleId(roleId, role);
    const hash = await bcrypt.hash(password, 10);

    const created = await prisma.user.create({
      data: {
        name,
        email,
        password: hash,
        roleId: resolvedRoleId,
        squadId: squadId ? Number(squadId) : null,
        active: true,
        mustChangePassword: true,
      },
      include: {
        role: true,
        squad: { include: { chapterMember: true } },
      },
    });

    res.status(201).json({
      id: created.id,
      name: created.name,
      email: created.email,
      roleId: created.roleId,
      role: created.role?.name,
      squadId: created.squadId,
      squadName: created.squad?.name || null,
      chapterMemberName: created.squad?.chapterMember?.name || null,
      active: created.active,
    });
  } catch (error) {
    res.status(500).json({ message: 'Error al crear usuario', error: error.message });
  }
});

// PUT /api/users/:id
router.put('/:id', async (req, res) => {
  try {
    const userId = Number(req.params.id);
    const { name, email, roleId, role, squadId } = req.body;

    const emailInUse = await prisma.user.findFirst({
      where: { email, NOT: { id: userId } },
    });
    if (emailInUse) {
      return res.status(400).json({ message: 'El correo ya pertenece a otro usuario.' });
    }

    const resolvedRoleId = await resolveRoleId(roleId, role);

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        name,
        email,
        roleId: resolvedRoleId,
        squadId: squadId ? Number(squadId) : null,
      },
      include: {
        role: true,
        squad: { include: { chapterMember: true } },
      },
    });

    res.json({
      id: updated.id,
      name: updated.name,
      email: updated.email,
      roleId: updated.roleId,
      role: updated.role?.name,
      squadId: updated.squadId,
      squadName: updated.squad?.name || null,
      chapterMemberName: updated.squad?.chapterMember?.name || null,
      active: updated.active,
    });
  } catch (error) {
    res.status(500).json({ message: 'Error al actualizar usuario', error: error.message });
  }
});

// PATCH /api/users/:id/status
router.patch('/:id/status', async (req, res) => {
  try {
    const userId = Number(req.params.id);
    const { active } = req.body;

    if (req.user?.id === userId && active === false) {
      return res.status(400).json({ message: 'No puedes desactivar tu propia cuenta en sesión.' });
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { active: Boolean(active) },
    });

    res.json({ id: updated.id, active: updated.active });
  } catch (error) {
    res.status(500).json({ message: 'Error al actualizar el estado', error: error.message });
  }
});

// PUT /api/users/:id/password
router.put('/:id/password', async (req, res) => {
  try {
    const userId = Number(req.params.id);
    const { newPassword, mustChangePassword = false } = req.body;

    if (!newPassword || String(newPassword).trim().length < 6) {
      return res.status(400).json({
        message: 'La nueva contraseña debe tener al menos 6 caracteres.',
      });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ message: 'Usuario no encontrado.' });
    }

    const hash = await bcrypt.hash(String(newPassword).trim(), 10);

    await prisma.user.update({
      where: { id: userId },
      data: {
        password: hash,
        mustChangePassword: Boolean(mustChangePassword),
      },
    });

    res.json({
      success: true,
      message: `Contraseña actualizada correctamente para ${user.name}.`,
    });
  } catch (error) {
    res.status(500).json({
      message: 'Error al actualizar la contraseña',
      error: error.message,
    });
  }
});

// PUT /api/users/:id/self-profile - Editar nombre/correo del perfil propio
router.put('/:id/self-profile', async (req, res) => {
  try {
    const userId = Number(req.params.id);
    const { name, email } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'El nombre completo es obligatorio.' });
    }
    if (!email || !email.trim()) {
      return res.status(400).json({ message: 'El correo electrónico es obligatorio.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const emailInUse = await prisma.user.findFirst({
      where: { email: cleanEmail, NOT: { id: userId } },
    });
    if (emailInUse) {
      return res.status(400).json({ message: 'Ese correo ya está registrado por otro usuario.' });
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        name: name.trim(),
        email: cleanEmail,
      },
      include: {
        role: true,
        squad: { include: { chapterMember: true } },
      },
    });

    res.json({
      message: 'Datos de perfil actualizados correctamente.',
      user: {
        id: updated.id,
        name: updated.name,
        email: updated.email,
        role: updated.role?.name,
        squadName: updated.squad?.name || null,
        chapterMemberName: updated.squad?.chapterMember?.name || null,
      },
    });
  } catch (error) {
    res.status(500).json({ message: 'Error al actualizar el perfil', error: error.message });
  }
});

// PUT /api/users/:id/self-password - Cambiar contraseña verificando la actual
router.put('/:id/self-password', async (req, res) => {
  try {
    const userId = Number(req.params.id);
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Debes ingresar la contraseña actual y la nueva.' });
    }
    if (String(newPassword).trim().length < 6) {
      return res.status(400).json({ message: 'La nueva contraseña debe tener al menos 6 caracteres.' });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ message: 'Usuario no encontrado.' });
    }

    const isValid = await bcrypt.compare(String(currentPassword), user.password);
    if (!isValid) {
      return res.status(400).json({ message: 'La contraseña actual es incorrecta.' });
    }

    const hash = await bcrypt.hash(String(newPassword).trim(), 10);

    await prisma.user.update({
      where: { id: userId },
      data: {
        password: hash,
        mustChangePassword: false,
      },
    });

    res.json({ message: 'Contraseña actualizada exitosamente.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al cambiar la contraseña', error: error.message });
  }
});

// POST /api/users/:id/reset-password
router.post('/:id/reset-password', async (req, res) => {
  try {
    const userId = Number(req.params.id);
    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      return res.status(404).json({ message: 'Usuario no encontrado.' });
    }

    const tempPassword = generateTempPassword();
    const hash = await bcrypt.hash(tempPassword, 10);

    await prisma.user.update({
      where: { id: userId },
      data: {
        password: hash,
        mustChangePassword: true,
      },
    });

    const transporter = createMailTransporter();
    let emailSent = false;

    if (transporter) {
      await transporter.sendMail({
        from: process.env.SMTP_FROM || `"QA Automation Hub" <${process.env.SMTP_USER}>`,
        to: user.email,
        subject: 'Contraseña temporal - QA Automation Hub',
        html: `
          <div style="font-family: Arial, sans-serif; color: #0f172a; max-width: 520px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px;">
            <h2 style="margin-top: 0;">Hola, ${user.name}</h2>
            <p style="color: #475569; font-size: 14px;">
              Se ha generado una contraseña temporal para tu acceso al portal <strong>QA Automation Hub</strong>.
            </p>
            <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; padding: 14px; margin: 16px 0; text-align: center;">
              <span style="display: block; font-size: 12px; color: #64748b; margin-bottom: 4px;">Contraseña temporal</span>
              <strong style="font-size: 18px; letter-spacing: 1px; font-family: monospace; color: #0f172a;">${tempPassword}</strong>
            </div>
            <p style="color: #64748b; font-size: 12px; margin-bottom: 0;">
              Al iniciar sesión el sistema te solicitará definir una contraseña personalizada.
            </p>
          </div>
        `,
      });
      emailSent = true;
    }

    res.json({
      message: emailSent
        ? `Contraseña temporal enviada a ${user.email}`
        : 'Contraseña temporal generada (configura SMTP en .env para enviarla por correo).',
      emailSent,
      tempPassword: emailSent ? undefined : tempPassword,
    });
  } catch (error) {
    res.status(500).json({ message: 'Error al restablecer contraseña', error: error.message });
  }
});

// DELETE /api/users/:id
router.delete('/:id', async (req, res) => {
  try {
    const userId = Number(req.params.id);

    if (req.user?.id === userId) {
      return res.status(400).json({ message: 'No puedes eliminar tu propia cuenta en sesión.' });
    }

    await prisma.user.delete({ where: { id: userId } });
    res.json({ message: 'Usuario eliminado correctamente.' });
  } catch (error) {
    if (error.code === 'P2003') {
      return res.status(400).json({
        message: 'No se puede eliminar porque tiene ejecuciones en la bitácora. Desactívalo en su lugar.',
      });
    }
    res.status(500).json({ message: 'Error al eliminar usuario', error: error.message });
  }
});

module.exports = router;