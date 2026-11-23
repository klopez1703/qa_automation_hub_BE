const { spawn, exec } = require("child_process");
const path = require("path");
const fs = require("fs");
const prisma = require("../config/db");
const { generarMatrizPruebas } = require("./excelGenerator.service");

// Mapa en memoria para almacenar las instancias de subprocesos activos
const procesosActivos = new Map();

async function executeTest(
  executionId,
  connection,
  parameters,
  executionType,
  moduleName,
  submoduleName,
  historyData,
  escenariosConfigurados,
) {
  try {
    await prisma.executionHistory.update({
      where: { id: executionId },
      data: {
        status: "EN_PROGRESO",
        logOutput: "Iniciando proceso de automatización...\n",
      },
    });

    const pythonProjectPath = path.resolve(
      __dirname,
      "../../../../pos_screenplay_framework",
    );

    const formatPythonDefName = (name) => {
      if (!name) return "test_run";
      let str = String(name).trim();

      if (str.startsWith("test_") && !str.includes(" ")) return str;

      str = str
        .toLowerCase()
        .replace(/^test\s+/i, "")
        .replace(/[^\w\s]/gi, "")
        .trim()
        .replace(/\s+/g, "_");

      return `test_${str}`;
    };

    const testTargets = escenariosConfigurados.map((esc) => {
      let rutaScript = esc.script || "tests/test_flujo_retail.py";

      if (!rutaScript.includes("/")) {
        rutaScript = `tests/${rutaScript}`;
      }

      const nombreRaw =
        esc.escenarioPython || esc.casoPrueba || esc.descripcion;
      const nombreDef = formatPythonDefName(nombreRaw);

      return `"${rutaScript}::${nombreDef}"`;
    });

    const args = [
      "-u",
      "-m",
      "pytest",
      ...testTargets,
      "-s",
      "--ip",
      connection?.ip || "127.0.0.1",
      "--port",
      connection?.port || "5000",
      "--monto",
      parameters?.monto || "1.00",
      "--moneda",
      parameters?.moneda || "0340",
      "--impuesto",
      parameters?.impuesto || "0",
      "--module",
      moduleName || "Desconocido",
      "--submodule",
      submoduleName || "Desconocido",
    ];

    if (parameters?.facturaAnular && parameters.facturaAnular.trim() !== "") {
      args.push("--factura", parameters.facturaAnular);
    }

    console.log(`Comando a ejecutar: python ${args.join(" ")}`);

    const pythonProcess = spawn("python", args, {
      cwd: pythonProjectPath,
      shell: true,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: "1",
        PYTHONIOENCODING: "utf-8",
        DCL_IP: connection?.ip,
        DCL_PORT: connection?.port,
        TRANS_MONTO: parameters?.monto,
        TRANS_MONEDA: parameters?.moneda,
        TRANS_IMPUESTO: parameters?.impuesto || "0",
        TRANS_FACTURA: parameters?.facturaAnular || "",
        DCL_MODULE: moduleName,
        DCL_SUBMODULE: submoduleName,
      },
    });

    // Guardar referencia del subproceso activo por ID
    procesosActivos.set(executionId, pythonProcess);

    let logOutput = "";

    pythonProcess.stdout.on("data", (data) => {
      const chunk = data.toString();
      logOutput += chunk;
      console.log(`[PyOut #${executionId}]: ${chunk}`);

      prisma.executionHistory
        .update({
          where: { id: executionId },
          data: { logOutput },
        })
        .catch(() => {});
    });

    pythonProcess.stderr.on("data", (data) => {
      const chunk = data.toString();
      logOutput += chunk;
      console.error(`[PyErr #${executionId}]: ${chunk}`);

      prisma.executionHistory
        .update({
          where: { id: executionId },
          data: { logOutput },
        })
        .catch(() => {});
    });

    pythonProcess.on("close", async (code) => {
      // Remover subproceso del mapa
      procesosActivos.delete(executionId);

      const finalStatus = code === 0 ? "EXITO" : "FALLO";
      let mensajeExtra = `\nProceso finalizado con código: ${code}`;
      let resultadoExcel = null;

      try {
        const estadoParaExcel = code === 0 ? "EXITOSA" : "FALLIDO";
        let escenariosParaExcel = JSON.parse(
          JSON.stringify(escenariosConfigurados),
        );

        const rutaJsonPython = path.resolve(
          pythonProjectPath,
          "resultado_matriz.json",
        );

        if (fs.existsSync(rutaJsonPython)) {
          const rawData = fs.readFileSync(rutaJsonPython, "utf-8");
          const dataPython = JSON.parse(rawData);

          if (dataPython.escenarios && dataPython.escenarios.length > 0) {
            escenariosParaExcel[0].pasos = dataPython.escenarios[0].pasos;
          }
        }

        const dataParaMatriz = {
          ...historyData,
          escenarios: escenariosParaExcel,
        };

        resultadoExcel = await generarMatrizPruebas(
          dataParaMatriz,
          estadoParaExcel,
        );

        if (resultadoExcel && resultadoExcel.nombreArchivo) {
          mensajeExtra += `\n✨ Matriz de Pruebas generada dinámicamente (${estadoParaExcel}): ${resultadoExcel.nombreArchivo}`;
        }
      } catch (excelError) {
        console.error("Error generando matriz post-ejecución:", excelError);
        mensajeExtra += `\n⚠️ Error al generar el Excel automático: ${excelError.message}`;
      }

      await prisma.executionHistory.update({
        where: { id: executionId },
        data: {
          status: finalStatus,
          logOutput: logOutput + mensajeExtra,
          completedAt: new Date(),
          evidenceUrl: resultadoExcel?.nombreArchivo
            ? `/descargas/${resultadoExcel.nombreArchivo}`
            : null,
        },
      });

      console.log(
        `Ejecución #${executionId} finalizada con estado: ${finalStatus}`,
      );
    });
  } catch (error) {
    console.error("Error en el servicio Runner:", error);
    procesosActivos.delete(executionId);

    await prisma.executionHistory.update({
      where: { id: executionId },
      data: {
        status: "FALLO",
        logOutput: `Error interno del orquestador: ${error.message}`,
        completedAt: new Date(),
      },
    });
  }
}

// Función para detener únicamente el subproceso de Pytest
function cancelTest(executionId) {
  const pythonProcess = procesosActivos.get(executionId);
  if (pythonProcess) {
    try {
      if (process.platform === "win32") {
        exec(`taskkill /F /T /PID ${pythonProcess.pid}`);
      } else {
        pythonProcess.kill("SIGINT");
      }
      procesosActivos.delete(executionId);
      return true;
    } catch (err) {
      console.error(`Error cancelando ejecución #${executionId}:`, err);
      return false;
    }
  }
  return false;
}

module.exports = { executeTest, cancelTest };

// const { spawn, exec } = require("child_process");
// const path = require("path");
// const fs = require("fs");
// const prisma = require("../config/db");
// const { generarMatrizPruebas } = require("./excelGenerator.service");
// const {
//   FRAMEWORK_DIR,
//   DCL_EXE_PATH,
//   EVIDENCES_DIR,
// } = require("../config/paths");

// // Mapa en memoria para almacenar las instancias de subprocesos activos
// const procesosActivos = new Map();

// async function executeTest(
//   executionId,
//   connection,
//   parameters,
//   executionType,
//   moduleName,
//   submoduleName,
//   historyData,
//   escenariosConfigurados
// ) {

//   function formatCleanLogs(rawLogs, exitCode = null) {
//   if (!rawLogs) return "";

//   let text = rawLogs.replace(/\r\n/g, "\n");

//   // 1. Eliminar bloques internos de faulthandler / C stack trace de pywinauto
//   text = text.replace(
//     /Windows fatal exception:[\s\S]*?(?=\n={10,}|\n[⏳✅⚡📊🧹🔍🎉🛑]|\n\d+\s+passed|\n={5,}\s+FAILURES)/g,
//     ""
//   );

//   // 2. Eliminar encabezado inicial de sesión pytest
//   text = text
//     .replace(/^=+ test session starts =+[\s\S]*?collected \d+ items?\n*/m, "")
//     .replace(/^tests\\[^\n]+\.py\s*/gm, "");

//   // 3. Si la ejecución terminó con ÉXITO (code === 0), quitar cualquier ruido residual previo al primer bloque útil
//   if (exitCode === 0) {
//     const startIdx = text.search(
//       /(={20,}|[⏳✅⚡📊🧹🔍🎉🛑]|Archivo de resultados generado)/
//     );
//     if (startIdx > 0) {
//       text = text.slice(startIdx);
//     }
//   }

//   // Limpiar saltos de línea excesivos
//   return text.replace(/\n{3,}/g, "\n\n").trim();
// }

//   try {
//     await prisma.executionHistory.update({
//       where: { id: executionId },
//       data: {
//         status: "EN_PROGRESO",
//         logOutput: "Iniciando proceso de automatización...\n",
//       },
//     });

//     const pythonProjectPath = FRAMEWORK_DIR;

//     const formatPythonDefName = (name) => {
//       if (!name) return "test_run";
//       let str = String(name).trim();

//       if (str.startsWith("test_") && !str.includes(" ")) return str;

//       str = str
//         .toLowerCase()
//         .replace(/^test\s+/i, "")
//         .replace(/[^\w\s]/gi, "")
//         .trim()
//         .replace(/\s+/g, "_");

//       return `test_${str}`;
//     };

//     const testTargets = escenariosConfigurados.map((esc) => {
//       let rutaScript = esc.script || "tests/test_flujo_retail.py";

//       if (!rutaScript.includes("/")) {
//         rutaScript = `tests/${rutaScript}`;
//       }

//       const nombreRaw =
//         esc.escenarioPython || esc.casoPrueba || esc.descripcion;
//       const nombreDef = formatPythonDefName(nombreRaw);

//       return `"${rutaScript}::${nombreDef}"`;
//     });

//     const args = [
//       "-u",
//       "-m",
//       "pytest",
//       ...testTargets,
//       "-s",
//       "-q",
//       "-p",
//       "--ip",
//       "no:faulthandler",
//       "--tb=short",
//       connection?.ip || "127.0.0.1",
//       "--port",
//       connection?.port || "5000",
//       "--monto",
//       parameters?.monto || "1.00",
//       "--moneda",
//       parameters?.moneda || "0340",
//       "--impuesto",
//       parameters?.impuesto || "0",
//       "--module",
//       moduleName || "Desconocido",
//       "--submodule",
//       submoduleName || "Desconocido",
//     ];

//     if (parameters?.facturaAnular && parameters.facturaAnular.trim() !== "") {
//       args.push("--factura", parameters.facturaAnular);
//     }

//     console.log(`Comando a ejecutar: python ${args.join(" ")}`);

//     const pythonProcess = spawn("python", args, {
//       cwd: pythonProjectPath,
//       shell: true,
//       env: {
//         ...process.env,
//         PYTHONUNBUFFERED: "1",
//         PYTHONIOENCODING: "utf-8",
//         DCL_EXE_PATH,
//         EVIDENCES_DIR,
//         DCL_IP: connection?.ip,
//         DCL_PORT: connection?.port,
//         TRANS_MONTO: parameters?.monto,
//         TRANS_MONEDA: parameters?.moneda,
//         TRANS_IMPUESTO: parameters?.impuesto || "0",
//         TRANS_FACTURA: parameters?.facturaAnular || "",
//         DCL_MODULE: moduleName,
//         DCL_SUBMODULE: submoduleName,
//       },
//     });

//     // Guardar referencia del subproceso activo por ID
//     procesosActivos.set(executionId, pythonProcess);

//     let logOutput = "";

//     pythonProcess.stdout.on("data", (data) => {
//       const chunk = data.toString();
//       logOutput += chunk;
//       console.log(`[PyOut #${executionId}]: ${chunk}`);

//       prisma.executionHistory
//         .update({
//           where: { id: executionId },
//           // data: { logOutput },
//           data: { logOutput: formatCleanLogs(logOutput) },
//         })
//         .catch(() => {});
//     });

//     pythonProcess.stderr.on("data", (data) => {
//       const chunk = data.toString();
//       logOutput += chunk;
//       console.error(`[PyErr #${executionId}]: ${chunk}`);

//       prisma.executionHistory
//         .update({
//           where: { id: executionId },
//           data: { logOutput },
//         })
//         .catch(() => {});
//     });

//     pythonProcess.on("close", async (code) => {
//       procesosActivos.delete(executionId);

//       const finalStatus = code === 0 ? "EXITO" : "FALLO";
//       let mensajeExtra = `\nProceso finalizado con código: ${code}`;
//       let resultadoExcel = null;
//       let pasosFinales = [];

//       try {
//         const estadoParaExcel = code === 0 ? "EXITOSA" : "FALLIDO";
//         const escenariosParaExcel = JSON.parse(
//           JSON.stringify(escenariosConfigurados || [])
//         );

//         const rutaJsonPython = path.resolve(
//           pythonProjectPath,
//           "resultado_matriz.json"
//         );

//         if (fs.existsSync(rutaJsonPython)) {
//           const rawData = fs.readFileSync(rutaJsonPython, "utf-8");
//           const dataPython = JSON.parse(rawData);

//           if (Array.isArray(dataPython.escenarios) && dataPython.escenarios.length > 0) {
//             dataPython.escenarios.forEach((escPy, idx) => {
//               const pasosEsc = Array.isArray(escPy.pasos) ? escPy.pasos : [];
//               if (escenariosParaExcel[idx]) {
//                 escenariosParaExcel[idx].pasos = pasosEsc;
//               }
//               pasosFinales.push(...pasosEsc);
//             });
//           } else if (Array.isArray(dataPython.pasos)) {
//             if (escenariosParaExcel[0]) {
//               escenariosParaExcel[0].pasos = dataPython.pasos;
//             }
//             pasosFinales.push(...dataPython.pasos);
//           }
//         }

//         // Si Python falló antes de generar resultado_matriz.json, conservar los pasos base configurados
//         if (pasosFinales.length === 0) {
//           escenariosParaExcel.forEach((esc) => {
//             if (Array.isArray(esc.pasos)) {
//               pasosFinales.push(...esc.pasos);
//             }
//           });
//         }

//         const dataParaMatriz = {
//           ...historyData,
//           escenarios: escenariosParaExcel,
//         };

//         resultadoExcel = await generarMatrizPruebas(
//           dataParaMatriz,
//           estadoParaExcel
//         );

//         if (resultadoExcel && resultadoExcel.nombreArchivo) {
//           mensajeExtra += `\n✨ Matriz de Pruebas generada dinámicamente (${estadoParaExcel}): ${resultadoExcel.nombreArchivo}`;
//         }
//       } catch (excelError) {
//         console.error("Error generando matriz post-ejecución:", excelError);
//         mensajeExtra += `\n⚠️ Error al generar el Excel automático: ${excelError.message}`;
//       }

//       const cleanFinalLog = `${formatCleanLogs(logOutput, code)}\n${mensajeExtra}`.trim();

//       await prisma.executionHistory.update({
//         where: { id: executionId },
//         data: {
//           status: finalStatus,
//           // logOutput: logOutput + mensajeExtra,
//           logOutput: cleanFinalLog,
//           completedAt: new Date(),
//           evidenceUrl: resultadoExcel?.nombreArchivo
//             ? `/descargas/${resultadoExcel.nombreArchivo}`
//             : null,
//           steps: pasosFinales.length > 0 ? JSON.stringify(pasosFinales) : null,
//         },
//       });

//       console.log(
//         `Ejecución #${executionId} finalizada con estado: ${finalStatus} (${pasosFinales.length} pasos guardados)`
//       );
//     });
//   } catch (error) {
//     console.error("Error en el servicio Runner:", error);
//     procesosActivos.delete(executionId);

//     await prisma.executionHistory.update({
//       where: { id: executionId },
//       data: {
//         status: "FALLO",
//         logOutput: `Error interno del orquestador: ${error.message}`,
//         completedAt: new Date(),
//       },
//     });
//   }
// }

// // Función para detener únicamente el subproceso de Pytest
// function cancelTest(executionId) {
//   const pythonProcess = procesosActivos.get(executionId);
//   if (pythonProcess) {
//     try {
//       if (process.platform === "win32") {
//         exec(`taskkill /F /T /PID ${pythonProcess.pid}`);
//       } else {
//         pythonProcess.kill("SIGINT");
//       }
//       procesosActivos.delete(executionId);
//       return true;
//     } catch (err) {
//       console.error(`Error cancelando ejecución #${executionId}:`, err);
//       return false;
//     }
//   }
//   return false;
// }

// module.exports = { executeTest, cancelTest };