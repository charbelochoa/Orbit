import path from "node:path";
import { fileURLToPath } from "node:url";

export const PROJECT_ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const ORBIT_HOME = path.resolve(process.env.ORBIT_HOME || PROJECT_ROOT);
export const APP_DATA = path.join(ORBIT_HOME, "data");
export const SKILL_HOME = path.join(ORBIT_HOME, "skills");
