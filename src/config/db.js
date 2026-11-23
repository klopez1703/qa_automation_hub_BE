const { PrismaClient } = require('@prisma/client');

// Una sola instancia compartida en toda la app (patrón recomendado por Prisma
// para evitar abrir demasiadas conexiones en desarrollo con nodemon).
const prisma = new PrismaClient();

module.exports = prisma;
