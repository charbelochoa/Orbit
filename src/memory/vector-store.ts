/**
 * Orbit Vector Memory Store — Sprint 3
 * SQLite-backed memory with FTS5 full-text search and optional vector search.
 *
 * Architecture:
 * - memory_files:  tracks indexed files (path, hash, mtime)
 * - memory_chunks: text chunks with metadata
 * - memory_embeddings: float vectors stored as JSON (pure-JS cosine similarity)
 * - memory_fts: FTS5 virtual table for keyword search (always available)
 *
 * Vector search uses cosine similarity computed in JS.
 * FTS5 is the fallback when no embedding provider is available.
 */

import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import crypto from "crypto";
import { createLogger } from "../infra/logger.js";
import { chunkText, type TextChunk } from "./chunker.js";
import { getEmbeddingProvider, type EmbeddingProvider } from "./embedding-provider.js";
import { expandQuery } from "./query-expansion.js";

const log = createLogger("memory");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "../../data/memory.db");

// ── Types ────────────────────────────────────────────────────────────────────

export interface MemorySearchResult {
    /** Source file or "chat" */
    source:    string;
    /** Matched text snippet */
    snippet:   string;
    /** Relevance score (0-1, higher = better) */
    score:     number;
    /** Chunk index within the source */
    chunkIndex?: number;
}

export interface MemoryFileEntry {
    path:     string;
    hash:     string;
    mtime:    number;
    size:     number;
    chunks:   number;
}

export interface SyncProgress {
    filesScanned: number;
    filesIndexed: number;
    chunksCreated: number;
    embeddingsGenerated: number;
}

// ── Store ────────────────────────────────────────────────────────────────────

export class VectorMemoryStore {
    private db: Database.Database;
    private embeddingProvider: EmbeddingProvider | null = null;
    private embeddingDimensions: number = 0;

    constructor(dbPath?: string) {
        const finalPath = dbPath || DB_PATH;
        fs.mkdirSync(path.dirname(finalPath), { recursive: true });
        this.db = new Database(finalPath);
        this.db.pragma("journal_mode = WAL");
        this.db.pragma("synchronous = NORMAL");
        this._initSchema();
        this.embeddingProvider = getEmbeddingProvider();
        if (this.embeddingProvider) {
            this.embeddingDimensions = this.embeddingProvider.dimensions;
        }
    }

    // ── Schema ───────────────────────────────────────────────────────────────

    private _initSchema(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS memory_files (
                path     TEXT PRIMARY KEY,
                hash     TEXT NOT NULL,
                mtime    INTEGER NOT NULL,
                size     INTEGER NOT NULL,
                chunks   INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS memory_chunks (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                file_path  TEXT NOT NULL,
                chunk_idx  INTEGER NOT NULL,
                text       TEXT NOT NULL,
                tokens     INTEGER NOT NULL,
                start_char INTEGER,
                end_char   INTEGER,
                FOREIGN KEY (file_path) REFERENCES memory_files(path) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS memory_embeddings (
                chunk_id   INTEGER PRIMARY KEY,
                vector     TEXT NOT NULL,
                FOREIGN KEY (chunk_id) REFERENCES memory_chunks(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_chunks_file ON memory_chunks(file_path);
        `);

        // FTS5 virtual table
        try {
            this.db.exec(`
                CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
                    text,
                    file_path UNINDEXED,
                    chunk_id UNINDEXED,
                    tokenize = 'unicode61'
                );
            `);
        } catch (e: any) {
            log.warn(`FTS5 init error (may already exist): ${e.message}`);
        }
    }

    // ── Indexing ─────────────────────────────────────────────────────────────

    /**
     * Index a text document into the memory store.
     * Splits into chunks, generates embeddings (if available), and populates FTS.
     */
    async index(filePath: string, content: string): Promise<number> {
        const hash = crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
        const existing = this.db.prepare("SELECT hash FROM memory_files WHERE path = ?").get(filePath) as { hash: string } | undefined;

        // Skip if unchanged
        if (existing && existing.hash === hash) {
            return 0;
        }

        // Remove old data for this file
        this._removeFile(filePath);

        const chunks = chunkText(content, { maxTokens: 512, overlap: 50 });
        if (chunks.length === 0) return 0;

        // Insert file entry
        this.db.prepare(
            "INSERT INTO memory_files (path, hash, mtime, size, chunks) VALUES (?, ?, ?, ?, ?)"
        ).run(filePath, hash, Date.now(), content.length, chunks.length);

        // Insert chunks + FTS
        const insertChunk = this.db.prepare(
            "INSERT INTO memory_chunks (file_path, chunk_idx, text, tokens, start_char, end_char) VALUES (?, ?, ?, ?, ?, ?)"
        );
        const insertFts = this.db.prepare(
            "INSERT INTO memory_fts (text, file_path, chunk_id) VALUES (?, ?, ?)"
        );

        const chunkIds: number[] = [];
        const insertAll = this.db.transaction(() => {
            for (const chunk of chunks) {
                const info = insertChunk.run(
                    filePath, chunk.index, chunk.text, chunk.tokens, chunk.startChar, chunk.endChar
                );
                const chunkId = Number(info.lastInsertRowid);
                chunkIds.push(chunkId);
                insertFts.run(chunk.text, filePath, chunkId);
            }
        });
        insertAll();

        // Generate embeddings (if provider available)
        if (this.embeddingProvider) {
            try {
                await this._generateEmbeddings(chunks, chunkIds);
            } catch (e: any) {
                log.warn(`Embeddings failed for ${filePath}: ${e.message} — FTS still available`);
            }
        }

        log.debug(`Indexed ${filePath}: ${chunks.length} chunks`);
        return chunks.length;
    }

    /**
     * Index a raw text string with a virtual source name (e.g., "chat:session_123").
     */
    async indexText(source: string, content: string): Promise<number> {
        return this.index(source, content);
    }

    /**
     * Remove a file and all its chunks/embeddings from the store.
     */
    private _removeFile(filePath: string): void {
        // Get chunk IDs to clean FTS
        const chunks = this.db.prepare(
            "SELECT id FROM memory_chunks WHERE file_path = ?"
        ).all(filePath) as { id: number }[];

        if (chunks.length > 0) {
            const ids = chunks.map(c => c.id);
            // Delete from FTS
            for (const id of ids) {
                this.db.prepare("DELETE FROM memory_fts WHERE chunk_id = ?").run(id);
            }
            // Delete embeddings
            this.db.prepare(
                `DELETE FROM memory_embeddings WHERE chunk_id IN (${ids.join(",")})`
            ).run();
        }

        this.db.prepare("DELETE FROM memory_chunks WHERE file_path = ?").run(filePath);
        this.db.prepare("DELETE FROM memory_files WHERE path = ?").run(filePath);
    }

    // ── Embeddings ───────────────────────────────────────────────────────────

    private async _generateEmbeddings(chunks: TextChunk[], chunkIds: number[]): Promise<void> {
        if (!this.embeddingProvider) return;

        const BATCH_SIZE = 20;
        const insertEmb = this.db.prepare(
            "INSERT OR REPLACE INTO memory_embeddings (chunk_id, vector) VALUES (?, ?)"
        );

        for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
            const batch = chunks.slice(i, i + BATCH_SIZE);
            const batchIds = chunkIds.slice(i, i + BATCH_SIZE);
            const texts = batch.map(c => c.text);

            const vectors = await this.embeddingProvider.embed(texts);

            const insertBatch = this.db.transaction(() => {
                for (let j = 0; j < vectors.length; j++) {
                    insertEmb.run(batchIds[j], JSON.stringify(vectors[j]));
                }
            });
            insertBatch();
        }

        log.debug(`Generated ${chunks.length} embeddings`);
    }

    // ── Search ───────────────────────────────────────────────────────────────

    /**
     * Search memory using vector similarity (if embeddings available) or FTS5.
     */
    async search(query: string, topK = 5): Promise<MemorySearchResult[]> {
        // Try vector search first
        if (this.embeddingProvider) {
            try {
                const results = await this._vectorSearch(query, topK);
                if (results.length > 0) return results;
            } catch (e: any) {
                log.debug(`Vector search failed, falling back to FTS: ${e.message}`);
            }
        }

        // Fallback: FTS5
        return this.searchFTS(query, topK);
    }

    /**
     * Full-text search using FTS5.
     */
    searchFTS(query: string, topK = 5): MemorySearchResult[] {
        const { ftsQuery } = expandQuery(query);
        if (!ftsQuery) return [];

        try {
            const rows = this.db.prepare(`
                SELECT text, file_path, chunk_id, rank
                FROM memory_fts
                WHERE memory_fts MATCH ?
                ORDER BY rank
                LIMIT ?
            `).all(ftsQuery, topK) as Array<{
                text: string;
                file_path: string;
                chunk_id: number;
                rank: number;
            }>;

            return rows.map(r => ({
                source:     r.file_path,
                snippet:    r.text.slice(0, 300),
                score:      Math.max(0, 1 - Math.abs(r.rank) / 20), // Normalize rank to 0-1
                chunkIndex: r.chunk_id,
            }));
        } catch (e: any) {
            log.debug(`FTS search error: ${e.message}`);
            return [];
        }
    }

    /**
     * Vector similarity search using cosine distance.
     */
    private async _vectorSearch(query: string, topK: number): Promise<MemorySearchResult[]> {
        if (!this.embeddingProvider) return [];

        const [queryVector] = await this.embeddingProvider.embed([query]);

        // Load all embeddings (for small stores this is fine; for >10K chunks we'd need an index)
        const rows = this.db.prepare(`
            SELECT e.chunk_id, e.vector, c.text, c.file_path, c.chunk_idx
            FROM memory_embeddings e
            JOIN memory_chunks c ON c.id = e.chunk_id
        `).all() as Array<{
            chunk_id: number;
            vector: string;
            text: string;
            file_path: string;
            chunk_idx: number;
        }>;

        if (rows.length === 0) return [];

        // Compute cosine similarity for each
        const scored = rows.map(r => {
            const vec = JSON.parse(r.vector) as number[];
            const score = cosineSimilarity(queryVector, vec);
            return { ...r, score };
        });

        // Sort by score descending, take top K
        scored.sort((a, b) => b.score - a.score);

        return scored.slice(0, topK).map(r => ({
            source:     r.file_path,
            snippet:    r.text.slice(0, 300),
            score:      r.score,
            chunkIndex: r.chunk_idx,
        }));
    }

    // ── Sync ─────────────────────────────────────────────────────────────────

    /**
     * Sync memory files from disk.
     * Scans MEMORY.md and data/memory/ directory for changed files.
     */
    async sync(memoryPaths: string[]): Promise<SyncProgress> {
        const progress: SyncProgress = {
            filesScanned: 0,
            filesIndexed: 0,
            chunksCreated: 0,
            embeddingsGenerated: 0,
        };

        for (const filePath of memoryPaths) {
            progress.filesScanned++;
            try {
                if (!fs.existsSync(filePath)) continue;
                const content = fs.readFileSync(filePath, "utf-8");
                const chunks = await this.index(filePath, content);
                if (chunks > 0) {
                    progress.filesIndexed++;
                    progress.chunksCreated += chunks;
                }
            } catch (e: any) {
                log.warn(`Sync error for ${filePath}: ${e.message}`);
            }
        }

        if (progress.filesIndexed > 0) {
            log.info(`Memory sync: ${progress.filesIndexed} file(s) indexed, ${progress.chunksCreated} chunks`);
        }

        return progress;
    }

    // ── Stats ────────────────────────────────────────────────────────────────

    stats(): {
        files: number;
        chunks: number;
        embeddings: number;
        hasVectorSearch: boolean;
    } {
        const files = (this.db.prepare("SELECT COUNT(*) as c FROM memory_files").get() as { c: number }).c;
        const chunks = (this.db.prepare("SELECT COUNT(*) as c FROM memory_chunks").get() as { c: number }).c;
        const embeddings = (this.db.prepare("SELECT COUNT(*) as c FROM memory_embeddings").get() as { c: number }).c;
        return {
            files,
            chunks,
            embeddings,
            hasVectorSearch: !!this.embeddingProvider,
        };
    }

    /**
     * Close the database connection.
     */
    close(): void {
        this.db.close();
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
    const len = Math.min(a.length, b.length);
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < len; i++) {
        dot   += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
}
