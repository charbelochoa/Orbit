"""
Orbit Vision Engine — Python sidecar for orbit_master_v1.pt
Exposes a local HTTP server on port 18790 for YOLO-based screen detection.

Endpoints:
  GET  /status          → engine health + model info
  POST /detect          → capture screen + run YOLO, return detections JSON
  POST /click           → detect element by label + smart click (Bézier)
  POST /type            → detect campo_texto + click + type with human rhythm

Works in tandem with vision-control.ts in the TypeScript Orbit app.
"""

from __future__ import annotations
import sys
import os
import json
import time
import math
import random
import threading
import traceback
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from typing import Any

# ─── Path Setup ───────────────────────────────────────────────────────────────
_SCRIPT_DIR = Path(__file__).resolve().parent
_ROOT_DIR   = _SCRIPT_DIR.parent

# Try to locate the YOLO model at multiple locations
_MODEL_CANDIDATES = [
    _SCRIPT_DIR / "models" / "orbit_master_v1.pt",
    _ROOT_DIR / "models" / "orbit_master_v1.pt",
    _ROOT_DIR / "orbit_master_v1.pt",
]
DEFAULT_MODEL_PATH = next((p for p in _MODEL_CANDIDATES if p.exists()), _MODEL_CANDIDATES[0])

# ─── Constants ─────────────────────────────────────────────────────────────────
PORT            = 18790
MODEL_IMGSZ     = 1080
DEFAULT_CONF    = 0.45

CLASS_IDS = {"botones": 0, "campo_texto": 1, "icono": 2}
CLASS_ALIASES = {
    "boton":      "botones",
    "button":     "botones",
    "btn":        "botones",
    "input":      "campo_texto",
    "texto":      "campo_texto",
    "field":      "campo_texto",
    "textbox":    "campo_texto",
    "icon":       "icono",
    "icono":      "icono",
}

# ─── DPI Awareness (MUST run in main thread on Windows) ──────────────────────
def _set_dpi_awareness():
    try:
        import ctypes
        try:
            ctypes.windll.shcore.SetProcessDpiAwareness(2)
        except Exception:
            ctypes.windll.user32.SetProcessDPIAware()
        print("[OrbitEngine] DPI awareness configurada.")
    except Exception as e:
        print(f"[OrbitEngine] DPI warning: {e}")

# ─── YOLO Model (loaded once in main thread) ──────────────────────────────────
_model = None
_model_lock = threading.Lock()
_model_loaded = False
_model_error: str | None = None

def load_model_main_thread():
    """Call this from the MAIN THREAD to init YOLO safely on Windows."""
    global _model, _model_loaded, _model_error

    abs_path = DEFAULT_MODEL_PATH.resolve()
    print(f"[OrbitEngine] Ruta del modelo: {abs_path}")
    print(f"[OrbitEngine] Existe: {abs_path.exists()}")

    if not abs_path.exists():
        _model_error = f"Modelo no encontrado: {abs_path}. Copia orbit_master_v1.pt en engine/models/"
        print(f"[OrbitEngine] ⚠️  {_model_error}")
        _model_loaded = True   # "loaded" (with error) so server can report status
        return

    try:
        from ultralytics import YOLO
        import numpy as np
        print("[OrbitEngine] Cargando YOLO...")
        _model = YOLO(str(abs_path))

        # Warmup inference
        dummy = np.zeros((MODEL_IMGSZ, MODEL_IMGSZ, 3), dtype=np.uint8)
        _model.predict(source=dummy, conf=0.1, imgsz=MODEL_IMGSZ, verbose=False)
        print("[OrbitEngine] ✅ YOLO cargado y warm-up completo.")

    except ImportError:
        _model_error = "ultralytics no instalado. Ejecuta: pip install ultralytics"
        print(f"[OrbitEngine] ❌ {_model_error}")
    except Exception as e:
        _model_error = f"{type(e).__name__}: {e}"
        print(f"[OrbitEngine] ❌ Error cargando modelo:")
        traceback.print_exc()
    finally:
        _model_loaded = True

# ─── Screen Capture ───────────────────────────────────────────────────────────
def capture_screen():
    """Capture full screen as numpy array (BGR)."""
    import numpy as np
    try:
        import mss
        with mss.mss() as sct:
            monitor = sct.monitors[1]
            sct_img = sct.grab(monitor)
            import cv2
            frame = np.array(sct_img)
            return cv2.cvtColor(frame, cv2.COLOR_BGRA2BGR), monitor["width"], monitor["height"]
    except ImportError:
        pass

    # Fallback: PIL
    from PIL import ImageGrab
    import cv2
    img = ImageGrab.grab()
    frame = np.array(img)
    h, w = frame.shape[:2]
    return cv2.cvtColor(frame, cv2.COLOR_RGB2BGR), w, h

# ─── YOLO Detection ───────────────────────────────────────────────────────────
def run_detection(conf: float = DEFAULT_CONF) -> dict[str, Any]:
    """Capture screen and run YOLO. Returns detections dict."""
    if _model is None:
        return {"error": _model_error or "Modelo no cargado.", "detections": []}

    try:
        import numpy as np
        frame, screen_w, screen_h = capture_screen()
        img_h, img_w = frame.shape[:2]

        results = _model.predict(
            source=frame,
            conf=conf,
            imgsz=MODEL_IMGSZ,
            verbose=False
        )

        detections: list[dict] = []
        for r in results:
            if r.boxes is None:
                continue
            for box in r.boxes:
                cls_id  = int(box.cls[0].item())
                conf_v  = float(box.conf[0].item())
                x1, y1, x2, y2 = [float(v) for v in box.xyxy[0].tolist()]

                # Scale from YOLO image coords → screen coords
                scale_x = screen_w / img_w
                scale_y = screen_h / img_h
                sx1 = int(x1 * scale_x)
                sy1 = int(y1 * scale_y)
                sx2 = int(x2 * scale_x)
                sy2 = int(y2 * scale_y)
                cx  = (sx1 + sx2) // 2
                cy  = (sy1 + sy2) // 2

                label = next((k for k, v in CLASS_IDS.items() if v == cls_id), f"class_{cls_id}")
                detections.append({
                    "label":      label,
                    "class_id":   cls_id,
                    "confidence": round(conf_v, 3),
                    "bbox_img":   [round(x1), round(y1), round(x2), round(y2)],
                    "bbox_screen":[sx1, sy1, sx2, sy2],
                    "center":     [cx, cy],
                })

        detections.sort(key=lambda d: d["confidence"], reverse=True)
        return {
            "screen_size": [screen_w, screen_h],
            "img_size":    [img_w, img_h],
            "total":       len(detections),
            "detections":  detections
        }

    except Exception as e:
        traceback.print_exc()
        return {"error": f"{type(e).__name__}: {e}", "detections": []}

# ─── Mouse Control (Bézier) ───────────────────────────────────────────────────
def _gaussian_jitter(px: int = 2) -> int:
    import random, math
    u, v = 0.0, 0.0
    while u == 0: u = random.random()
    while v == 0: v = random.random()
    return int(math.sqrt(-2.0 * math.log(u)) * math.cos(2.0 * math.pi * v) * px)

def _bezier_points(x0, y0, x1, y1, steps=40):
    dx, dy = x1 - x0, y1 - y0
    mid_x = (x0 + x1) / 2 + (-dy * 0.28 + _gaussian_jitter(8))
    mid_y = (y0 + y1) / 2 + ( dx * 0.28 + _gaussian_jitter(8))
    pts = []
    for i in range(steps + 1):
        t_raw = i / steps
        t = t_raw * t_raw * (3 - 2 * t_raw)  # smoothstep
        px = int((1-t)**2 * x0 + 2*(1-t)*t * mid_x + t**2 * x1)
        py = int((1-t)**2 * y0 + 2*(1-t)*t * mid_y + t**2 * y1)
        pts.append((px, py))
    return pts

def human_move(tx: int, ty: int):
    """Move mouse with Bézier curve to (tx, ty)."""
    import pyautogui
    cx, cy = pyautogui.position()
    dist = math.hypot(tx - cx, ty - cy)
    steps = max(20, min(60, int(dist / 12)))
    pts = _bezier_points(cx, cy, tx + _gaussian_jitter(2), ty + _gaussian_jitter(2), steps)
    delay = max(0.004, 0.4 / steps)
    for px, py in pts:
        pyautogui.moveTo(px, py, duration=0)
        time.sleep(delay)

def smart_click(tx: int, ty: int, max_retries: int = 3) -> bool:
    """Move Bézier to (tx, ty) and click. Retries on fail."""
    import pyautogui
    pyautogui.FAILSAFE = True
    for attempt in range(max_retries):
        try:
            human_move(tx, ty)
            time.sleep(random.uniform(0.05, 0.12))
            pyautogui.click()
            return True
        except Exception as e:
            print(f"[SmartClick] Intento {attempt+1} fallido: {e}")
            time.sleep(0.3)
    return False

def human_type(text: str):
    """Type text with random human-rhythm delays."""
    import pyautogui
    for ch in text:
        pyautogui.typewrite(ch, interval=0)
        time.sleep(random.uniform(0.03, 0.12))

# ─── HTTP Request Handler ─────────────────────────────────────────────────────
class OrbitHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # Suppress access logs

    def _send_json(self, code: int, data: Any):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self) -> dict:
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw)
        except Exception:
            return {}

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        if self.path == "/status":
            self._send_json(200, {
                "status": "online",
                "model_loaded": _model_loaded,
                "model_path": str(DEFAULT_MODEL_PATH),
                "model_exists": DEFAULT_MODEL_PATH.exists(),
                "model_error": _model_error,
                "classes": list(CLASS_IDS.keys()),
                "port": PORT,
            })
        else:
            self._send_json(404, {"error": "Not found"})

    def do_POST(self):
        body = self._read_body()

        # ── POST /detect ──────────────────────────────────────────────────
        if self.path == "/detect":
            conf = float(body.get("conf", DEFAULT_CONF))
            label_filter = body.get("label", None)
            if label_filter:
                label_filter = CLASS_ALIASES.get(label_filter.lower(), label_filter.lower())

            result = run_detection(conf)

            if label_filter and "detections" in result:
                result["detections"] = [
                    d for d in result["detections"] if d["label"] == label_filter
                ]
                result["total"] = len(result["detections"])

            self._send_json(200, result)

        # ── POST /click ───────────────────────────────────────────────────
        elif self.path == "/click":
            label  = body.get("label", "botones")
            label  = CLASS_ALIASES.get(label.lower(), label.lower())
            inst   = int(body.get("instance", 0))
            conf   = float(body.get("conf", DEFAULT_CONF))

            det_result = run_detection(conf)
            if "error" in det_result:
                self._send_json(500, det_result)
                return

            matches = [d for d in det_result["detections"] if d["label"] == label]
            if not matches:
                self._send_json(404, {
                    "error": f"No se encontró '{label}' en pantalla.",
                    "all_labels": list({d["label"] for d in det_result["detections"]})
                })
                return

            if inst >= len(matches):
                inst = 0
            target = matches[inst]
            cx, cy = target["center"]

            ok = smart_click(cx, cy)
            self._send_json(200, {
                "clicked": ok,
                "label": label,
                "instance": inst,
                "center": [cx, cy],
                "confidence": target["confidence"]
            })

        # ── POST /type ────────────────────────────────────────────────────
        elif self.path == "/type":
            text  = body.get("text", "")
            label = body.get("element_label", "campo_texto")
            label = CLASS_ALIASES.get(label.lower(), label.lower())
            conf  = float(body.get("conf", DEFAULT_CONF))

            if not text:
                self._send_json(400, {"error": "Falta el campo 'text'."})
                return

            det_result = run_detection(conf)
            if "error" in det_result:
                self._send_json(500, det_result)
                return

            matches = [d for d in det_result["detections"] if d["label"] == label]
            if matches:
                cx, cy = matches[0]["center"]
                smart_click(cx, cy)
                time.sleep(0.2)

            human_type(text)
            self._send_json(200, {"typed": text, "element_found": len(matches) > 0})

        else:
            self._send_json(404, {"error": f"Ruta no encontrada: {self.path}"})


# ─── Main ─────────────────────────────────────────────────────────────────────
def main():
    print("[OrbitEngine] 🛸 Iniciando Orbit Python Vision Engine...")

    # CRITICAL: set DPI + load YOLO in MAIN thread (Windows PyTorch requirement)
    _set_dpi_awareness()
    load_model_main_thread()

    print(f"[OrbitEngine] 🌐 Servidor HTTP en http://localhost:{PORT}")

    server = HTTPServer(("localhost", PORT), OrbitHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[OrbitEngine] 👋 Cerrando...")
        server.shutdown()


if __name__ == "__main__":
    main()
