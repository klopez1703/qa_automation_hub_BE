const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');

async function actualizarMatrizExistenteOEstado(rutaArchivoOriginal, resultadosEjecucion) {
  const workbook = new ExcelJS.Workbook();
  let rutaDestino = '';

  // Verificar si viene una matriz cargada existente en el disco
  if (rutaArchivoOriginal && fs.existsSync(rutaArchivoOriginal)) {
    await workbook.xlsx.readFile(rutaArchivoOriginal);
    rutaDestino = rutaArchivoOriginal; // Sobrescribir exactamente la matriz cargada
  } else {
    // Si es creación manual desde cero
    const plantillaPath = path.join(__dirname, '../templates/Plan Detallado de Pruebas.xlsx');
    await workbook.xlsx.readFile(plantillaPath);
    rutaDestino = path.join(__dirname, `../output/Matriz_Ejecutada_${Date.now()}.xlsx`);
  }

  // Estampar resultados de la prueba y evidencias
  resultadosEjecucion.forEach((res) => {
    const hojaFBQA = workbook.getWorksheet(res.id) || workbook.worksheets.find(w => w.name.includes(res.id));
    if (hojaFBQA) {
      // 1. Estado global en el encabezado
      hojaFBQA.getCell('E17').value = res.exitoso ? 'PASÓ' : 'FALLÓ';
      
      // 2. Incrustar evidencias / capturas registradas
      if (Array.isArray(res.pasosEjecutados)) {
        res.pasosEjecutados.forEach((paso, idx) => {
          const filaPaso = 21 + idx;
          if (paso.evidenciaPath && fs.existsSync(paso.evidenciaPath)) {
            const imageId = workbook.addImage({
              filename: paso.evidenciaPath,
              extension: 'png',
            });
            hojaFBQA.addImage(imageId, `H${filaPaso}:I${filaPaso + 5}`);
          }
        });
      }
    }
  });

  // Guardar cambios en el archivo correspondiente
  await workbook.xlsx.writeFile(rutaDestino);
  return rutaDestino;
}

// Al recibir o actualizar el resultado de Python en tu servicio de ejecución de Node.js:
const actualizarHistorialConPasos = async (executionId, resultadosPython) => {
  // resultadosPython.pasos viene del JSON generado por el script de Python
  await prisma.executionHistory.update({
    where: { id: executionId },
    data: {
      status: resultadosPython.status,
      logOutput: resultadosPython.logs,
      // Guardamos los pasos reales en un campo JSON de Prisma (o en la relación correspondiente)
      steps: JSON.stringify(resultadoPython.pasos || [])
    }
  });
};

module.exports = {
  actualizarMatrizExistenteOEstado,
  actualizarHistorialConPasos
};