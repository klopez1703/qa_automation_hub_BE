const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { verifyToken } = require('../middleware/auth'); // Ajusta la ruta si tu middleware tiene otro nombre
const { getEffectivePermissions } = require("../utils/permission");

const router = express.Router();

router.get("/me", verifyToken, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: {
        role: { include: { permissions: true } },
        squad: { include: { chapterMember: true } },
        projects: { select: { id: true, name: true } },
        extraPermissions: {
          where: {
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          },
          include: { permission: true },
        },
      },
    });

    if (!user) {
      return res.status(404).json({ error: "Usuario no encontrado." });
    }

    const { password, ...safeUser } = user;
    const permissions = getEffectivePermissions(user);

    res.json({
      user: {
        ...safeUser,
        role: user.role?.name || "QA",
        permissions,
        projects: user.projects || [],
      },
    });
  } catch (error) {
    console.error("Error en /api/auth/me:", error);
    res.status(500).json({ error: "Error al sincronizar permisos del usuario." });
  }
});

router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email y contraseña son obligatorios.' });
  }

  const user = await prisma.user.findUnique({
    where: { email },
    include: { role: true },
  });

  if (!user) {
    return res.status(401).json({ error: 'Credenciales inválidas.' });
  }

  const passwordMatches = await bcrypt.compare(password, user.password);
  if (!passwordMatches) {
    return res.status(401).json({ error: 'Credenciales inválidas.' });
  }

  if (user.active === false) {
    return res.status(403).json({
      code: 'ACCOUNT_INACTIVE',
      error: 'Tu cuenta se encuentra desactivada. Contacta al administrador para habilitar tu acceso.',
    });
  }

  const roleName = user.role.name;
  const mustChangePassword = Boolean(user.mustChangePassword);

  const token = jwt.sign(
    {
      id: user.id,
      email: user.email,
      name: user.name,
      role: roleName,
      active: user.active,
      mustChangePassword,
    },
    process.env.JWT_SECRET,
    { expiresIn: '8h' }
  );

  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: roleName,
      active: user.active,
      mustChangePassword,
    },
  });
}));

// POST /api/auth/change-password - Personalizar contraseña temporal
router.post('/change-password', verifyToken, asyncHandler(async (req, res) => {
  const { newPassword } = req.body;

  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({
      error: 'La nueva contraseña debe tener al menos 8 caracteres.',
    });
  }

  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    include: { role: true },
  });

  if (!user) {
    return res.status(404).json({ error: 'Usuario no encontrado.' });
  }

  // Evitar que vuelva a guardar la misma contraseña temporal
  const isSameAsTemp = await bcrypt.compare(newPassword, user.password);
  if (isSameAsTemp) {
    return res.status(400).json({
      error: 'La nueva contraseña debe ser diferente a la contraseña temporal asignada.',
    });
  }

  const hash = await bcrypt.hash(newPassword, 10);

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      password: hash,
      mustChangePassword: false,
    },
  });

  const roleName = user.role.name;

  // Emitir nuevo token ya con mustChangePassword: false
  const token = jwt.sign(
    {
      id: updated.id,
      email: updated.email,
      name: updated.name,
      role: roleName,
      active: updated.active,
      mustChangePassword: false,
    },
    process.env.JWT_SECRET,
    { expiresIn: '8h' }
  );

  res.json({
    message: 'Contraseña actualizada correctamente.',
    token,
    user: {
      id: updated.id,
      email: updated.email,
      name: updated.name,
      role: roleName,
      active: updated.active,
      mustChangePassword: false,
    },
  });
}));

module.exports = router;