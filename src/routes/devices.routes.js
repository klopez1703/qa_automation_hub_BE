const express = require('express');
const path = require('path'); // Importación necesaria
const { exec } = require('child_process');
const http = require('http');
const SerialPort = require('serialport');

const os = require("os");
const net = require("net");
const router = express.Router();

function ipToLong(ip) {
  return ip.split(".").reduce((acc, oct) => (acc << 8) + parseInt(oct, 10), 0) >>> 0;
}

function isSameSubnet(pcIp, posIp, netmask) {
  const mask = ipToLong(netmask);
  return (ipToLong(pcIp) & mask) === (ipToLong(posIp) & mask);
}

function checkTcpPort(host, port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(timeoutMs);
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(Number(port), host);
  });
}

// POST /api/device/wifi/validate -> Valida misma subred PC <-> POS y conectividad TCP
router.post("/wifi/validate", async (req, res) => {
  const { ip, port = 5000 } = req.body;

  if (!ip || !net.isIPv4(ip.trim())) {
    return res.status(400).json({
      valid: false,
      error: "Ingrese una dirección IPv4 válida para el POS (ej. 10.211.108.3).",
    });
  }
  
  const targetIp = ip.trim();
  const interfaces = os.networkInterfaces();
  const pcSubnets = [];
  let matchedInterface = null;

  for (const [ifaceName, addrs] of Object.entries(interfaces)) {
    for (const addr of addrs || []) {
      if (addr.family === "IPv4" && !addr.internal) {
        pcSubnets.push({ ifaceName, ip: addr.address, netmask: addr.netmask });
        if (isSameSubnet(addr.address, targetIp, addr.netmask)) {
          matchedInterface = { ifaceName, ip: addr.address, netmask: addr.netmask };
        }
      }
    }
  }

  if (!matchedInterface) {
    const currentNets = pcSubnets.map((n) => `${n.ip} (${n.ifaceName})`).join(", ");
    return res.status(400).json({
      valid: false,
      error: `La IP ${targetIp} no pertenece a la misma red de esta PC. Redes activas en PC: ${currentNets || "ninguna"}.`,
    });
  }

  const isPortReachable = await checkTcpPort(targetIp, port, 2000);
  if (!isPortReachable) {
    return res.status(400).json({
      valid: false,
      error: `Misma red detectada (${matchedInterface.ip}), pero el POS no responde en ${targetIp}:${port}. Verifique que DCL/servicio esté escuchando.`,
    });
  }

  return res.json({
    valid: true,
    pcIp: matchedInterface.ip,
    interface: matchedInterface.ifaceName,
    message: `Red verificada (${matchedInterface.ip} ↔ ${targetIp}:${port})`,
  });
});

let SerialPortModule = null;
try {
  const sp = require("serialport");
  SerialPortModule = sp.SerialPort || sp;
} catch {
  SerialPortModule = null;
}

// Verificar si un puerto HTTP responde correctamente (ej. Appium en 4723)
const checkHttpServer = (url) => {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(1200, () => {
      req.destroy();
      resolve(false);
    });
  });
};

// Verificar procesos activos en Windows
const checkProcessRunning = (processName) => {
  return new Promise((resolve) => {
    exec(`tasklist /FI "IMAGENAME eq ${processName}"`, (err, stdout) => {
      if (err) return resolve(false);
      resolve(stdout.toLowerCase().includes(processName.toLowerCase()));
    });
  });
};

// Listar puertos COM (usa serialport y fallback nativo PowerShell si falla en Electron)
async function listComPorts() {
  if (SerialPortModule && typeof SerialPortModule.list === "function") {
    try {
      return await SerialPortModule.list();
    } catch {
      // Fallback a PowerShell abajo
    }
  }

  return new Promise((resolve) => {
    const psCmd =
      'powershell -NoProfile -Command "Get-CimInstance Win32_SerialPort | Select-Object @{N=\'path\';E={$_.DeviceID}}, @{N=\'friendlyName\';E={$_.Description}} | ConvertTo-Json"';
    exec(psCmd, (err, stdout) => {
      if (err || !stdout.trim()) return resolve([]);
      try {
        const parsed = JSON.parse(stdout);
        resolve(Array.isArray(parsed) ? parsed : [parsed]);
      } catch {
        resolve([]);
      }
    });
  });
}

// Listar dispositivos ADB conectados
function listAdbDevices() {
  return new Promise((resolve) => {
    exec("adb devices -l", (error, stdout) => {
      if (error || !stdout) return resolve([]);
      const devices = [];
      stdout.split("\n").forEach((line) => {
        const trimmed = line.trim();
        if (
          trimmed &&
          !trimmed.startsWith("List of devices") &&
          trimmed.includes("device")
        ) {
          const parts = trimmed.split(/\s+/);
          const id = parts[0];
          const modelPart = parts.find((p) => p.startsWith("model:"));
          const model = modelPart ? modelPart.replace("model:", "") : "POS Android";
          devices.push({
            id,
            status: "device",
            model,
            connectionType: id.includes(":") ? "TCP" : "USB",
          });
        }
      });
      resolve(devices);
    });
  });
}

// =========================================================================
// 1. ESTADO DE SERVICIOS (Appium y Gnirehtet)
// =========================================================================
router.get("/services/status", async (req, res) => {
  try {
    const [isAppiumRunning, isGnirehtetRunning] = await Promise.all([
      checkHttpServer("http://127.0.0.1:4723/status"),
      checkProcessRunning("gnirehtet.exe"),
    ]);

    res.json({
      appium: Boolean(isAppiumRunning),
      gnirehtet: Boolean(isGnirehtetRunning),
    });
  } catch (error) {
    res.status(500).json({ error: error.message, appium: false, gnirehtet: false });
  }
});

// =========================================================================
// 2. AUTODETECCIÓN DE CONEXIÓN POS (USB/ADB, SERIAL COM Y TCP)
// =========================================================================
router.get("/detect", async (req, res) => {
  try {
    const [adbDevices, comPorts, appiumRunning, gnirehtetRunning] =
      await Promise.all([
        listAdbDevices(),
        listComPorts(),
        checkHttpServer("http://127.0.0.1:4723/status"),
        checkProcessRunning("gnirehtet.exe"),
      ]);

    const usbDevice = adbDevices.find((d) => d.connectionType === "USB");
    const tcpDevice = adbDevices.find((d) => d.connectionType === "TCP");

    // Sugerencia automática según lo que el usuario conectó físicamente
    let recommendedMode = "TCP";
    if (usbDevice) {
      recommendedMode = "USB_GNIREHTET";
    } else if (comPorts.length > 0) {
      recommendedMode = "SERIAL";
    } else if (tcpDevice) {
      recommendedMode = "TCP";
    }

    res.json({
      success: true,
      recommendedMode,
      adbDevices,
      comPorts,
      services: {
        appium: appiumRunning,
        gnirehtet: gnirehtetRunning,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// =========================================================================
// 3. INICIAR / DETENER APPIUM
// =========================================================================
router.post("/appium/start", async (req, res) => {
  const alreadyRunning = await checkHttpServer("http://127.0.0.1:4723/status");
  if (alreadyRunning) {
    return res.json({
      success: true,
      message: "Appium ya se encontraba activo en el puerto 4723.",
    });
  }

  exec('start "Appium Server" cmd /k "appium --relaxed-security"', (error) => {
    if (error) {
      console.error("Error al abrir Appium:", error);
      return res.status(500).json({ error: error.message });
    }
  });

  return res.json({
    success: true,
    message: "Servidor Appium iniciado en ventana independiente",
  });
});

router.post("/appium/stop", (req, res) => {
  const cmd =
    process.platform === "win32"
      ? 'for /f "tokens=5" %a in (\'netstat -aon ^| findstr :4723\') do taskkill /F /PID %a'
      : "npx kill-port 4723 || pkill -f appium";

  exec(cmd, () => {
    return res.json({
      success: true,
      message: "Servicio Appium detenido de forma segura.",
    });
  });
});
// 2. Iniciar Gnirehtet en ventana independiente
router.post('/gnirehtet/start', (req, res) => {
  try {
    // Ruta con barras dobles invertidas fijas
    const gnirehtetPath = 'C:\\Users\\kevin\\Downloads\\gnirehtet-rust-win64-v2.5.1\\gnirehtet-rust-win64\\gnirehtet-run.cmd';
    const gnirehtetDir = path.dirname(gnirehtetPath);

    // Se abre en consola propia
    exec('start "Gnirehtet Reverse Tethering" cmd /k "gnirehtet-run.cmd"', { cwd: gnirehtetDir }, (error) => {
      if (error) {
        console.error('Error al abrir Gnirehtet:', error);
        return res.status(500).json({ error: error.message });
      }
    });

    return res.json({ success: true, message: 'Servicio Gnirehtet iniciado en ventana independiente' });
  } catch (error) {
    console.error('Error interno en /gnirehtet/start:', error);
    return res.status(500).json({ error: error.message });
  }
});

router.post("/gnirehtet/stop", (req, res) => {
  const cmd =
    process.platform === "win32"
      ? "taskkill /F /IM gnirehtet.exe /T"
      : "pkill -f gnirehtet";

  exec(cmd, () => {
    return res.json({ success: true, message: "Servicio Gnirehtet detenido" });
  });
});

// =========================================================================
// 5. PUERTOS COM, ADB DEVICES, CONNECT Y FORWARD
// =========================================================================
router.get("/com-ports", async (req, res) => {
  try {
    const ports = await listComPorts();
    res.json({ success: true, ports });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/adb/devices", async (req, res) => {
  try {
    const devices = await listAdbDevices();
    res.json({ devices });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/adb/connect", (req, res) => {
  const { ip, port = 5555 } = req.body;
  if (!ip) return res.status(400).json({ error: "Debe indicar la IP del POS." });

  exec(`adb connect ${ip}:${port}`, (error, stdout) => {
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, message: stdout.trim() });
  });
});

router.post("/adb/forward", (req, res) => {
  const { deviceId, localPort = 5000, remotePort = 5000 } = req.body;
  const cmd = deviceId
    ? `adb -s ${deviceId} forward tcp:${localPort} tcp:${remotePort}`
    : `adb forward tcp:${localPort} tcp:${remotePort}`;

  exec(cmd, (error) => {
    if (error) return res.status(500).json({ error: error.message });
    res.json({
      success: true,
      message: `Puerto TCP:${localPort} reenviado exitosamente`,
    });
  });
});

module.exports = router;