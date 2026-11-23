const express = require('express');
const prisma = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { verifyToken } = require('../middleware/auth');
const pythonRunner = require('../services/pythonRunner.service');
const { actualizarMatrizExistenteOEstado } = require('../services/execution.service');
const { cancelTest } = require('../services/pythonRunner.service');
const fs = require('fs');
const path = require('path');

const router = express.Router();
router.use(verifyToken);

function parseExecutionParams(rawParams) {
  if (!rawParams) return {};
  if (typeof rawParams === 'object') return rawParams;
  try {
    return JSON.parse(rawParams);
  } catch {
    return {};
  }
}

async function getUserAccessContext(reqUser) {
  const userId = Number(reqUser.id);
  const dbUser = await prisma.user.findUnique({
    where: { id: userId },
    include: { role: true },
  });
  const roleName = (
    dbUser?.role?.name ||
    reqUser?.role?.name ||
    reqUser?.role ||
    ''
  ).toUpperCase();

  return {
    userId,
    isAdmin: roleName === 'ADMIN',
  };
}

// ==========================================
// RUTA UNIFICADA: GET /api/executions (según rol)
// ==========================================
router.get('/', asyncHandler(async (req, res) => {
  const { escenario, fecha, squadId, chapterMemberId, page = 1, limit = 10 } = req.query;
  const { userId, isAdmin } = await getUserAccessContext(req.user);

  const pageNum = parseInt(page, 10) || 1;
  const limitNum = parseInt(limit, 10) || 10;
  const skip = (pageNum - 1) * limitNum;

  const whereClause = {};

  // Control de acceso por rol:
  // - Usuarios no Admin: ven únicamente sus propias ejecuciones
  // - Admin: ve todo y puede filtrar por Chapter Member y/o Squad
  if (!isAdmin) {
    whereClause.userId = userId;
  } else if (squadId || chapterMemberId) {
    whereClause.user = {
      ...(squadId ? { squadId: Number(squadId) } : {}),
      ...(chapterMemberId
        ? { squad: { chapterMemberId: Number(chapterMemberId) } }
        : {}),
    };
  }

  // Filtro por nombre de escenario relacionado
  if (escenario && escenario.trim() !== '') {
    whereClause.scenario = {
      name: {
        contains: escenario.trim(),
      },
    };
  }

  // Filtro por fecha
  if (fecha && fecha.trim() !== '') {
    let fechaLimpia = fecha.trim();

    if (fechaLimpia.includes('/')) {
      const partes = fechaLimpia.split('/');
      if (partes.length === 3) {
        fechaLimpia = `${partes[2]}-${partes[1]}-${partes[0]}`;
      }
    }

    const startOfDay = new Date(`${fechaLimpia}T00:00:00.000Z`);
    const endOfDay = new Date(`${fechaLimpia}T23:59:59.999Z`);

    if (!isNaN(startOfDay.getTime()) && !isNaN(endOfDay.getTime())) {
      whereClause.startedAt = {
        gte: startOfDay,
        lte: endOfDay,
      };
    }
  }

  const totalRuns = await prisma.executionHistory.count({ where: whereClause });

  const rawRuns = await prisma.executionHistory.findMany({
    where: whereClause,
    include: {
      scenario: { select: { id: true, name: true } },
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          squadId: true,
          squad: {
            select: {
              id: true,
              name: true,
              chapterMemberId: true,
              chapterMember: {
                select: { id: true, name: true, qaHeadName: true },
              },
            },
          },
        },
      },
    },
    orderBy: {
      startedAt: 'desc',
    },
    skip,
    take: limitNum,
  });

  // Resolver nombres de escenarios históricos guardados en parameters
  const missingScenarioIds = [
    ...new Set(
      rawRuns
        .filter((r) => !r.scenario)
        .map((r) => {
          const p = parseExecutionParams(r.parameters);
          const rawId = p._codigoEscenarioEjecutado ?? p.scenarioId;
          return rawId !== undefined && !isNaN(Number(rawId)) ? Number(rawId) : null;
        })
        .filter((id) => id !== null)
    ),
  ];

  const resolvedScenarios =
    missingScenarioIds.length > 0
      ? await prisma.scenario.findMany({
          where: { id: { in: missingScenarioIds } },
          select: { id: true, name: true },
        })
      : [];

  const scenarioMap = new Map(resolvedScenarios.map((s) => [s.id, s.name]));

  const runs = rawRuns.map((r) => {
    const p = parseExecutionParams(r.parameters);
    const rawCode = p._codigoEscenarioEjecutado ?? p.scenarioId;
    const resolvedName =
      r.scenario?.name ||
      p._nombreEscenario ||
      p.scenarioName ||
      p.nombreEscenario ||
      (rawCode !== undefined && !isNaN(Number(rawCode))
        ? scenarioMap.get(Number(rawCode))
        : null) ||
      (rawCode ? `Escenario ${rawCode}` : null);

    return {
      ...r,
      scenarioName: resolvedName,
    };
  });

  res.json({
    runs,
    total: totalRuns,
    totalPages: Math.ceil(totalRuns / limitNum),
    currentPage: pageNum,
    isAdmin,
  });
}));

// GET /api/executions/:id - Devuelve el estado de una ejecución específica
router.get('/:id', asyncHandler(async (req, res) => {
  const { userId, isAdmin } = await getUserAccessContext(req.user);
  const execution = await prisma.executionHistory.findUnique({
    where: { id: parseInt(req.params.id, 10) },
    include: {
      scenario: { select: { name: true } },
      user: { select: { id: true, name: true } },
    },
  });

  if (!execution) {
    return res.status(404).json({ error: 'Ejecución no encontrada' });
  }

  if (!isAdmin && execution.userId !== userId) {
    return res.status(403).json({ error: 'No tienes permiso para ver esta ejecución.' });
  }

  res.json(execution);
}));

// GET /api/executions/:id/details - Devuelve detalles y pasos parseados
router.get('/:id/details', async (req, res) => {
  try {
    const { userId, isAdmin } = await getUserAccessContext(req.user);
    const executionId = parseInt(req.params.id, 10);
    const execution = await prisma.executionHistory.findUnique({
      where: { id: executionId },
      include: { scenario: true, user: true },
    });

    if (!execution) {
      return res.status(404).json({ error: 'Ejecución no encontrada' });
    }

    if (!isAdmin && execution.userId !== userId) {
      return res.status(403).json({ error: 'No tienes permiso para ver el detalle de esta ejecución.' });
    }

    let stepsList = [];
    if (execution.steps) {
      stepsList = typeof execution.steps === 'string' ? JSON.parse(execution.steps) : execution.steps;
    } else {
      const jsonPath = path.join(__dirname, '../../../pos_screenplay_framework/resultado_matriz.json');
      if (fs.existsSync(jsonPath)) {
        const pyData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        stepsList = pyData.pasos || [];
      }
    }

    res.json({
      ...execution,
      steps: stepsList,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/executions/:id/download-matrix - Descarga de archivo Excel físico por cercanía de fecha
router.get('/:id/download-matrix', asyncHandler(async (req, res) => {
  const executionId = parseInt(req.params.id, 10);

  if (isNaN(executionId)) {
    return res.status(400).json({ error: "ID de ejecución inválido" });
  }

  const execution = await prisma.executionHistory.findUnique({
    where: { id: executionId }
  });

  if (!execution) {
    return res.status(404).json({ error: "Ejecución no encontrada en la base de datos." });
  }

  const matrizDir = path.join(__dirname, '../../matricez');

  if (!fs.existsSync(matrizDir)) {
    return res.status(404).json({ error: "La carpeta 'matricez' no existe en el servidor." });
  }

  const archivos = fs.readdirSync(matrizDir).filter(f => f.endsWith('.xlsx'));

  if (archivos.length === 0) {
    return res.status(404).json({ error: "No hay archivos de matriz disponibles en la carpeta." });
  }

  const tiempoEjecucion = new Date(execution.startedAt || execution.startTime || Date.now()).getTime();

  let archivoCercano = archivos[0];
  let menorDiferencia = Infinity;

  archivos.forEach(archivo => {
    const rutaArchivo = path.join(matrizDir, archivo);
    const stats = fs.statSync(rutaArchivo);
    const diferencia = Math.abs(stats.mtimeMs - tiempoEjecucion);

    if (diferencia < menorDiferencia) {
      menorDiferencia = diferencia;
      archivoCercano = archivo;
    }
  });

  const rutaFinal = path.join(matrizDir, archivoCercano);

  if (!fs.existsSync(rutaFinal)) {
    return res.status(404).json({ error: "No se encontró el archivo Excel físico correspondiente." });
  }

  res.download(rutaFinal, archivoCercano);
}));

// GET /api/executions/:id/log - Devuelve el texto plano de los logs
router.get('/:id/log', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const execution = await prisma.executionHistory.findUnique({
    where: { id: parseInt(id) },
    select: { logOutput: true }
  });

  if (!execution) {
    return res.status(404).send('Ejecución no encontrada');
  }

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send(execution.logOutput || 'No hay logs registrados todavía...');
}));

// POST /api/executions - Inicia la ejecución
router.post('/', asyncHandler(async (req, res) => {
  const { 
    scenarioIds, 
    executionType, 
    connection, 
    parameters, 
    history, 
    escenarios, 
    moduleName,     
    submoduleName,
    rutaMatrizCargada 
  } = req.body;
  
  const userId = req.user.id;

  if (!scenarioIds || !Array.isArray(scenarioIds) || scenarioIds.length === 0) {
    return res.status(400).json({ error: 'scenarioIds es obligatorio y debe ser un arreglo.' });
  }

  const executionsCreated = [];

  for (const id of scenarioIds) {
    const execution = await prisma.executionHistory.create({
      data: {
        user: { connect: { id: userId } },
        status: 'PENDIENTE',
        parameters: JSON.stringify(parameters || { _codigoEscenarioEjecutado: id })
      }
    });
    
    executionsCreated.push(execution);

    pythonRunner.executeTest(
      execution.id, 
      connection, 
      parameters, 
      executionType, 
      moduleName,     
      submoduleName,  
      history,
      escenarios
    ).then(async (resultadosEjecucion) => {
      try {
        const rutaExcelActualizado = await actualizarMatrizExistenteOEstado(
          rutaMatrizCargada, 
          resultadosEjecucion || []
        );

        await prisma.executionHistory.update({
          where: { id: execution.id },
          data: { 
            status: 'COMPLETADO',
            logOutput: `Matriz actualizada correctamente en: ${rutaExcelActualizado}`
          }
        });
      } catch (excelErr) {
        console.error('Error al actualizar archivo Excel:', excelErr);
      }
    }).catch(async (error) => {
      console.error(`Error durante la ejecución del ID ${execution.id}:`, error);
      await prisma.executionHistory.update({
        where: { id: execution.id },
        data: { status: 'FALLO', logOutput: String(error) }
      });
    });
  }

  res.status(202).json({
    message: `Ejecución iniciada en el orquestador para ${executionsCreated.length} escenario(s)`,
    executionId: executionsCreated[0].id, 
    executionIds: executionsCreated.map(e => e.id)
  });
}));

// POST /api/executions/:id/cancel
router.post('/:id/cancel', async (req, res) => {
  try {
    const executionId = Number(req.params.id);

    if (isNaN(executionId)) {
      return res.status(400).json({ success: false, message: 'ID de ejecución no válido.' });
    }

    const cancelado = cancelTest(executionId);

    await prisma.executionHistory.update({
      where: { id: executionId },
      data: {
        status: 'CANCELADO',
        logOutput: '\n⚠️ Ejecución cancelada manualmente por el usuario.',
        completedAt: new Date()
      }
    }).catch(() => {});

    return res.json({
      success: true,
      message: cancelado ? 'Ejecución cancelada en el servidor.' : 'Proceso finalizado previamente.'
    });
  } catch (error) {
    console.error('Error al procesar la cancelación:', error);
    return res.status(500).json({ success: false, message: 'Error interno del servidor.' });
  }
});

router.get('/:id/status', async (req, res) => {
  try {
    const executionId = Number(req.params.id);
    const history = await prisma.executionHistory.findUnique({
      where: { id: executionId }
    });

    if (!history) {
      return res.status(404).json({ success: false, message: 'Ejecución no encontrada.' });
    }

    return res.json({
      status: history.status,
      logOutput: history.logOutput,
      evidenceUrl: history.evidenceUrl,
      completedAt: history.completedAt
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Error consultando estado.' });
  }
});

module.exports = router;