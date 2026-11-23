const express = require('express');
const prisma = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();
router.use(verifyToken);

// GET /api/modules - Trae la jerarquía completa del proyecto KinPOS
router.get('/', asyncHandler(async (req, res) => {
  const projects = await prisma.project.findMany({
    include: {
      modules: {
        include: {
          submodules: true
        }
      }
    }
  });
  res.json(projects);
}));

// Crear un nuevo módulo asociado a un proyecto
router.post('/', asyncHandler(async (req, res) => {
  const { name, projectId } = req.body;
  
  if (!name || !projectId) {
    return res.status(400).json({ error: 'El nombre del módulo y el ID del proyecto son obligatorios.' });
  }

  const moduleRecord = await prisma.module.create({
    data: {
      name,
      projectId: parseInt(projectId)
    }
  });
  
  res.json(moduleRecord);
}));

// GET /api/modules/config - Obtiene configuración de campos según proyecto, módulo y submódulo
router.get('/config', async (req, res) => {
  try {
    const { project, module, submodule } = req.query;

    // Buscamos el submódulo validando la jerarquía en la Base de Datos (Project -> Module -> Submodule)
    const subModRecord = await prisma.submodule.findFirst({
      where: {
        name: submodule,
        module: {
          name: module,
          project: { 
            name: project 
          }
        }
      }
    });

    // Mapeo dinámico de campos requeridos según el submódulo encontrado en BD
    let camposRequeridos = ['monto', 'moneda']; // valor por defecto

    const subNameUpper = (submodule || "").toUpperCase();

    if (subNameUpper.includes('VENTA') || subNameUpper.includes('DEVOLUCION')) {
      camposRequeridos = ['monto', 'propina', 'moneda', 'impuesto', 'cuotas'];
    } else if (subNameUpper.includes('ANULACION') || subNameUpper.includes('ANULACIÓN')) {
      camposRequeridos = ['facturaAnular'];
    } else if (subNameUpper.includes('EXTRA') || subNameUpper.includes('INTRA')) {
      camposRequeridos = ['monto', 'propina', 'moneda'];
    }

    res.json({ 
      existsInDb: !!subModRecord,
      camposRequeridos 
    });
  } catch (error) {
    console.error("Error en /api/modules/config:", error);
    res.status(500).json({ error: error.message });
  }
});

// Obtener todos los escenarios
router.get('/scenarios', async (req, res) => {
  try {
    const scenarios = await prisma.scenario.findMany({
      include: {
        submodule: {
          include: {
            module: {
              include: { project: true }
            }
          }
        }
      }
    });
    res.json(scenarios);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/scenarios', async (req, res) => {
  try {
    const { name, description, specPathOrTag, tipoEjecucion, submoduleId } = req.body;
    const scenario = await prisma.scenario.create({
      data: {
        name,
        description: description || null,
        specPathOrTag: specPathOrTag || null,
        tipoEjecucion: tipoEjecucion || 'INDIVIDUAL',
        submoduleId: Number(submoduleId),
      },
    });
    res.status(201).json(scenario);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Crear un submódulo
router.post('/submodules', async (req, res) => {
  try {
    const { name, moduleId } = req.body;
    const submodule = await prisma.submodule.create({
      data: {
        name,
        moduleId: parseInt(moduleId)
      }
    });
    res.json(submodule);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;