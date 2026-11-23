// require('dotenv').config();
// const bcrypt = require('bcryptjs');
// const prisma = require('../src/config/db');

// async function main() {
//   console.log('Iniciando poblamiento de base de datos...');

//   // ==========================================
//   // 1. CREACIÓN DE PERMISOS
//   // ==========================================
//   console.log('Creando permisos...');
//   const permEjecutar = await prisma.permission.upsert({
//     where: { action: 'EJECUTAR_PRUEBAS' },
//     update: {},
//     create: { action: 'EJECUTAR_PRUEBAS' },
//   });

//   const permGestionar = await prisma.permission.upsert({
//     where: { action: 'GESTIONAR_PROYECTOS' },
//     update: {},
//     create: { action: 'GESTIONAR_PROYECTOS' },
//   });

//   // ==========================================
//   // 2. CREACIÓN DE ROLES CON PERMISOS
//   // ==========================================
//   console.log('Creando roles...');
//   const adminRole = await prisma.role.upsert({
//     where: { name: 'ADMIN' },
//     update: {},
//     create: { 
//       name: 'ADMIN',
//       permissions: { connect: [{ id: permEjecutar.id }, { id: permGestionar.id }] }
//     },
//   });

//   const qaRole = await prisma.role.upsert({
//     where: { name: 'QA_MANUAL' },
//     update: {},
//     create: { 
//       name: 'QA_MANUAL',
//       permissions: { connect: [{ id: permEjecutar.id }] } // QA solo ejecuta
//     },
//   });

//   // ==========================================
//   // 3. CREACIÓN DEL PROYECTO KINPOS
//   // ==========================================
//   console.log('Creando proyecto KinPOS...');
//   const projectKinpos = await prisma.project.upsert({
//     where: { name: 'KinPOS' },
//     update: {},
//     create: { 
//       name: 'KinPOS', 
//       description: 'Automatización de flujos transaccionales DCL y POS' 
//     },
//   });

//   // ==========================================
//   // 4. CREACIÓN DE USUARIOS (Conectados al Rol y al Proyecto)
//   // ==========================================
//   console.log('Creando usuarios Kevin y QA...');
//   const adminPasswordHash = await bcrypt.hash('Admin123!', 10);
//   const qaPasswordHash = await bcrypt.hash('Qa123!', 10);

//   // Usamos tu contexto personal para personalizar el usuario Admin
//   await prisma.user.upsert({
//     where: { email: 'kevin@example.com' },
//     update: {},
//     create: { 
//       email: 'kevin@example.com', 
//       name: 'Kevin Agustin López Hernández', 
//       password: adminPasswordHash,
//       roleId: adminRole.id,
//       projects: { connect: [{ id: projectKinpos.id }] }
//     },
//   });

//   await prisma.user.upsert({
//     where: { email: 'qa@example.com' },
//     update: {},
//     create: { 
//       email: 'qa@example.com', 
//       name: 'QA Funcional', 
//       password: qaPasswordHash,
//       roleId: qaRole.id,
//       projects: { connect: [{ id: projectKinpos.id }] }
//     },
//   });

//   // ==========================================
//   // 5. CREACIÓN DE MÓDULOS, SUBMÓDULOS Y ESCENARIOS (KinPOS)
//   // ==========================================
//   console.log('Estructurando Módulo Retail y sus Escenarios...');
  
//   // Creamos el módulo "Retail"
//   const moduleRetail = await prisma.module.upsert({
//     where: { id: 1 }, // Solo para asegurar consistencia en el seed
//     update: {},
//     create: {
//       name: 'Retail',
//       projectId: projectKinpos.id,
//       submodules: {
//         create: [
//           {
//             name: 'VENTA',
//             scenarios: {
//               create: [
//                 { name: 'Venta normal', tipoEjecucion: 'INDIVIDUAL' },
//                 { name: 'Venta simulando caída de internet antes de aprobación', tipoEjecucion: 'INDIVIDUAL' }
//               ]
//             }
//           },
//           {
//             name: 'ANULACION',
//             scenarios: {
//               create: [
//                 { name: 'Anulación Masiva', tipoEjecucion: 'MASIVO' },
//                 { name: 'Anulación Individual', tipoEjecucion: 'INDIVIDUAL' }
//               ]
//             }
//           }
//         ]
//       }
//     }
//   });

//   console.log('Estructurando Módulo Intra-Extra...');
//   const moduleIntraExtra = await prisma.module.upsert({
//     where: { id: 2 },
//     update: {},
//     create: {
//       name: 'Intra-Extra',
//       projectId: projectKinpos.id,
//       submodules: {
//         create: [
//           { name: 'Extra' },
//           { name: 'Intra' },
//         ]
//       }
//     }
//   });

//   console.log('\n✅ Seed finalizado exitosamente.');
//   console.log('  Admin (Kevin) -> kevin@example.com / Admin123!');
//   console.log('  QA Manual     -> qa@example.com / Qa123!');
// }

// main()
//   .catch((e) => { 
//     console.error('❌ Error ejecutando el seed:', e); 
//     process.exit(1); 
//   })
//   .finally(async () => {
//     await prisma.$disconnect();
//   });

require('dotenv').config();
const prisma = require('../src/config/db');

// async function main() {
//   console.log('Iniciando seed de prueba para ExecutionHistory...');

//   // Asegúrate de tener al menos un usuario y un escenario de prueba previos, o usa IDs existentes
//   // (Aquí asumiremos que existe el usuario con id: 1 y el escenario con id: 1)
  
//   const pasosSimulados = [
//     {
//       tipoPaso: "P",
//       origen: "Automatizado",
//       descripcionDeLaPrueba: "Abrir programa DCL en la ruta configurada",
//       datosParaLaPrueba: "Ruta: DCL_Demo.exe",
//       pasosParaRealizarLaPruebaFuncional: "Ejecutar ejecutable principal",
//       resultadoFuncionalEsperado: "DCL Abierto correctamente"
//     },
//     {
//       tipoPaso: "P",
//       origen: "Automatizado",
//       descripcionDeLaPrueba: "Configurar conexión DCL",
//       datosParaLaPrueba: "IP: 192.168.1.248, Puerto: 5000",
//       pasosParaRealizarLaPruebaFuncional: "Establecer parámetros de red",
//       resultadoFuncionalEsperado: "Conexión DCL establecida"
//     },
//     {
//       tipoPaso: "POS",
//       origen: "Automatizado",
//       descripcionDeLaPrueba: "Establecer parámetros de venta",
//       datosParaLaPrueba: "Monto: 1, Moneda: 0340, Impuesto: 0",
//       pasosParaRealizarLaPruebaFuncional: "Ingresar monto de cobro en terminal",
//       resultadoFuncionalEsperado: "Parámetros configurados en POS"
//     }
//   ];

//   // Usamos upsert para actualizar si ya existe el ID 122 o crearlo si no existe
//   const ejecucionPrueba = await prisma.executionHistory.upsert({
//     where: { id: 122 },
//     update: {
//       status: "EXITO",
//       logOutput: "[INFO] Prueba simulada actualizada...\n[SUCCESS] Transacción aprobada.",
//       parameters: JSON.stringify({ monto: "1", moneda: "0340" }),
//       steps: JSON.stringify(pasosSimulados),
//     },
//     create: {
//       id: 122,
//       status: "EXITO",
//       logOutput: "[INFO] Iniciando prueba simulada...\n[INFO] Conexión establecida con éxito.\n[SUCCESS] Transacción aprobada.",
//       parameters: JSON.stringify({ monto: "1", moneda: "0340" }),
//       steps: JSON.stringify(pasosSimulados),
//       userId: 1,
//       scenarioId: 1
//     }
//   });

//   console.log('Ejecución de prueba insertada/actualizada con éxito:', ejecucionPrueba.id);
// }

// main()
//   .catch((e) => {
//     console.error(e);
//     process.exit(1);
//   })
//   .finally(async () => {
//     await prisma.$disconnect();
//   });

const PERMISSIONS = [
  {
    action: "PRUEBAS_EJECUTAR",
    category: "EJECUCIÓN",
    description: "Ejecutar escenarios automatizados y lanzar pruebas en dispositivos",
  },
  {
    action: "DISPOSITIVO_GESTIONAR",
    category: "DISPOSITIVOS",
    description: "Conectar POS por ADB/WiFi/Serial, iniciar servicios y hacer port-forward",
  },
  {
    action: "EVIDENCIA_DESCARGAR",
    category: "EVIDENCIAS",
    description: "Descargar reportes y evidencias generadas tras las ejecuciones",
  },
  {
    action: "MATRIZ_VER",
    category: "MATRICES",
    description: "Acceder al gestor de matrices FBQA y visualizar casos de prueba",
  },
  {
    action: "MATRIZ_GENERAR",
    category: "MATRICES",
    description: "Importar historias desde Azure DevOps, editar pasos y generar matrices .xlsx",
  },
  {
    action: "MATRIZ_DESCARGAR",
    category: "MATRICES",
    description: "Descargar archivos de matriz .xlsx generados",
  },
  {
    action: "HISTORIAL_VER_PROPIO",
    category: "HISTORIAL",
    description: "Consultar el historial de ejecuciones propias",
  },
  {
    action: "HISTORIAL_VER_SQUAD",
    category: "HISTORIAL",
    description: "Consultar ejecuciones de todos los integrantes de su mismo Squad",
  },
  {
    action: "HISTORIAL_VER_TODO",
    category: "HISTORIAL",
    description: "Consultar la bitácora global de todos los usuarios y chapters",
  },
  {
    action: "CATALOGO_GESTIONAR",
    category: "ADMINISTRACIÓN",
    description: "Crear y administrar proyectos, módulos, submódulos y escenarios",
  },
  {
    action: "USUARIOS_GESTIONAR",
    category: "ADMINISTRACIÓN",
    description: "Administrar usuarios, roles, chapters y squads",
  },
  {
    action: "TICKETS_APROBAR",
    category: "TICKETS",
    description: "Aprobar o rechazar solicitudes de permisos y acceso a proyectos",
  },
];

const ROLES_CONFIG = [
  {
    name: "Admin",
    description: "Acceso total al sistema, configuración y aprobación de tickets",
    actions: PERMISSIONS.map((p) => p.action),
  },
  {
    name: "QA Automation",
    description: "Ejecución de pruebas automatizadas, gestión de dispositivos y matrices",
    actions: [
      "PRUEBAS_EJECUTAR",
      "DISPOSITIVO_GESTIONAR",
      "EVIDENCIA_DESCARGAR",
      "MATRIZ_VER",
      "MATRIZ_GENERAR",
      "MATRIZ_DESCARGAR",
      "HISTORIAL_VER_PROPIO",
      "HISTORIAL_VER_SQUAD",
    ],
  },
  {
    name: "QA Manual",
    description: "Consulta de matrices, evidencias e historial propio (requiere ticket para ejecutar o generar matrices)",
    actions: [
      "MATRIZ_VER",
      "EVIDENCIA_DESCARGAR",
      "HISTORIAL_VER_PROPIO",
    ],
  },
];

async function main() {
  console.log("Sembrando catálogo de permisos...");
  const permissionRecords = {};

  for (const perm of PERMISSIONS) {
    const created = await prisma.permission.upsert({
      where: { action: perm.action },
      update: {
        category: perm.category,
        description: perm.description,
      },
      create: perm,
    });
    permissionRecords[perm.action] = created;
  }

  console.log("Configurando roles base y asignando permisos...");
  for (const roleCfg of ROLES_CONFIG) {
    await prisma.role.upsert({
      where: { name: roleCfg.name },
      update: {
        description: roleCfg.description,
        permissions: {
          set: roleCfg.actions.map((act) => ({ id: permissionRecords[act].id })),
        },
      },
      create: {
        name: roleCfg.name,
        description: roleCfg.description,
        permissions: {
          connect: roleCfg.actions.map((act) => ({ id: permissionRecords[act].id })),
        },
      },
    });
  }

  console.log("Seed de permisos y roles completado correctamente.");
}

main()
  .catch((e) => {
    console.error("Error ejecutando seed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });