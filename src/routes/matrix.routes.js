const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const { generarMatrizPruebas } = require('../services/excelGenerator.service');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });
const { MatrizReader } = require('../utils/MatrizReader');
const https = require('https');
require('dotenv').config();

// Endpoint para generar la matriz directamente sin ejecución de pruebas
router.post('/generate-only', async (req, res) => {
  try {
    const { history, escenarios, estadoEjecucion } = req.body;

    const dataParaMatriz = {
      ...history,
      escenarios: escenarios || []
    };

    // Generar el archivo Excel usando la plantilla
    const resultado = await generarMatrizPruebas(
      dataParaMatriz, 
      estadoEjecucion || 'NUEVA'
    );

    if (resultado && resultado.nombreArchivo) {
      return res.json({
        success: true,
        downloadUrl: `/descargas/${resultado.nombreArchivo}`
      });
    }

    res.status(500).json({ error: 'No se pudo generar el archivo Excel' });
  } catch (error) {
    console.error('Error al generar matriz standalone:', error);
    res.status(500).json({ error: error.message });
  }
});


router.post('/leer-matriz', upload.single('archivo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se subió ningún archivo' });
    }

    // Leer el archivo enviado desde req.file.path o req.file.buffer
    const resultado = await MatrizReader.leerEscenariosDeMatriz(req.file.path || req.file.buffer);

    // Responder al frontend con los datos de la Historia, los Escenarios y la Ruta del archivo en disco
    return res.json({
      success: true,
      rutaMatrizCargada: req.file.path || '', // Permite al ejecutor actualizar este mismo archivo
      history: resultado.history,
      escenarios: resultado.escenarios
    });
  } catch (error) {
    console.error('Error al leer la matriz:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/generar-matriz', async (req, res) => {
  try {
    const dataDesdeFrontend = req.body; 
    
    // Pasamos la data pura del frontend al generador
    const resultado = await generarMatrizPruebas(dataDesdeFrontend);
    
    // Devolvemos el downloadUrl para que el frontend no falle
    res.json({
      mensaje: "Matriz generada exitosamente",
      nombreArchivo: resultado.nombreArchivo,
      downloadUrl: `/matrix/descargar/${resultado.nombreArchivo}`
    });
  } catch (error) {
    console.error("Error al generar matriz:", error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint para descargar el archivo generado
router.get('/descargar/:nombre', (req, res) => {
  const file = path.resolve(__dirname, '../../matricez', req.params.nombre);
  res.download(file);
});

// GET /api/matrix/python-templates
router.get('/python-templates', (req, res) => {
  try {
    // 1. Apuntamos a la carpeta que contiene los scripts de Python
    const testsDir = path.resolve(__dirname, '../../../../pos_screenplay_framework/tests/');

    if (!fs.existsSync(testsDir)) {
      return res.status(404).json({ error: 'No se encontró la carpeta de tests de Python.' });
    }

    // 2. Leemos todos los archivos del directorio y filtramos solo los que terminan en .py
    const files = fs.readdirSync(testsDir).filter(file => file.endsWith('.py'));
    const escenariosPython = [];

    // 3. Iteramos por cada archivo .py encontrado para extraer su información
    files.forEach((file, index) => {
      const pyFilePath = path.join(testsDir, file);
      const pyCode = fs.readFileSync(pyFilePath, 'utf-8');

      // Expresión regular para encontrar todo lo que está dentro de pasos.append({ ... })
      const regexPasos = /pasos\.append\(\s*\{([\s\S]*?)\}\s*\)/g;
      let match;
      const pasosExtraidos = [];

      // Iteramos por cada paso encontrado en el código del archivo actual
      while ((match = regexPasos.exec(pyCode)) !== null) {
        const bloque = match[1];

        // Función auxiliar para extraer el valor de cada atributo
        const extraerValor = (llave) => {
          const regexLlave = new RegExp(`"${llave}"\\s*:\\s*(?:f)?"([^"]*)"`);
          const resultado = bloque.match(regexLlave);
          return resultado ? resultado[1] : "";
        };

        // Limpiamos el texto de los f-strings
        let datosPruebaRaw = extraerValor("datosParaLaPrueba");
        let datosPruebaLimpio = datosPruebaRaw.replace(/\{exec_params\['([^']+)'\]\}/g, "[$1]");

        pasosExtraidos.push({
          origen: 'Automatizado',
          tipoPaso: extraerValor("tipoPaso") || 'P',
          descripcionDeLaPrueba: extraerValor("descripcionDeLaPrueba"),
          datosParaLaPrueba: datosPruebaLimpio || 'N/A',
          pasosParaRealizarLaPruebaFuncional: extraerValor("pasosParaRealizarLaPruebaFuncional"),
          resultadoFuncionalEsperado: extraerValor("resultadoFuncionalEsperado")
        });
      }

      // Limpiamos el nombre del archivo para mostrar un título amigable (opcional)
      const nombreAmigable = file.replace('test_', '').replace('.py', '').replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

      // 4. Agregamos el archivo escaneado al catálogo dinámico
      escenariosPython.push({
        id: index + 1,
        // Mandamos el nombre del archivo exacto para que el frontend pueda hacer el match y extraer los 'def' posteriormente
        nombre: file, 
        modulo: "KinPOS",
        descripcion: `Plantilla dinámica extraída de ${file}`,
        prioridad: "Alta",
        precondiciones: "Sistema POS y DCL listos",
        postcondiciones: "N/A",
        pasos: pasosExtraidos
      });
    });

    // Devolvemos el array con todos los archivos .py encontrados
    res.json(escenariosPython);
  } catch (error) {
    console.error('Error extrayendo scripts de Python:', error);
    res.status(500).json({ error: 'Error interno leyendo los archivos de Python.' });
  }
});

// 1. Ruta para obtener la lista de funciones (def test_...) del script seleccionado
router.get('/parse-python-scenarios', (req, res) => {
  try {
    const scriptPath = req.query.path; 
    if (!scriptPath) return res.status(400).json({ error: "Ruta requerida" });

    // Ajusta la ruta base según la estructura de tu proyecto
    const rootPath = path.resolve(__dirname, '../../../../');
    const fullSpecPath = path.join(rootPath, scriptPath);

    if (!fs.existsSync(fullSpecPath)) {
      return res.status(404).json({ error: 'No se encontró el script de Python.' });
    }

    const scriptContent = fs.readFileSync(fullSpecPath, 'utf8');
    const escenarios = [];
    
    // Busca todas las funciones que empiecen con "def test_"
    const defRegex = /^def\s+(test_[a-zA-Z0-9_]+)\s*\(/gm;
    let match;
    while ((match = defRegex.exec(scriptContent)) !== null) {
      escenarios.push(match[1]);
    }

    res.json({ escenarios });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error leyendo escenarios.' });
  }
});

// 2. Ruta para extraer los pasos de UN SOLO 'def' específico
router.get('/parse-python-steps', (req, res) => {
  try {
    const scriptPath = req.query.path;
    const escenarioNombre = req.query.escenario; // Ej: test_anulacion_retail
    
    if (!scriptPath || !escenarioNombre) return res.status(400).json({ error: "Faltan parámetros" });

    const rootPath = path.resolve(__dirname, '../../../../');
    const fullSpecPath = path.join(rootPath, scriptPath);

    if (!fs.existsSync(fullSpecPath)) return res.status(404).json({ error: 'Archivo no encontrado' });

    const pyCode = fs.readFileSync(fullSpecPath, 'utf-8');

    // AISLAMIENTO DE LA FUNCIÓN: Cortamos el archivo cada vez que aparece "def "
    const bloquesFunciones = pyCode.split(/^def\s+/m);
    let bloqueObjetivo = "";
    
    for (const bloque of bloquesFunciones) {
      if (bloque.startsWith(escenarioNombre)) {
        bloqueObjetivo = bloque;
        break;
      }
    }

    if (!bloqueObjetivo) return res.json({ pasos: [] });

    const regexPasos = /pasos\.append\s*\(\s*\{([\s\S]*?)\}\s*\)/g;
    let matchPaso;
    const pasosExtraidos = [];
    let ordenPaso = 1;

    // Iteramos SOLO por los pasos encontrados dentro del bloque de la función seleccionada
    while ((matchPaso = regexPasos.exec(bloqueObjetivo)) !== null) {
      const bloque = matchPaso[1];

      const extraerValor = (llave) => {
        const reg = new RegExp(`['"]${llave}['"]\\s*:\\s*(?:f)?['"]([\\s\\S]*?)['"]`);
        const res = bloque.match(reg);
        return res ? res[1] : "";
      };

      let datosPruebaRaw = extraerValor("datosParaLaPrueba");
      let datosPruebaLimpio = datosPruebaRaw.replace(/\{[^}]+\}/g, "...");

      const imgRegex = /"rutaImagen"\s*:\s*os\.path\.abspath\(['"]([^'"]+)['"]\)/;
      const imgMatch = bloque.match(imgRegex);
      let rutaImagenFinal = `evidencias/paso_${ordenPaso}.png`;
      
      if (imgMatch && imgMatch[1]) {
        const fileName = imgMatch[1].split('/').pop() || imgMatch[1].split('\\').pop();
        rutaImagenFinal = `evidencias/${ordenPaso}_${fileName}`;
      }

      pasosExtraidos.push({
        origen: 'Automatizado',
        tipoPaso: extraerValor("tipoPaso") || 'P',
        descripcionDeLaPrueba: extraerValor("descripcionDeLaPrueba"),
        datosParaLaPrueba: datosPruebaLimpio || 'N/A',
        pasosParaRealizarLaPruebaFuncional: extraerValor("pasosParaRealizarLaPruebaFuncional"),
        resultadoFuncionalEsperado: extraerValor("resultadoFuncionalEsperado"),
        rutaImagen: rutaImagenFinal
      });
      ordenPaso++;
    }

    res.json({ pasos: pasosExtraidos });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});


router.get('/azure-workitem', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'La URL es requerida' });

    // 1. Extraer el ID numérico (Soporta ?workitem=171746 y /_workitems/edit/171746)
    let workItemId = null;
    const matchQuery = url.match(/[?&]workitem=(\d+)/i);
    const matchEdit = url.match(/_workitems\/edit\/(\d+)/i);
    const matchRaw = url.match(/\b(\d{5,7})\b/);

    if (matchQuery) {
      workItemId = matchQuery[1];
    } else if (matchEdit) {
      workItemId = matchEdit[1];
    } else if (matchRaw) {
      workItemId = matchRaw[1];
    }

    if (!workItemId) {
      return res.status(400).json({ error: 'No se identificó el ID de la historia' });
    }

    // 2. Extraer la organización dinámicamente de la URL (DevopsFicohsa)
    let org = 'DevopsFicohsa';
    try {
      const decodedUrl = decodeURIComponent(url);
      const parsedUrl = new URL(decodedUrl);
      const segments = parsedUrl.pathname.split('/').filter(Boolean);
      if (segments.length > 0) {
        org = segments[0];
      }
    } catch (e) {
      // Usar 'DevopsFicohsa' por defecto
    }

    // 3. Leer el PAT de las variables de entorno
    const azurePat = process.env.AZURE_DEVOPS_PAT;
    if (!azurePat) {
      console.warn('⚠️ AZURE_DEVOPS_PAT no está configurado en .env');
      return res.json({ id: String(workItemId), title: '' });
    }

    // 4. Construir la consulta HTTPS limpia a nivel de organización
    const pathApi = `/${encodeURIComponent(org)}/_apis/wit/workitems/${workItemId}?api-version=7.0`;
    const authHeader = 'Basic ' + Buffer.from(`:${azurePat.trim()}`).toString('base64');

    const options = {
      hostname: 'dev.azure.com',
      port: 443,
      path: pathApi,
      method: 'GET',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
        'User-Agent': 'Node.js-Express-App'
      }
    };

    const azureReq = https.request(options, (azureRes) => {
      let data = '';

      azureRes.on('data', (chunk) => {
        data += chunk;
      });

      azureRes.on('end', () => {
        try {
          if (azureRes.statusCode >= 200 && azureRes.statusCode < 300) {
            const json = JSON.parse(data);
            const title = json.fields?.['System.Title'] || '';
            return res.json({ id: String(workItemId), title: title });
          } else {
            console.error(`❌ Error API Azure (${azureRes.statusCode}) en ${pathApi}:`, data);
            return res.json({ id: String(workItemId), title: '' });
          }
        } catch (e) {
          console.error('❌ Error parseando JSON de Azure:', e);
          return res.json({ id: String(workItemId), title: '' });
        }
      });
    });

    azureReq.on('error', (err) => {
      console.error('❌ Error en la petición HTTPS a Azure:', err.message);
      return res.json({ id: String(workItemId), title: '' });
    });

    azureReq.end();

  } catch (error) {
    console.error('❌ Error general en /azure-workitem:', error.message);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;