const jwt = require("jsonwebtoken");
const prisma = require("../config/db");
const {
  getEffectivePermissions,
  hasPermission,
  hasProjectAccess,
} = require("../utils/permission");

async function verifyToken(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "No se envió un token de sesión." });
  }

  const token = header.replace("Bearer ", "");
  let payload;

  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: "La sesión expiró o el token no es válido." });
  }

  try {
    const dbUser = await prisma.user.findUnique({
      where: { id: payload.id },
      select: {
        active: true,
        role: { include: { permissions: true } },
        projects: true,
        extraPermissions: {
          where: {
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          },
          include: { permission: true },
        },
      },
    });

    if (!dbUser || dbUser.active === false) {
      return res.status(401).json({
        code: "ACCOUNT_INACTIVE",
        error: "Tu cuenta ha sido desactivada. Contacta al administrador.",
      });
    }

    const userContext = {
      ...payload,
      role: dbUser.role?.name || payload.role,
      roleObj: dbUser.role,
      extraPermissions: dbUser.extraPermissions || [],
      projects: dbUser.projects || [],
    };

    req.user = {
      ...userContext,
      permissions: getEffectivePermissions(userContext),
    };

    next();
  } catch (dbErr) {
    return res.status(500).json({ error: "Error al verificar el estado de la cuenta." });
  }
}

// Uso: requireRole('ADMIN') o requireRole('ADMIN', 'QA')
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "No tienes permiso para esta acción." });
    }
    next();
  };
}

const requirePermission = (action) => (req, res, next) => {
  if (!hasPermission(req.user, action)) {
    return res.status(403).json({
      message: `No tienes el permiso requerido (${action}). Puedes solicitarlo mediante un ticket.`,
      missingPermission: action,
    });
  }
  next();
};

const requireProjectAccess = (req, res, next) => {
  const projectId = req.body.projectId || req.params.projectId || req.query.projectId;
  if (projectId && !hasProjectAccess(req.user, projectId)) {
    return res.status(403).json({
      message: "No tienes acceso asignado a este proyecto. Solicítalo mediante un ticket.",
      missingProjectId: Number(projectId),
    });
  }
  next();
};

module.exports = {
  verifyToken,
  requireRole,
  requirePermission,
  requireProjectAccess,
};