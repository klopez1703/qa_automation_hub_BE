const ExcelJS = require('exceljs');

class MatrizReader {
  static async leerEscenariosDeMatriz(origenExcel) {
    const workbook = new ExcelJS.Workbook();

    if (Buffer.isBuffer(origenExcel)) {
      await workbook.xlsx.load(origenExcel);
    } else if (typeof origenExcel === 'string') {
      await workbook.xlsx.readFile(origenExcel);
    } else {
      throw new Error('El origen del archivo Excel no es válido.');
    }

    const getCellText = (sheet, rowNum, colNum) => {
      const cell = sheet.getRow(rowNum).getCell(colNum);
      if (!cell || cell.value === null || cell.value === undefined) return '';

      if (typeof cell.text === 'string' && cell.text.trim()) {
        return cell.text.trim();
      }

      const val = cell.value;
      if (typeof val === 'object') {
        if (val.richText) return val.richText.map(r => r.text).join('').trim();
        if (val.result !== undefined) return String(val.result).trim();
        if (val.text !== undefined) return String(val.text).trim();
      }
      return String(val).trim();
    };

    // 1. Intentar leer desde la hoja resumen "Plan Detallado (escenarios)"
    let hojaResumen = workbook.getWorksheet('Plan Detallado (escenarios)');
    if (!hojaResumen) {
      hojaResumen = workbook.worksheets.find(s => 
        s.name.trim().toLowerCase() === 'plan detallado (escenarios)'
      ) || workbook.worksheets[0];
    }

    // EXTRAER DATOS GENERALES DE LA HISTORIA (Celdas C7 a C16)
    const historyHeader = {
      nombreHistoria: getCellText(hojaResumen, 7, 3),   // Celda C7
      codigoHistoria: getCellText(hojaResumen, 8, 3),   // Celda C8
      tribu: getCellText(hojaResumen, 9, 3) || 'Empresas',        // Celda C9
      squad: getCellText(hojaResumen, 10, 3) || 'Adquirencias',  // Celda C10
      pais: getCellText(hojaResumen, 11, 3) || 'Honduras',       // Celda C11
      productOwner: getCellText(hojaResumen, 12, 3) || 'Julia Milagros Zuniga Cruz',            // Celda C12
      scrumMaster: getCellText(hojaResumen, 13, 3) || 'Dorian Yamal Mazariegos Chavez',             // Celda C13
      fechaElaboracion: getCellText(hojaResumen, 14, 3) || new Date().toISOString().split('T')[0], // Celda C14
      elaboradoPor: getCellText(hojaResumen, 16, 3) || 'Kevin Agustin López Hernández'             // Celda C16
    };

    const escenarios = [];

    if (hojaResumen) {
      let filaActual = 19;
      while (filaActual <= 200) {
        const codigoId = getCellText(hojaResumen, filaActual, 1); // Columna A

        if (!codigoId || !codigoId.toUpperCase().startsWith('FBQA-')) {
          if (filaActual > 35 && !codigoId) break;
          filaActual++;
          continue;
        }

        const tipoPrueba = getCellText(hojaResumen, filaActual, 2) || 'Solo Funcional';
        const casoPrueba = getCellText(hojaResumen, filaActual, 3);
        const descripcion = getCellText(hojaResumen, filaActual, 4);
        const modulo = getCellText(hojaResumen, filaActual, 5) || 'VENTA';
        const precondiciones = getCellText(hojaResumen, filaActual, 6) || 'N/A';
        const postcondiciones = getCellText(hojaResumen, filaActual, 7) || 'N/A';
        const prioridad = getCellText(hojaResumen, filaActual, 8) || 'Alta';

        let pasos = [];
        let hojaDetalle = workbook.getWorksheet(codigoId);
        if (!hojaDetalle) {
          hojaDetalle = workbook.worksheets.find(s => 
            s.name.trim().toLowerCase() === codigoId.toLowerCase()
          );
        }

        if (hojaDetalle) {
          pasos = this.extraerPasosDeHojaDetalle(hojaDetalle, getCellText);
        }

        escenarios.push({
          id: codigoId,
          tipoPrueba,
          casoPrueba: casoPrueba || codigoId,
          script: 'tests/test_flujo_retail.py',
          escenarioPython: casoPrueba || codigoId,
          descripcion: descripcion || `Automatización de ${casoPrueba}`,
          modulo,
          precondiciones,
          postcondiciones,
          prioridad,
          pasos
        });

        filaActual++;
      }
    }

    if (escenarios.length === 0) {
      workbook.worksheets.forEach(sheet => {
        const nombreHoja = sheet.name.trim();
        if (nombreHoja.toUpperCase().startsWith('FBQA-')) {
          const casoPrueba = getCellText(sheet, 16, 5) || getCellText(sheet, 16, 4) || nombreHoja;
          const modulo = getCellText(sheet, 9, 5) || getCellText(sheet, 9, 4) || 'VENTA';
          const pasos = this.extraerPasosDeHojaDetalle(sheet, getCellText);

          escenarios.push({
            id: nombreHoja,
            tipoPrueba: 'Solo Funcional',
            casoPrueba,
            script: 'tests/test_flujo_retail.py',
            escenarioPython: casoPrueba,
            descripcion: `Automatización de ${casoPrueba}`,
            modulo,
            precondiciones: 'N/A',
            postcondiciones: 'N/A',
            prioridad: 'Alta',
            pasos
          });
        }
      });
    }

    // RETORNAR ESTRUCTURA COMPLETA CON HISTORIA Y ESCENARIOS
    return {
      history: historyHeader,
      escenarios
    };
  }

  static extraerPasosDeHojaDetalle(hoja, getCellText) {
    let filaInicioPasos = 0;
    let colTipoPaso = 2; // Columna B

    for (let r = 15; r <= 25; r++) {
      for (let c = 1; c <= 5; c++) {
        const val = getCellText(hoja, r, c).toLowerCase();
        if (val.includes('paso') || val.includes('pv') || val.includes('descripción')) {
          filaInicioPasos = r + 1;
          if (val.includes('paso') || val.includes('pv')) {
            colTipoPaso = c;
          }
          break;
        }
      }
      if (filaInicioPasos > 0) break;
    }

    if (filaInicioPasos === 0) filaInicioPasos = 21;

    const pasos = [];
    let filaActual = filaInicioPasos;

    while (filaActual <= 100) {
      const numPasoStr = getCellText(hoja, filaActual, colTipoPaso - 1);
      const tipoPasoVal = getCellText(hoja, filaActual, colTipoPaso);
      const descStr = getCellText(hoja, filaActual, colTipoPaso + 1);
      const datosStr = getCellText(hoja, filaActual, colTipoPaso + 3);
      const pasosFuncStr = getCellText(hoja, filaActual, colTipoPaso + 4);
      const resultadoStr = getCellText(hoja, filaActual, colTipoPaso + 5);

      if (!numPasoStr && !descStr && !pasosFuncStr) break;

      const tipoPasoUpper = tipoPasoVal.toUpperCase().trim();
      const tipoPaso = tipoPasoUpper.includes('PV') ? 'PV' : 'P';

      // AL SER LEÍDO DE UNA MATRIZ DE AUTOMATIZACIÓN, FORZAR ORIGEN AUTOMATIZADO
      pasos.push({
        tipoPaso,
        origen: 'Automatizado',
        descripcionDeLaPrueba: descStr,
        datosParaLaPrueba: datosStr || 'N/A',
        pasosParaRealizarLaPruebaFuncional: pasosFuncStr,
        resultadoFuncionalEsperado: resultadoStr
      });

      filaActual++;
    }

    return pasos;
  }
}

module.exports = { MatrizReader };