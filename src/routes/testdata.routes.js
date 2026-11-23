const express = require('express');
const fs = require('fs');
const path = require('path');
const asyncHandler = require('../utils/asyncHandler');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();
router.use(verifyToken);

// GET /api/testdata/facturas - Lee el JSON de evidencias de Python
router.get('/facturas', asyncHandler(async (req, res) => {
  // Ajusta la ruta apuntando a la carpeta de tu proyecto Python
  const jsonPath = path.resolve(__dirname, '../../../../pos_screenplay_framework/evidence/facturas_generadas.json');
  
  if (!fs.existsSync(jsonPath)) {
    return res.json([]);
  }

  const rawData = fs.readFileSync(jsonPath, 'utf-8');
  try {
    const facturas = JSON.parse(rawData);
    res.json(facturas);
  } catch (error) {
    res.status(500).json({ error: 'Error leyendo el archivo de facturas' });
  }
}));

module.exports = router;