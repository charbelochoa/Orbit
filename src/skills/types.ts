/**
 * Orbit Skills System — Phase 5 → Sprint 1
 * Types for the skill registry and loader.
 * Added: requirements, eligibility, install guides.
 */

export type SkillCategory =
    | "research"
    | "coding"
    | "files"
    | "windows"
    | "browser"
    | "comms"
    | "agent"
    | "general";

/** Skill prerequisites — checked at load time */
export interface SkillRequirements {
    /** All of these binaries must be in PATH */
    bins?: string[];
    /** At least ONE of these binaries must be in PATH */
    anyBins?: string[];
    /** All of these env vars must be set (non-empty) */
    env?: string[];
    /** OS must be one of these */
    platform?: ("win32" | "darwin" | "linux")[];
}

/** How-to-install guide per platform */
export interface SkillInstallGuide {
    label: string;   // "Windows", "macOS", "Linux"
    command: string;  // e.g. "winget install GitHub.cli"
}

export interface SkillMetadata {
    /** Unique identifier (directory name) */
    name:        string;
    /** One-liner: "Cuándo usar: ..." */
    description: string;
    /** Emoji for UI */
    emoji:       string;
    category:    SkillCategory;
    /** Tool IDs this skill uses */
    tools:       string[];
    /** Absolute path to the SKILL.md file */
    path:        string;
    /** Prerequisites to use this skill */
    requires?:   SkillRequirements;
    /** Platform-specific install instructions */
    install?:    SkillInstallGuide[];
    /** Primary env var needed (for quick checks) */
    primaryEnv?: string;
}

export interface Skill {
    metadata: SkillMetadata;
    /** Body content of the SKILL.md (without frontmatter) */
    content:  string;
    /** Whether this skill's requirements are satisfied on this machine */
    eligible: boolean;
    /** List of missing requirements (empty when eligible) */
    missingRequirements: string[];
}
