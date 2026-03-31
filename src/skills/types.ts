/**
 * Orbit Skills System — Phase 5
 * Types for the skill registry and loader.
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
}

export interface Skill {
    metadata: SkillMetadata;
    /** Body content of the SKILL.md (without frontmatter) */
    content:  string;
}
