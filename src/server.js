require('dotenv').config();
const express = require('express');
const cors = require('cors');
const app = express();
const path = require('path');

const authRoutes = require('./routes/auth.routes');
const modulesRoutes = require('./routes/modules.routes');
const scenariosRoutes = require('./routes/scenarios.routes');
const testdataRoutes = require('./routes/testdata.routes');
const executionsRoutes = require('./routes/executions.routes');
const usersRoutes = require('./routes/users.routes');
const matrixRoutes = require('./routes/matrix.routes');
const deviceRoutes = require('./routes/devices.routes');
const ticketsRoutes = require("./routes/tickets.routes");
const projectsRoutes = require("./routes/projects.routes");

app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use('/api/descargas', express.static(path.resolve(__dirname, '../matricez')));

app.use('/api/auth', authRoutes);
app.use('/api/modules', modulesRoutes);
app.use('/api/scenarios', scenariosRoutes);
app.use('/api/testdata', testdataRoutes);
app.use('/api/executions', executionsRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/matrix', matrixRoutes);
app.use('/api/device', deviceRoutes);
app.use("/api/tickets", ticketsRoutes);
app.use("/api/projects", projectsRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Ocurrió un error inesperado en el servidor.' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`QA Automation Hub backend escuchando en http://localhost:${PORT}`);
});