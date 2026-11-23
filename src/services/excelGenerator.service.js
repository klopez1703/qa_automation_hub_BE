const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');

async function generarMatrizPruebas(dataHistoria, estadoEjecucion = 'EXITOSO') {
  const workbook = new ExcelJS.Workbook();
  const rutaPlantilla = path.resolve(__dirname, '../templates/Plan Detallado de Pruebas.xlsx');
  
  if (!fs.existsSync(rutaPlantilla)) {
    throw new Error('No se encontró la plantilla "Plan Detallado de Pruebas.xlsx" en el servidor.');
  }

  await workbook.xlsx.readFile(rutaPlantilla);

  // 1. Rellenar la hoja índice "Plan Detallado (escenarios)"
  const hojaIndice = workbook.getWorksheet('Plan Detallado (escenarios)') || workbook.worksheets[0];
  
  if (hojaIndice) {
    const replacements = {
      '@history': dataHistoria.nombreHistoria || '',
      '@codeHistory': dataHistoria.codigoHistoria || '',
      '@tribu': dataHistoria.tribu || '',
      '@squad': dataHistoria.squad || '',
      '@pais': dataHistoria.pais || '',
      '@productOwner': dataHistoria.productOwner || '',
      '@scrumMaster': dataHistoria.scrumMaster || '',
      '@fechaElaboracion': dataHistoria.fechaElaboracion || '',
      '@elaboradoPor': dataHistoria.elaboradoPor || ''
    };

    hojaIndice.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (typeof cell.value === 'string') {
          let val = cell.value;
          let changed = false;
          for (const [token, text] of Object.entries(replacements)) {
            if (val.includes(token)) {
              val = val.replace(new RegExp(token, 'g'), text);
              changed = true;
            }
          }
          if (changed) cell.value = val;
        }
      });
    });

    // Rellenar tabla resumen a partir de la fila 19
    let filaInicio = 19;
    if (dataHistoria.escenarios) {
      dataHistoria.escenarios.forEach((esc, index) => {
        const r = filaInicio + index;
        hojaIndice.getCell(`A${r}`).value = esc.id;
        hojaIndice.getCell(`B${r}`).value = esc.tipoPrueba || 'Solo Funcional';
        hojaIndice.getCell(`C${r}`).value = esc.casoPrueba ? esc.casoPrueba.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase()) : 'Ejecución Manual';
        hojaIndice.getCell(`D${r}`).value = esc.descripcion ? esc.descripcion.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase()) : 'Ejecución Manual';
        hojaIndice.getCell(`E${r}`).value = esc.modulo;
        hojaIndice.getCell(`F${r}`).value = esc.precondiciones || '';
        hojaIndice.getCell(`G${r}`).value = esc.postcondiciones || 'N/A';
        hojaIndice.getCell(`H${r}`).value = esc.prioridad || 'Alta';
      });
    }
  }

  // 2. Obtener la hoja modelo de referencia (FBQA-TEMPLATE o FBQA-001)
  const hojaModelo = workbook.getWorksheet('FBQA-TEMPLATE') || workbook.getWorksheet('FBQA-001');

  if (dataHistoria.escenarios && dataHistoria.escenarios.length > 0 && hojaModelo) {
    
    for (const esc of dataHistoria.escenarios) {
      const nuevaHoja = workbook.addWorksheet(esc.id);
      
      // Copiar filas, alturas y celdas preservando estilos
      hojaModelo.eachRow({ includeEmpty: true }, (row, rowNumber) => {
        const nuevaFila = nuevaHoja.getRow(rowNumber);
        nuevaFila.height = row.height;
        
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          const nuevaCelda = nuevaFila.getCell(colNumber);
          nuevaCelda.value = cell.value;
          if (cell.style) {
            nuevaCelda.style = JSON.parse(JSON.stringify(cell.style));
          }
        });
      });

      // Copiar anchos de columnas
      if (hojaModelo.columns) {
        nuevaHoja.columns = hojaModelo.columns.map(col => ({ width: col.width }));
      }

      // Copiar combinaciones de celdas (merges) de forma nativa
      if (hojaModelo.model && hojaModelo.model.merges) {
        hojaModelo.model.merges.forEach(mergeRange => {
          try {
            nuevaHoja.mergeCells(mergeRange);
          } catch (e) {
            // Ignorar si ya está combinado
          }
        });
      }

      // Reemplazo de metadatos (tokens)
      nuevaHoja.eachRow((row) => {
        row.eachCell((cell) => {
          if (typeof cell.value === 'string') {
            let v = cell.value;
            v = v.replace(/@sistema/g, esc.sistema || 'Portal Externo');
            v = v.replace(/@modulo/g, esc.modulo || '');
            v = v.replace(/@analistaPruebas/g, dataHistoria.elaboradoPor || '');
            v = v.replace(/@fechalnicio/g, dataHistoria.fechaElaboracion || '');
            v = v.replace(/@casoPrueba/g, esc.casoPrueba ? esc.casoPrueba.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase()) : 'Ejecución Manual');
            cell.value = v;
          }
        });
      });

      if (estadoEjecucion === 'FALLIDO') {
        nuevaHoja.getCell('L16').value = '☐'; // PASA
        nuevaHoja.getCell('L17').value = '☒'; // FALLA
      } else {
        nuevaHoja.getCell('L16').value = '☒'; // PASA
        nuevaHoja.getCell('L17').value = '☐'; // FALLA
      }

      // 3. Insertar pasos y evidencias en grillas de 3 columnas diferenciadas
      let filaGuion = 22;
      let filaEvidenciaActual = 37; // La sección "Evidencia de Pruebas" inicia en la fila 37
      let pcColIndex = 0;           // Contador de grilla (3 columnas) para DCL / PC
      let posColIndex = 0;          // Contador de grilla (3 columnas) para POS

      const columnasTabla = ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];

      if (esc.pasos && esc.pasos.length > 0) {
        for (let pIndex = 0; pIndex < esc.pasos.length; pIndex++) {
          const paso = esc.pasos[pIndex];
          const f = filaGuion + pIndex;
          
          // Clonar estilos y bordes de la tabla superior
          columnasTabla.forEach(col => {
            const celdaBase = nuevaHoja.getCell(`${col}22`);
            const celdaActual = nuevaHoja.getCell(`${col}${f}`);

            if (celdaBase.style) {
              celdaActual.style = JSON.parse(JSON.stringify(celdaBase.style));
            }

            celdaActual.alignment = {
              ...(celdaActual.alignment || {}),
              wrapText: true,
              vertical: 'middle'
            };
          });

          // Valores del guion
          nuevaHoja.getCell(`B${f}`).value = pIndex + 1; 
          nuevaHoja.getCell(`C${f}`).value = paso.tipoPaso || 'P'; 
          nuevaHoja.getCell(`D${f}`).value = paso.descripcionDeLaPrueba || ''; 
          nuevaHoja.getCell(`E${f}`).value = paso.datosParaLaPrueba || 'N/A'; 
          nuevaHoja.getCell(`F${f}`).value = paso.pasosParaRealizarLaPruebaFuncional || ''; 
          nuevaHoja.getCell(`G${f}`).value = paso.resultadoFuncionalEsperado || ''; 
          
          let estadoPaso = 'Exitoso';
          let pasaPrueba = 'SI';
          let resultadoObtenido = paso.resultadoFuncionalObtenido || 'El comportamiento del sistema coincide con el resultado esperado de la prueba.';

          if (estadoEjecucion === 'FALLIDO') {
             estadoPaso = 'Fallido';
             pasaPrueba = 'NO';
             if (!paso.resultadoFuncionalObtenido) {
                 resultadoObtenido = 'La automatización falló: No se cumplió el resultado esperado, ocurrió una excepción en el script o hubo un error de conexión con el POS.';
             }
          }
          
          nuevaHoja.getCell(`H${f}`).value = resultadoObtenido;
          nuevaHoja.getCell(`I${f}`).value = estadoPaso;
          nuevaHoja.getCell(`J${f}`).value = pasaPrueba;

          // --- NORMALIZAR LISTA DE CAPTURAS (Paso único o Array de múltiples recibos) ---
          let listaRutas = [];
          if (Array.isArray(paso.rutasImagenes)) {
            listaRutas = paso.rutasImagenes;
          } else if (Array.isArray(paso.rutaImagen)) {
            listaRutas = paso.rutaImagen;
          } else if (typeof paso.rutaImagen === 'string' && paso.rutaImagen.trim() !== '') {
            listaRutas = [paso.rutaImagen];
          }

          // Procesar e incrustar cada captura de pantalla del paso
          for (let imgIdx = 0; imgIdx < listaRutas.length; imgIdx++) {
            const itemRuta = listaRutas[imgIdx];
            if (!itemRuta) continue;

            const rutaString = String(itemRuta).trim();
            const rutaAbsoluta = path.isAbsolute(rutaString)
              ? rutaString
              : path.resolve(process.cwd(), rutaString);

            if (fs.existsSync(rutaAbsoluta)) {
              try {
                const imageId = workbook.addImage({
                  filename: rutaAbsoluta,
                  extension: 'png',
                });

                const nombreArchivoCaptura = path.basename(rutaAbsoluta);
                const esPC = paso.tipoPaso === 'P' || /^PC_/i.test(nombreArchivoCaptura) || /DCL/i.test(nombreArchivoCaptura);

                if (esPC) {
                  // --- CAPTURAS DE DCL / PC ---
                  if (posColIndex > 0) {
                    filaEvidenciaActual += 38;
                    posColIndex = 0;
                  }

                  const colGrid = pcColIndex % 3;
                  const colExcelIndex = colGrid === 0 ? 1 : (colGrid === 1 ? 5 : 9); // Columnas B, F, J (0-indexed)
                  const colLetra = colGrid === 0 ? 'B' : (colGrid === 1 ? 'F' : 'J');

                  const celdaTitulo = nuevaHoja.getCell(`${colLetra}${filaEvidenciaActual}`);
                  const etiquetaSub = listaRutas.length > 1 ? ` (Recibo ${imgIdx + 1}/${listaRutas.length})` : '';
                  celdaTitulo.value = `Paso ${pIndex + 1}: ${paso.descripcionDeLaPrueba}${etiquetaSub}`;
                  celdaTitulo.font = { bold: true, size: 9, color: { argb: '0047B3' } };

                  nuevaHoja.addImage(imageId, {
                    tl: { col: colExcelIndex, row: filaEvidenciaActual + 1 },
                    ext: { width: 587, height: 361 }
                  });

                  pcColIndex++;
                  if (pcColIndex % 3 === 0) {
                    filaEvidenciaActual += 21; 
                    pcColIndex = 0;
                  }
                } else {
                  // --- CAPTURAS DE POS / TICKETS (INCLUYE LOS 4 RECIBOS POR VENTA) ---
                  if (pcColIndex > 0) {
                    filaEvidenciaActual += 21;
                    pcColIndex = 0;
                  }

                  const colGrid = posColIndex % 3;
                  const colExcelIndex = colGrid === 0 ? 1 : (colGrid === 1 ? 5 : 9); // Columnas B, F, J (0-indexed)
                  const colLetra = colGrid === 0 ? 'B' : (colGrid === 1 ? 'F' : 'J');

                  const celdaTitulo = nuevaHoja.getCell(`${colLetra}${filaEvidenciaActual}`);
                  const etiquetaSub = listaRutas.length > 1 ? ` (Recibo ${imgIdx + 1}/${listaRutas.length})` : '';
                  celdaTitulo.value = `Paso ${pIndex + 1}: ${paso.descripcionDeLaPrueba}${etiquetaSub}`;
                  celdaTitulo.font = { bold: true, size: 9, color: { argb: '0047B3' } };

                  nuevaHoja.addImage(imageId, {
                    tl: { col: colExcelIndex, row: filaEvidenciaActual + 1 },
                    ext: { width: 395, height: 680 }
                  });

                  posColIndex++;
                  if (posColIndex % 3 === 0) {
                    filaEvidenciaActual += 38; 
                    posColIndex = 0;
                  }
                }
              } catch (imgError) {
                console.error(`Error al incrustar la imagen del paso ${pIndex + 1} (Recibo ${imgIdx + 1}):`, imgError.message);
              }
            }
          }
        }
      }
    }

    workbook.removeWorksheet(hojaModelo.id);
  }

  // 4. Guardar archivo final
  const dirEvidencias = path.resolve(__dirname, '../../matricez');
  if (!fs.existsSync(dirEvidencias)) {
    fs.mkdirSync(dirEvidencias, { recursive: true });
  }

  const nombreArchivo = `Matriz_Pruebas_${Date.now()}.xlsx`;
  const rutaCompleta = path.join(dirEvidencias, nombreArchivo);
  
  await workbook.xlsx.writeFile(rutaCompleta);
  return { rutaCompleta, nombreArchivo };
}

module.exports = { generarMatrizPruebas };