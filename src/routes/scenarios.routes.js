const express = require('express');
const prisma = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();
router.use(verifyToken);

// GET /api/scenarios/:submoduleId
router.get('/:submoduleId', asyncHandler(async (req, res) => {
  const { submoduleId } = req.params;
  
  const scenarios = await prisma.scenario.findMany({
    where: { submoduleId: parseInt(submoduleId) },
    orderBy: { name: 'asc' }
  });
  
  res.json(scenarios);
}));

module.exports = router;