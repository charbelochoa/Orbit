/**
 * Orbit Notifications — Types (Sprint 12)
 */

export interface ToastPayload {
    /** Título de la notificación */
    title: string;
    /** Cuerpo del mensaje */
    body: string;
    /**
     * Categoría para colorear o icono (usado en Electron Notification tag).
     * "info" | "success" | "warning" | "error"
     */
    category?: "info" | "success" | "warning" | "error";
    /** ID de origen para agrupar notificaciones similares */
    sourceId?: string;
    /** Silenciar un toast concreto (útil para override config) */
    silent?: boolean;
}
