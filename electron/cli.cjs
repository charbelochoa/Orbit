"use strict";

const path = require("node:path");
const { homedir } = require("node:os");
const pkg = require("../package.json");

const appData = process.env.APPDATA || path.join(homedir(), "AppData", "Roaming");
process.env.ORBIT_HOME ||= path.join(appData, pkg.productName || pkg.name);
process.env.ORBIT_DESKTOP_CLI = "1";

import("../dist/cli.js").catch(error => {
  console.error("Orbit no pudo abrir la terminal:", error.message);
  process.exitCode = 1;
});
