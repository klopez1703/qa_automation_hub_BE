const prisma = require("../config/db");
const { getEffectivePermissions } = require("../utils/permission");

function getRoleName(user) {
  if (!user) return "";
  return (typeof user.role === "string" ? user.role : user.role?.name || "").toUpperCase();
}

function isTicketApprover(user) {
  if (!user) return false;
  if (getRoleName(user) === "ADMIN") return true;
  const perms = getEffectivePermissions(user);
  return perms.includes("*") || perms.includes("TICKETS_APROBAR");
}

// PATCH /api/tickets/:id/revoke -> Dar de baja un acceso aprobado
async function revokeTicket(req, res) {
  try {
    if (!isTicketApprover(req.user)) {
      return res.status(403).json({ message: "No tienes autorización para revocar accesos." });
    }

    const ticketId = Number(req.params.id);
    const { reviewerComment } = req.body;

    const ticket = await prisma.accessTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) {
      return res.status(404).json({ message: "Ticket no encontrado." });
    }
    if (ticket.status !== "APPROVED") {
      return res.status(400).json({ message: "Solo se pueden dar de baja tickets aprobados." });
    }

    const txOperations = [
      prisma.accessTicket.update({
        where: { id: ticketId },
        data: {
          status: "REVOKED",
          reviewerId: req.user.id,
          reviewerComment:
            reviewerComment?.trim() || "Acceso dado de baja por el administrador.",
          reviewedAt: new Date(),
        },
      }),
    ];

    if (ticket.permissionId) {
      txOperations.push(
        prisma.userPermission.deleteMany({
          where: {
            userId: ticket.requesterId,
            permissionId: ticket.permissionId,
          },
        })
      );
    }

    if (ticket.projectId) {
      txOperations.push(
        prisma.user.update({
          where: { id: ticket.requesterId },
          data: {
            projects: { disconnect: { id: ticket.projectId } },
          },
        })
      );
    }

    const [updated] = await prisma.$transaction(txOperations);
    res.json(updated);
  } catch (error) {
    console.error("Error revocando ticket:", error);
    res.status(500).json({ message: "Error al dar de baja el acceso del ticket." });
  }
}

// GET /api/tickets/pending-count -> Contador en vivo para badge y notificaciones del Admin
async function getPendingCount(req, res) {
  try {
    if (!isTicketApprover(req.user)) {
      return res.json({ pendingCount: 0, latestTicket: null });
    }

    const [pendingCount, latestTicket] = await Promise.all([
      prisma.accessTicket.count({ where: { status: "PENDING" } }),
      prisma.accessTicket.findFirst({
        where: { status: "PENDING" },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          createdAt: true,
          requester: { select: { name: true } },
          permission: { select: { action: true } },
          project: { select: { name: true } },
        },
      }),
    ]);

    res.json({ pendingCount, latestTicket });
  } catch (error) {
    console.error("Error obteniendo contador de tickets:", error);
    res.status(500).json({ message: "Error al consultar tickets pendientes." });
  }
}

async function getTicketOptions(req, res) {
  try {
    const userId = req.user.id;

    // Tickets vigentes (solo PENDING o APPROVED; los REVOKED y REJECTED quedan libres)
    const activeTickets = await prisma.accessTicket.findMany({
      where: {
        requesterId: userId,
        status: { in: ["PENDING", "APPROVED"] },
      },
      select: { permissionId: true, projectId: true },
    });

    const blockedPermissionIds = new Set(
      activeTickets.map((t) => t.permissionId).filter(Boolean)
    );

    const allPermissions = await prisma.permission.findMany({
      orderBy: [{ category: "asc" }, { action: "asc" }],
    });

    // Solo ocultamos los que ya tienen ticket PENDING o APPROVED
    const availablePermissions = allPermissions.filter(
      (p) => !blockedPermissionIds.has(p.id)
    );

    const projects = await prisma.project.findMany({
      orderBy: { name: "asc" },
    });

    return res.json({
      permissions: availablePermissions,
      projects,
    });
  } catch (error) {
    return res.status(500).json({ message: "Error cargando opciones de tickets" });
  }
};

// GET /api/tickets -> Admin ve todos los tickets; demás usuarios ven solo los suyos
async function listTickets(req, res) {
  try {
    const canApprove = isTicketApprover(req.user);
    const where = canApprove ? {} : { requesterId: req.user.id };

    const tickets = await prisma.accessTicket.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      include: {
        requester: {
          select: {
            id: true,
            name: true,
            email: true,
            role: { select: { name: true } },
            squad: { select: { name: true } },
          },
        },
        permission: {
          select: { id: true, action: true, category: true, description: true },
        },
        project: {
          select: { id: true, name: true },
        },
        reviewer: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    res.json({ tickets, canApprove });
  } catch (error) {
    console.error("Error listando tickets:", error);
    res.status(500).json({ message: "Error al obtener los tickets." });
  }
}

// POST /api/tickets -> Crear solicitud (bloqueado para ADMIN)
async function createTicket(req, res) {
  try {
    if (getRoleName(req.user) === "ADMIN") {
      return res.status(403).json({
        message: "El rol Administrador tiene acceso completo y no requiere solicitar tickets.",
      });
    }

    const { requestType, permissionId, projectId, justification, expiresAt } = req.body;

    if (!justification || !justification.trim()) {
      return res.status(400).json({ message: "La justificación es obligatoria." });
    }

    const validTypes = ["PERMISSION", "PROJECT", "BOTH"];
    const type = validTypes.includes(requestType) ? requestType : "PERMISSION";

    const parsedPermId = permissionId ? Number(permissionId) : null;
    const parsedProjId = projectId ? Number(projectId) : null;

    if ((type === "PERMISSION" || type === "BOTH") && !parsedPermId) {
      return res.status(400).json({ message: "Debes seleccionar un permiso funcional." });
    }
    if ((type === "PROJECT" || type === "BOTH") && !parsedProjId) {
      return res.status(400).json({ message: "Debes seleccionar un proyecto." });
    }

    const duplicate = await prisma.accessTicket.findFirst({
      where: {
        requesterId: req.user.id,
        status: "PENDING",
        permissionId: type === "PROJECT" ? null : parsedPermId,
        projectId: type === "PERMISSION" ? null : parsedProjId,
      },
    });

    if (duplicate) {
      return res.status(409).json({
        message: "Ya tienes una solicitud pendiente para este mismo permiso o proyecto.",
      });
    }

    const created = await prisma.accessTicket.create({
      data: {
        requestType: type,
        status: "PENDING",
        requesterId: req.user.id,
        permissionId: type === "PROJECT" ? null : parsedPermId,
        projectId: type === "PERMISSION" ? null : parsedProjId,
        justification: justification.trim(),
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      },
      include: {
        permission: true,
        project: true,
      },
    });

    res.status(201).json(created);
  } catch (error) {
    console.error("Error creando ticket:", error);
    res.status(500).json({ message: "No se pudo crear el ticket." });
  }
}

// PATCH /api/tickets/:id/resolve -> Aprobar o Rechazar ticket
async function resolveTicket(req, res) {
  try {
    if (!isTicketApprover(req.user)) {
      return res.status(403).json({ message: "No tienes autorización para resolver tickets." });
    }

    const ticketId = Number(req.params.id);
    const { status, reviewerComment, expiresAt } = req.body;

    if (!["APPROVED", "REJECTED"].includes(status)) {
      return res.status(400).json({ message: "Estado inválido. Usa APPROVED o REJECTED." });
    }

    const ticket = await prisma.accessTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) {
      return res.status(404).json({ message: "Ticket no encontrado." });
    }
    if (ticket.status !== "PENDING") {
      return res.status(400).json({ message: "Este ticket ya fue resuelto anteriormente." });
    }

    const finalExpiration =
      expiresAt !== undefined ? (expiresAt ? new Date(expiresAt) : null) : ticket.expiresAt;

    const txOperations = [
      prisma.accessTicket.update({
        where: { id: ticketId },
        data: {
          status,
          reviewerId: req.user.id,
          reviewerComment: reviewerComment?.trim() || null,
          expiresAt: finalExpiration,
          reviewedAt: new Date(),
        },
      }),
    ];

    if (status === "APPROVED") {
      if (ticket.permissionId) {
        txOperations.push(
          prisma.userPermission.upsert({
            where: {
              userId_permissionId: {
                userId: ticket.requesterId,
                permissionId: ticket.permissionId,
              },
            },
            update: { expiresAt: finalExpiration },
            create: {
              userId: ticket.requesterId,
              permissionId: ticket.permissionId,
              expiresAt: finalExpiration,
            },
          })
        );
      }

      if (ticket.projectId) {
        txOperations.push(
          prisma.user.update({
            where: { id: ticket.requesterId },
            data: {
              projects: { connect: { id: ticket.projectId } },
            },
          })
        );
      }
    }

    const [updated] = await prisma.$transaction(txOperations);
    res.json(updated);
  } catch (error) {
    console.error("Error resolviendo ticket:", error);
    res.status(500).json({ message: "Error al procesar la resolución del ticket." });
  }
}

// DELETE /api/tickets/:id -> Cancelar ticket propio pendiente
async function cancelTicket(req, res) {
  try {
    const ticketId = Number(req.params.id);
    const ticket = await prisma.accessTicket.findUnique({ where: { id: ticketId } });

    if (!ticket) {
      return res.status(404).json({ message: "Ticket no encontrado." });
    }
    if (ticket.requesterId !== req.user.id && !isTicketApprover(req.user)) {
      return res.status(403).json({ message: "No puedes cancelar este ticket." });
    }
    if (ticket.status !== "PENDING") {
      return res.status(400).json({ message: "Solo se pueden cancelar tickets pendientes." });
    }

    await prisma.accessTicket.delete({ where: { id: ticketId } });
    res.json({ message: "Solicitud cancelada correctamente." });
  } catch (error) {
    console.error("Error cancelando ticket:", error);
    res.status(500).json({ message: "No se pudo cancelar la solicitud." });
  }
}

module.exports = {
  getPendingCount,
  getTicketOptions,
  listTickets,
  createTicket,
  resolveTicket,
  cancelTicket,
  revokeTicket
};