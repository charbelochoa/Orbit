/**
 * Orbit Skills Registry — Phase 5 → Sprint 1
 * Central registry for all loaded skills.
 * findRelevant() now only returns eligible skills by default.
 */

import type { Skill, SkillCategory } from "./types.js";

class SkillRegistryClass {
    private skills = new Map<string, Skill>();

    register(skill: Skill): void {
        this.skills.set(skill.metadata.name, skill);
    }

    get(name: string): Skill | undefined {
        return this.skills.get(name);
    }

    has(name: string): boolean {
        return this.skills.has(name);
    }

    getAll(): Skill[] {
        return Array.from(this.skills.values());
    }

    /** Return only skills whose requirements are satisfied */
    getEligible(): Skill[] {
        return this.getAll().filter(s => s.eligible);
    }

    /** Return skills that failed eligibility checks */
    getIneligible(): Skill[] {
        return this.getAll().filter(s => !s.eligible);
    }

    getByCategory(category: SkillCategory): Skill[] {
        return this.getEligible().filter(s => s.metadata.category === category);
    }

    getByTool(toolName: string): Skill[] {
        return this.getEligible().filter(s => s.metadata.tools.includes(toolName));
    }

    /**
     * Find the top N most relevant skills for a given goal.
     * Uses simple keyword scoring over name, description, and tools.
     * Only returns eligible skills (onlyEligible=true by default).
     */
    findRelevant(goal: string, limit = 3, onlyEligible = true): Skill[] {
        const lc = goal.toLowerCase();
        const pool = onlyEligible ? this.getEligible() : this.getAll();
        const scored = pool.map(s => {
            let score = 0;
            if (lc.includes(s.metadata.name.replace(/-/g, " "))) score += 10;
            const descWords = s.metadata.description.toLowerCase().split(/\W+/);
            for (const w of descWords) {
                if (w.length > 3 && lc.includes(w)) score += 1;
            }
            for (const t of s.metadata.tools) {
                if (lc.includes(t.replace(/_/g, " "))) score += 2;
            }
            return { skill: s, score };
        });
        return scored
            .filter(x => x.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, limit)
            .map(x => x.skill);
    }

    get count(): number { return this.skills.size; }
    get eligibleCount(): number { return this.getEligible().length; }
}

export const skillRegistry = new SkillRegistryClass();
