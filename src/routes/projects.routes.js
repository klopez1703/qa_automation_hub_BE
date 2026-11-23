const express = require("express");
const router = express.Router();
const prisma = require("../config/db");
const { verifyToken } = require("../middleware/auth");

router.get("/", verifyToken, async (req, res) => {
  try {
    // 1. Consultar rol y proyectos frescos en BD (evita depender solo del payload del JWT)
    const dbUser = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: {
        role: true,
        projects: { select: { id: true } },
      },
    });

    if (!dbUser) {
      return res.status(401).json({ error: "Usuario no encontrado." });
    }

    const roleName =
      typeof dbUser.role === "string" ? dbUser.role : dbUser.role?.name || "";
    const isAdmin = roleName.toUpperCase() === "ADMIN";

    const allowedProjectIds = (dbUser.projects || []).map((p) => Number(p.id));
    const where = isAdmin ? {} : { id: { in: allowedProjectIds } };

    const projects = await prisma.project.findMany({
      where,
      orderBy: { id: "asc" },
      include: {
        modules: {
          orderBy: { id: "asc" },
          include: {
            submodules: {
              orderBy: { id: "asc" },
              // Incluye scenarios solo si esa relación existe en tu schema.prisma:
              // include: { scenarios: { orderBy: { id: "asc" } } },
            },
          },
        },
      },
    });

    res.json(projects);
  } catch (error) {
    console.error("Error obteniendo proyectos:", error);
    res.status(500).json({ error: "Error al cargar los proyectos disponibles." });
  }
});

module.exports = router;