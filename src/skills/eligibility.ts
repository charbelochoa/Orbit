/**
 * Orbit Skill Eligibility Checker — Sprint 1
 * Verifies that a skill's requirements (bins, env, platform) are met.
 */

import { execSync } from "child_process";
import type { SkillRequirements } from "./types.js";

const IS_WIN = process.platform === "win32";

/** Result of checking a skill's requirements */
export interface EligibilityResult {
    eligible: boolean;
    missing:  string[];
}

/** Cache of binary existence checks to avoid repeated spawns */
const binCache = new Map<string, boolean>();

function binaryExists(name: string): boolean {
    const cached = binCache.get(name);
    if (cached !== undefined) return cached;

    try {
        execSync(IS_WIN ? `where ${name}` : `which ${name}`, { stdio: "ignore" });
        binCache.set(name, true);
        return true;
    } catch {
        binCache.set(name, false);
        return false;
    }
}

/**
 * Check whether all requirements for a skill are satisfied.
 * Returns { eligible: true, missing: [] } when everything is met.
 */
export function checkEligibility(req: SkillRequirements | undefined): EligibilityResult {
    if (!req) return { eligible: true, missing: [] };

    const missing: string[] = [];

    // All specified binaries must exist
    if (req.bins) {
        for (const bin of req.bins) {
            if (!binaryExists(bin)) missing.push(`bin:${bin}`);
        }
    }

    // At least one of the listed binaries must exist
    if (req.anyBins && req.anyBins.length > 0) {
        const hasOne = req.anyBins.some(b => binaryExists(b));
        if (!hasOne) missing.push(`anyBins:[${req.anyBins.join("|")}]`);
    }

    // All specified env vars must be set and non-empty
    if (req.env) {
        for (const v of req.env) {
            if (!process.env[v]) missing.push(`env:${v}`);
        }
    }

    // Platform must match
    if (req.platform && req.platform.length > 0) {
        if (!req.platform.includes(process.platform as any)) {
            missing.push(`platform:${process.platform}`);
        }
    }

    return { eligible: missing.length === 0, missing };
}

/** Clear the binary existence cache (useful in tests) */
export function clearBinCache(): void {
    binCache.clear();
}
