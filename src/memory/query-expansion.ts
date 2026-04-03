/**
 * Orbit Query Expansion — Sprint 3
 * Extracts keywords, expands queries for FTS, and optionally
 * generates semantic variants for better recall.
 */

// ── Stop words (EN + ES) ────────────────────────────────────────────────────

const STOP_WORDS = new Set([
    // English
    "a", "an", "the", "is", "it", "in", "on", "at", "to", "for", "of", "and", "or", "not",
    "i", "you", "he", "she", "we", "they", "me", "my", "your", "his", "her",
    "what", "how", "when", "where", "which", "who", "this", "that", "these", "those",
    "do", "does", "did", "will", "would", "can", "could", "should", "have", "has", "had",
    "be", "been", "was", "were", "are", "am", "being",
    "with", "from", "about", "into", "through", "just", "also", "then", "than",
    "but", "if", "so", "all", "no", "yes", "any", "some", "each", "every", "very",
    "only", "own", "same", "other", "more", "most", "such", "both", "too",
    // Spanish
    "el", "la", "los", "las", "un", "una", "unos", "unas", "de", "del", "en", "con",
    "por", "para", "que", "es", "no", "se", "su", "al", "lo", "le", "ya", "si",
    "como", "pero", "más", "este", "esta", "estos", "estas", "qué", "hay",
    "ser", "está", "fue", "son", "tiene", "puede", "ha", "han", "sobre", "entre",
    "sin", "hasta", "desde", "donde", "cuando", "muy", "todo", "todos", "toda", "todas",
    "otro", "otra", "otros", "otras", "ese", "esa", "eso", "esos", "esas",
    "aquí", "ahí", "allí", "bien", "mal", "ahora", "después", "antes", "también",
]);

export interface ExpandedQuery {
    /** Original query text */
    original: string;
    /** Extracted keywords (deduplicated, lowercased) */
    keywords: string[];
    /** FTS5-ready query string (keywords joined with OR) */
    ftsQuery: string;
    /** Keywords with prefix matching for partial words */
    ftsQueryPrefix: string;
}

/**
 * Extract meaningful keywords from a natural-language query.
 */
export function extractKeywords(query: string): string[] {
    return query
        .toLowerCase()
        .replace(/['']/g, "'")
        .split(/[^\p{L}\p{N}']+/u) // Unicode-aware word split
        .map(w => w.replace(/^'+|'+$/g, "")) // trim quotes
        .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

/**
 * Expand a query into keywords + FTS5 query strings.
 */
export function expandQuery(query: string): ExpandedQuery {
    const keywords = [...new Set(extractKeywords(query))]; // deduplicate

    return {
        original: query,
        keywords,
        ftsQuery: keywords.join(" OR "),
        ftsQueryPrefix: keywords.map(k => `"${k}"*`).join(" OR "),
    };
}

/**
 * Build a weighted FTS5 query that boosts exact phrase matches.
 * Returns a query like: ("full phrase") OR (word1 OR word2)
 */
export function buildBoostQuery(query: string): string {
    const keywords = extractKeywords(query);
    if (keywords.length === 0) return "";
    if (keywords.length === 1) return keywords[0];

    // Exact phrase gets boosted by NEAR
    const phrase = `NEAR(${keywords.join(" ")}, 5)`;
    const loose = keywords.join(" OR ");

    return `(${phrase}) OR (${loose})`;
}
