import { DatabaseSync } from "node:sqlite";

export function inTransaction(database: DatabaseSync, work: () => void): void {
    database.exec("BEGIN");
    try {
        work();
        database.exec("COMMIT");
    } catch (error) {
        database.exec("ROLLBACK");
        throw error;
    }
}
