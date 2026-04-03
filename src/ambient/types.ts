/**
 * Orbit Ambient Awareness — Sprint 9
 * Tipos compartidos para el motor de percepción ambiental.
 */

export type ClipboardContentType = "url" | "code" | "error" | "text";

export interface WindowSnapshot {
    /** Nombre del proceso (ej: "chrome", "Code", "discord") */
    app:   string;
    /** Título de la ventana */
    title: string;
    /** Timestamp Unix ms */
    ts:    number;
}

export interface ClipboardEntry {
    /** Texto del portapapeles (puede estar truncado a maxLength) */
    text: string;
    /** Tipo inferido del contenido */
    type: ClipboardContentType;
    /** Timestamp Unix ms */
    ts:   number;
}

export interface DownloadEvent {
    /** Nombre del archivo (sólo basename) */
    file: string;
    /** Extensión sin punto, minúsculas */
    ext:  string;
    /** Timestamp Unix ms */
    ts:   number;
}

export interface AmbientSnapshot {
    /** Ventana/app activa ahora */
    activeWindow:    WindowSnapshot | null;
    /** Ventana anterior (para rastrear cambios de contexto) */
    previousWindow:  WindowSnapshot | null;
    /** Historial de últimas N ventanas */
    windowHistory:   WindowSnapshot[];
    /** Último contenido de portapapeles */
    recentClipboard: ClipboardEntry | null;
    /** Archivos nuevos detectados en Downloads (últimos 5) */
    recentDownloads: DownloadEvent[];
    /** Timestamp de la última actualización */
    lastUpdated:     number;
}
