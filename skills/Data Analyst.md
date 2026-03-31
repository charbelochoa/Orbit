---
Name: Analista de datos
description: >
  Usa esta skill cada vez que el usuario suba uno o más archivos de cualquier formato
  (PDF, XLSX, XLS, CSV, DOCX, DOC, TXT, MD, PNG, JPG, JPEG, WEBP, JSON, PPTX)
  y pida: analizar datos, generar un reporte, obtener insights, visualizar información,
  identificar tendencias, tomar decisiones basadas en datos, o cualquier tarea que
  implique interpretar y transformar datos en conocimiento accionable.
  También actívala cuando el usuario mencione: "analiza esto", "dame un reporte",
  "qué me dicen estos datos", "encuentra patrones", "genera gráficas", "dame
  recomendaciones basadas en los datos", "haz un análisis ejecutivo" o frases similares.
  La skill detecta automáticamente el idioma del usuario (español o inglés) y emite
  TODA la salida — incluyendo el PDF final — en ese idioma. Instala todas las
  dependencias necesarias sin intervención del usuario y entrega un PDF ejecutivo
  profesional con gráficas, insights y recomendaciones accionables.
  SIEMPRE usa esta skill cuando haya archivos de datos + solicitud de análisis,
  incluso si la solicitud es breve o informal.
compatibility:
  tools: [bash_tool, create_file, present_files, view]
  python: ">=3.9"
  auto_installs: true   # La skill instala todo lo que necesita sola
---

# Analista de Datos — Skill Completa

## Rol

Eres un **Analista de Datos Senior** con experiencia en inteligencia de negocios,
estadística aplicada y comunicación ejecutiva. Tu trabajo es transformar archivos
crudos de cualquier formato en un reporte PDF profesional con análisis profundo,
gráficas de calidad publicación, insights accionables y recomendaciones estratégicas.

Operas en dos idiomas: **Español** e **Inglés**. Detectas el idioma del usuario
automáticamente y produces TODO el output (incluyendo el PDF) en ese idioma.

---

## FASE 0 — Instalación Silenciosa de Dependencias

**Ejecuta esto primero, siempre, sin preguntar al usuario.** Captura errores pero
no interrumpas el flujo si algo ya está instalado.

```bash
pip install \
  pypdf pdfplumber \
  python-docx \
  openpyxl xlrd odfpy \
  pandas numpy \
  matplotlib seaborn \
  Pillow pytesseract \
  reportlab \
  langdetect \
  --break-system-packages -q 2>&1 | tail -5

# Tesseract OCR para imágenes con texto
apt-get install -y tesseract-ocr tesseract-ocr-spa tesseract-ocr-eng \
  pandoc poppler-utils 2>/dev/null | tail -3 || true

# Verificación rápida
python3 -c "
import pandas, matplotlib, reportlab, langdetect
print('[OK] Dependencias listas')
" 2>&1
```

---

## FASE 1 — Detección de Idioma

```python
from langdetect import detect

def detectar_idioma(texto_usuario: str) -> str:
    """Devuelve 'es' o 'en'. Default: 'es' si falla."""
    try:
        lang = detect(texto_usuario)
        return lang if lang in ("es", "en") else "es"
    except Exception:
        return "es"

# Llama con el mensaje original del usuario
IDIOMA = detectar_idioma(mensaje_usuario)

# Diccionario de etiquetas bilingüe
T = {
    "es": {
        "titulo_reporte":     "REPORTE DE ANÁLISIS DE DATOS",
        "descripcion":        "Descripción Ejecutiva",
        "inventario":         "Inventario de Archivos Analizados",
        "calidad":            "Calidad de los Datos",
        "analisis":           "Análisis Detallado",
        "insights":           "Insights Identificados",
        "recomendaciones":    "Recomendaciones Estratégicas",
        "puntos_ciegos":      "Datos No Procesables",
        "generado":           "Generado el",
        "archivos":           "archivos analizados",
        "advertencia":        "⚠ ADVERTENCIA",
        "sin_datos":          "Sin datos suficientes para esta sección.",
        "sesgo":              "Posible sesgo detectado",
        "corrupto":           "Dato corrupto o ilegible",
        "incoherente":        "Valor incoherente detectado",
    },
    "en": {
        "titulo_reporte":     "DATA ANALYSIS REPORT",
        "descripcion":        "Executive Summary",
        "inventario":         "Analyzed Files Inventory",
        "calidad":            "Data Quality",
        "analisis":           "Detailed Analysis",
        "insights":           "Identified Insights",
        "recomendaciones":    "Strategic Recommendations",
        "puntos_ciegos":      "Non-Processable Data",
        "generado":           "Generated on",
        "archivos":           "files analyzed",
        "advertencia":        "⚠ WARNING",
        "sin_datos":          "Insufficient data for this section.",
        "sesgo":              "Possible bias detected",
        "corrupto":           "Corrupt or unreadable value",
        "incoherente":        "Incoherent value detected",
    }
}[IDIOMA]
```

---

## FASE 2 — Escaneo e Inventario de Archivos

```python
import os, glob

UPLOADS = "/mnt/user-data/uploads/"

def inventariar_archivos():
    archivos = []
    for f in os.listdir(UPLOADS):
        ruta = os.path.join(UPLOADS, f)
        ext  = os.path.splitext(f)[1].lower()
        tam  = os.path.getsize(ruta)
        archivos.append({"nombre": f, "ruta": ruta, "ext": ext, "bytes": tam})
    return archivos

archivos = inventariar_archivos()
print(f"[INVENTARIO] {len(archivos)} archivo(s) detectado(s):")
for a in archivos:
    print(f"  {a['nombre']} ({a['ext']}) — {a['bytes']:,} bytes")
```

---

## FASE 3 — Extracción Multi-formato

Usa el router de extensión. **Nunca lances cat sobre binarios.**

```python
import pandas as pd
from pypdf import PdfReader
import pdfplumber
from docx import Document
import openpyxl
from PIL import Image
import pytesseract
import json, csv

def extraer_contenido(archivo: dict) -> dict:
    """
    Retorna: {
        "texto": str,
        "dataframes": [pd.DataFrame, ...],   # tablas detectadas
        "tipo": str,                          # "tabular" | "textual" | "imagen"
        "error": str | None
    }
    """
    resultado = {"texto": "", "dataframes": [], "tipo": "textual", "error": None}
    ruta, ext = archivo["ruta"], archivo["ext"]

    try:
        # ── PDF ─────────────────────────────────────────────────────
        if ext == ".pdf":
            resultado["tipo"] = "tabular+textual"
            with pdfplumber.open(ruta) as pdf:
                textos = []
                for pag in pdf.pages:
                    t = pag.extract_text()
                    if t:
                        textos.append(t)
                    for tabla in pag.extract_tables():
                        if tabla and len(tabla) > 1:
                            try:
                                df = pd.DataFrame(tabla[1:], columns=tabla[0])
                                resultado["dataframes"].append(df)
                            except Exception:
                                pass
                resultado["texto"] = "\n".join(textos)

        # ── DOCX / DOC ──────────────────────────────────────────────
        elif ext in (".docx", ".doc"):
            if ext == ".doc":
                # Convertir con pandoc
                import subprocess, tempfile
                tmp = tempfile.mktemp(suffix=".docx")
                subprocess.run(["pandoc", ruta, "-o", tmp], check=True, timeout=30)
                ruta = tmp
            doc = Document(ruta)
            resultado["texto"] = "\n".join(p.text for p in doc.paragraphs if p.text.strip())
            for tabla in doc.tables:
                rows = [[c.text for c in row.cells] for row in tabla.rows]
                if len(rows) > 1:
                    try:
                        df = pd.DataFrame(rows[1:], columns=rows[0])
                        resultado["dataframes"].append(df)
                        resultado["tipo"] = "tabular+textual"
                    except Exception:
                        pass

        # ── XLSX / XLS / ODS ────────────────────────────────────────
        elif ext in (".xlsx", ".xlsm"):
            resultado["tipo"] = "tabular"
            wb = openpyxl.load_workbook(ruta, data_only=True)
            for sheet in wb.sheetnames:
                ws = wb[sheet]
                data = list(ws.iter_rows(values_only=True))
                if len(data) > 1:
                    headers = [str(c) if c is not None else f"Col{i}"
                               for i, c in enumerate(data[0])]
                    df = pd.DataFrame(data[1:], columns=headers)
                    df.name = sheet
                    resultado["dataframes"].append(df)

        elif ext == ".xls":
            resultado["tipo"] = "tabular"
            dfs = pd.read_excel(ruta, engine="xlrd", sheet_name=None)
            resultado["dataframes"] = list(dfs.values())

        elif ext == ".ods":
            resultado["tipo"] = "tabular"
            dfs = pd.read_excel(ruta, engine="odf", sheet_name=None)
            resultado["dataframes"] = list(dfs.values())

        # ── CSV / TSV ────────────────────────────────────────────────
        elif ext in (".csv", ".tsv"):
            resultado["tipo"] = "tabular"
            sep = "\t" if ext == ".tsv" else ","
            df = pd.read_csv(ruta, sep=sep, encoding="utf-8", errors="replace")
            resultado["dataframes"].append(df)

        # ── JSON ─────────────────────────────────────────────────────
        elif ext == ".json":
            with open(ruta, encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, list):
                df = pd.DataFrame(data)
                resultado["dataframes"].append(df)
                resultado["tipo"] = "tabular"
            else:
                resultado["texto"] = json.dumps(data, ensure_ascii=False, indent=2)

        # ── TXT / MD ─────────────────────────────────────────────────
        elif ext in (".txt", ".md", ".log"):
            with open(ruta, encoding="utf-8", errors="replace") as f:
                resultado["texto"] = f.read()

        # ── IMÁGENES (JPG / PNG / WEBP) ──────────────────────────────
        elif ext in (".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tiff"):
            resultado["tipo"] = "imagen"
            img = Image.open(ruta)
            lang_ocr = "spa+eng" if IDIOMA == "es" else "eng+spa"
            texto_ocr = pytesseract.image_to_string(img, lang=lang_ocr)
            resultado["texto"] = texto_ocr.strip() or "[SIN_TEXTO_DETECTABLE_EN_IMAGEN]"

        else:
            resultado["error"] = f"Formato '{ext}' no soportado."

    except Exception as e:
        resultado["error"] = str(e)

    return resultado
```

---

## FASE 4 — Control de Calidad de Datos

Aplica estas validaciones a **todos los DataFrames** extraídos antes de analizar.

```python
import numpy as np

def auditar_calidad(df: pd.DataFrame, nombre: str) -> dict:
    """
    Retorna un reporte de calidad con alertas de sesgo, corrupción e incoherencias.
    """
    reporte = {
        "nombre": nombre,
        "filas": len(df),
        "columnas": len(df.columns),
        "alertas": [],
        "df_limpio": None
    }

    df = df.copy()

    # 1. Detección de columnas con nombres vacíos o duplicados
    cols_vacias = [c for c in df.columns if str(c).strip() in ("", "None", "nan")]
    if cols_vacias:
        reporte["alertas"].append(
            f"{T['corrupto']}: {len(cols_vacias)} columna(s) sin nombre válido."
        )
        df.columns = [f"Col_{i}" if str(c).strip() in ("","None","nan")
                      else c for i, c in enumerate(df.columns)]

    # 2. Nulos excesivos (>40% en una columna = alerta)
    for col in df.columns:
        pct_nulo = df[col].isna().mean()
        if pct_nulo > 0.4:
            reporte["alertas"].append(
                f"{T['corrupto']}: Columna '{col}' tiene {pct_nulo:.0%} valores nulos."
            )

    # 3. Detección de outliers extremos (IQR ×3) en columnas numéricas
    numericas = df.select_dtypes(include=[np.number]).columns
    for col in numericas:
        q1, q3 = df[col].quantile(0.25), df[col].quantile(0.75)
        iqr = q3 - q1
        extremos = ((df[col] < q1 - 3*iqr) | (df[col] > q3 + 3*iqr)).sum()
        if extremos > 0:
            reporte["alertas"].append(
                f"{T['incoherente']}: Columna '{col}' tiene {extremos} "
                f"valor(es) extremo(s) (±3×IQR)."
            )

    # 4. Sesgo de distribución severo (skewness > 2)
    for col in numericas:
        sk = df[col].dropna().skew()
        if abs(sk) > 2:
            reporte["alertas"].append(
                f"{T['sesgo']}: Columna '{col}' tiene asimetría severa "
                f"(skewness={sk:.2f})."
            )

    # 5. Filas duplicadas
    n_dup = df.duplicated().sum()
    if n_dup > 0:
        reporte["alertas"].append(
            f"{T['corrupto']}: {n_dup} fila(s) duplicada(s) detectada(s)."
        )
        df = df.drop_duplicates()

    # 6. Limpiar y convertir tipos obvios
    for col in df.columns:
        df[col] = pd.to_numeric(df[col], errors="ignore")

    reporte["df_limpio"] = df
    return reporte
```

---

## FASE 5 — Análisis Estadístico

```python
def analizar_dataframe(df: pd.DataFrame) -> dict:
    """Estadísticas descriptivas + correlaciones + tendencias."""
    numericas = df.select_dtypes(include=[np.number])
    categoricas = df.select_dtypes(include=["object", "category"])

    resultado = {
        "estadisticas": numericas.describe().to_dict() if not numericas.empty else {},
        "correlaciones": numericas.corr().to_dict() if numericas.shape[1] > 1 else {},
        "top_categorias": {},
        "tendencias": []
    }

    # Top valores en columnas categóricas
    for col in categoricas.columns:
        top = df[col].value_counts().head(5).to_dict()
        resultado["top_categorias"][col] = top

    # Detección de tendencias simples en numéricas
    for col in numericas.columns:
        serie = df[col].dropna().reset_index(drop=True)
        if len(serie) >= 4:
            first_half = serie[:len(serie)//2].mean()
            second_half = serie[len(serie)//2:].mean()
            if first_half != 0:
                cambio = (second_half - first_half) / abs(first_half) * 100
                if abs(cambio) > 10:
                    direccion = "↑ creciente" if cambio > 0 else "↓ decreciente"
                    resultado["tendencias"].append(
                        f"'{col}': {direccion} ({cambio:+.1f}%)"
                    )

    return resultado
```

---

## FASE 6 — Generación de Gráficas

Produce gráficas como imágenes PNG en `/tmp/` para incrustarlas en el PDF.

```python
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
import seaborn as sns

# Paleta ejecutiva
PALETTE   = ["#1A3557", "#2E86AB", "#4CAF82", "#F4A261", "#E63946",
             "#6A4C93", "#457B9D", "#A8DADC", "#FFB703", "#FB8500"]
BG_COLOR  = "#FFFFFF"
GRID_COLOR = "#E8EDF2"

plt.rcParams.update({
    "figure.facecolor": BG_COLOR,
    "axes.facecolor":   BG_COLOR,
    "axes.grid":        True,
    "grid.color":       GRID_COLOR,
    "grid.linewidth":   0.8,
    "font.family":      "DejaVu Sans",
    "font.size":        10,
    "axes.titlesize":   12,
    "axes.titleweight": "bold",
    "axes.spines.top":  False,
    "axes.spines.right":False,
})

graficas_generadas = []  # Lista de rutas PNG

def guardar_grafica(fig, nombre: str) -> str:
    ruta = f"/tmp/grafica_{nombre}.png"
    fig.savefig(ruta, dpi=150, bbox_inches="tight",
                facecolor=BG_COLOR, edgecolor="none")
    plt.close(fig)
    graficas_generadas.append(ruta)
    return ruta

def elegir_y_generar_graficas(df: pd.DataFrame, nombre_fuente: str):
    """
    Elige automáticamente el tipo de gráfica más adecuado para cada columna.
    Genera hasta 6 gráficas por DataFrame para no saturar el reporte.
    """
    numericas   = df.select_dtypes(include=[np.number]).columns.tolist()
    categoricas = df.select_dtypes(include=["object","category"]).columns.tolist()
    slug = nombre_fuente.replace(" ", "_")[:20]

    # ── 1. Barras: top categorías ─────────────────────────────────
    for i, col in enumerate(categoricas[:2]):
        conteo = df[col].value_counts().head(10)
        if len(conteo) < 2:
            continue
        fig, ax = plt.subplots(figsize=(8, 4))
        conteo.plot(kind="bar", ax=ax, color=PALETTE[:len(conteo)], edgecolor="white")
        ax.set_title(f"{col} — Top {len(conteo)}")
        ax.set_xlabel(col); ax.set_ylabel("Frecuencia")
        ax.tick_params(axis="x", rotation=35)
        guardar_grafica(fig, f"{slug}_barras_{i}")

    # ── 2. Circular (pie): solo si hay ≤8 categorías ─────────────
    for i, col in enumerate(categoricas[:1]):
        conteo = df[col].value_counts()
        if 2 <= len(conteo) <= 8:
            fig, ax = plt.subplots(figsize=(6, 6))
            conteo.plot(kind="pie", ax=ax, colors=PALETTE[:len(conteo)],
                        autopct="%1.1f%%", startangle=140,
                        wedgeprops={"edgecolor": "white", "linewidth": 1.5})
            ax.set_title(col); ax.set_ylabel("")
            guardar_grafica(fig, f"{slug}_pie_{i}")

    # ── 3. Líneas: tendencia de numéricas con ≥10 filas ──────────
    for i, col in enumerate(numericas[:2]):
        serie = df[col].dropna()
        if len(serie) < 10:
            continue
        fig, ax = plt.subplots(figsize=(8, 4))
        ax.plot(serie.values, color=PALETTE[0], linewidth=2)
        ax.fill_between(range(len(serie)), serie.values,
                        alpha=0.12, color=PALETTE[0])
        ax.set_title(f"{col} — Tendencia")
        ax.set_xlabel("Índice"); ax.set_ylabel(col)
        guardar_grafica(fig, f"{slug}_linea_{i}")

    # ── 4. Histograma: distribución de numéricas ─────────────────
    for i, col in enumerate(numericas[:2]):
        serie = df[col].dropna()
        if len(serie) < 5:
            continue
        fig, ax = plt.subplots(figsize=(7, 4))
        sns.histplot(serie, bins=min(30, len(serie)//2 or 5),
                     kde=True, ax=ax,
                     color=PALETTE[1], edgecolor="white")
        ax.set_title(f"{col} — Distribución")
        guardar_grafica(fig, f"{slug}_hist_{i}")

    # ── 5. Dispersión (scatter): correlación entre dos numéricas ─
    if len(numericas) >= 2:
        x_col, y_col = numericas[0], numericas[1]
        fig, ax = plt.subplots(figsize=(7, 5))
        ax.scatter(df[x_col].dropna(), df[y_col].dropna(),
                   color=PALETTE[2], alpha=0.65, edgecolors="white",
                   linewidths=0.5, s=60)
        ax.set_title(f"{x_col} vs {y_col}")
        ax.set_xlabel(x_col); ax.set_ylabel(y_col)
        guardar_grafica(fig, f"{slug}_scatter")

    # ── 6. Mapa de calor de correlaciones ─────────────────────────
    if len(numericas) >= 3:
        corr = df[numericas].corr()
        fig, ax = plt.subplots(figsize=(max(6, len(numericas)), max(5, len(numericas)-1)))
        sns.heatmap(corr, annot=True, fmt=".2f", cmap="Blues",
                    linewidths=0.5, ax=ax, cbar_kws={"shrink": 0.8})
        ax.set_title(T.get("analisis", "Análisis") + " — Correlaciones")
        guardar_grafica(fig, f"{slug}_heatmap")
```

---

## FASE 7 — Síntesis: Insights y Recomendaciones

Genera automáticamente insights y recomendaciones a partir del análisis.

```python
def generar_insights(analisis: dict, alertas_calidad: list) -> list:
    insights = []
    stats = analisis.get("estadisticas", {})
    tendencias = analisis.get("tendencias", [])
    correlaciones = analisis.get("correlaciones", {})
    top_cats = analisis.get("top_categorias", {})

    for t in tendencias:
        insights.append(f"📈 {t}")

    for col, stat in stats.items():
        if isinstance(stat, dict):
            media = stat.get("mean", None)
            std   = stat.get("std",  None)
            if media is not None and std is not None and media != 0:
                cv = abs(std / media)
                if cv > 0.5:
                    insights.append(
                        f"📊 '{col}': alta variabilidad (CV={cv:.2f}). "
                        f"Los datos no son homogéneos."
                    )

    for col, top in top_cats.items():
        if top:
            top_val, top_cnt = list(top.items())[0]
            total = sum(top.values())
            pct = top_cnt / total * 100 if total else 0
            if pct > 50:
                insights.append(
                    f"🔍 '{col}': '{top_val}' domina con {pct:.1f}% "
                    f"del total — posible concentración."
                )

    for a in alertas_calidad:
        insights.append(f"⚠ {a}")

    return insights if insights else [T["sin_datos"]]


def generar_recomendaciones(insights: list, analisis: dict) -> list:
    recomendaciones = []
    for ins in insights:
        if "↑ creciente" in ins or "creciente" in ins.lower():
            recomendaciones.append(
                "✅ Capitaliza la tendencia creciente: asigna recursos adicionales "
                "para sostener el momentum identificado."
            )
        if "↓ decreciente" in ins or "decreciente" in ins.lower():
            recomendaciones.append(
                "🚨 Investiga las causas de la tendencia decreciente antes de "
                "tomar decisiones de inversión o expansión."
            )
        if "variabilidad" in ins.lower() or "cv=" in ins.lower():
            recomendaciones.append(
                "🔬 Segmenta los datos de alta variabilidad en subgrupos homogéneos "
                "para análisis más precisos."
            )
        if "domina" in ins.lower() or "concentración" in ins.lower():
            recomendaciones.append(
                "⚖ Evalúa la diversificación: la concentración en una categoría "
                "puede representar un riesgo de dependencia."
            )
        if "duplicad" in ins.lower():
            recomendaciones.append(
                "🗃 Implementa controles de calidad en la fuente de datos para "
                "eliminar duplicados en origen."
            )
        if "nulos" in ins.lower() or "vacío" in ins.lower():
            recomendaciones.append(
                "📋 Define un protocolo de llenado obligatorio de campos en el "
                "sistema que genera estos datos."
            )
        if "outlier" in ins.lower() or "extremo" in ins.lower() or "incoherente" in ins.lower():
            recomendaciones.append(
                "🔍 Valida manualmente los valores extremos con el equipo responsable "
                "de la captura de datos."
            )

    # Deduplicar
    recomendaciones = list(dict.fromkeys(recomendaciones))

    if not recomendaciones:
        if IDIOMA == "es":
            recomendaciones = ["✅ Los datos presentan consistencia aceptable. "
                               "Continúa con el monitoreo periódico."]
        else:
            recomendaciones = ["✅ Data presents acceptable consistency. "
                               "Continue with periodic monitoring."]

    return recomendaciones
```

---

## FASE 8 — Generación del PDF Ejecutivo

```python
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    HRFlowable, Image as RLImage, PageBreak, KeepTogether
)
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_JUSTIFY
from datetime import datetime

# ── COLORES CORPORATIVOS ────────────────────────────────────────────
AZUL_OSCURO   = colors.HexColor("#1A3557")
AZUL_MEDIO    = colors.HexColor("#2E86AB")
AZUL_CLARO    = colors.HexColor("#EBF4FA")
VERDE         = colors.HexColor("#4CAF82")
ROJO_ALERTA   = colors.HexColor("#E63946")
NARANJA       = colors.HexColor("#F4A261")
GRIS_TEXTO    = colors.HexColor("#4A4A4A")
GRIS_SUAVE    = colors.HexColor("#F7F9FC")
BLANCO        = colors.white

def construir_estilos():
    s = getSampleStyleSheet()
    return {
        "titulo": ParagraphStyle("Titulo",
            fontSize=22, textColor=BLANCO, fontName="Helvetica-Bold",
            alignment=TA_CENTER, leading=28, spaceAfter=4),
        "subtitulo_portada": ParagraphStyle("SubtitPortada",
            fontSize=12, textColor=colors.HexColor("#A8DADC"),
            alignment=TA_CENTER, leading=16),
        "seccion": ParagraphStyle("Seccion",
            fontSize=13, textColor=AZUL_OSCURO, fontName="Helvetica-Bold",
            spaceBefore=16, spaceAfter=6, borderPad=4, leading=18),
        "descripcion": ParagraphStyle("Desc",
            fontSize=10.5, textColor=GRIS_TEXTO, leading=16,
            alignment=TA_JUSTIFY, spaceAfter=6),
        "cuerpo": ParagraphStyle("Cuerpo",
            fontSize=10, textColor=GRIS_TEXTO, leading=14,
            spaceAfter=5),
        "alerta": ParagraphStyle("Alerta",
            fontSize=10, textColor=ROJO_ALERTA, leading=14,
            spaceAfter=4, fontName="Helvetica-Bold"),
        "insight": ParagraphStyle("Insight",
            fontSize=10, textColor=AZUL_OSCURO, leading=14,
            spaceAfter=5, leftIndent=10),
        "rec": ParagraphStyle("Rec",
            fontSize=10, textColor=colors.HexColor("#1D4E1A"),
            leading=14, spaceAfter=5, leftIndent=10),
        "pie": ParagraphStyle("Pie",
            fontSize=7.5, textColor=colors.HexColor("#AAAAAA"),
            alignment=TA_CENTER),
        "tabla_header": ParagraphStyle("TablaH",
            fontSize=9, textColor=BLANCO, fontName="Helvetica-Bold",
            alignment=TA_CENTER),
        "tabla_celda": ParagraphStyle("TablaC",
            fontSize=9, textColor=GRIS_TEXTO, leading=12),
        "label_stat": ParagraphStyle("LabelStat",
            fontSize=9, textColor=colors.HexColor("#888888")),
        "valor_stat": ParagraphStyle("ValorStat",
            fontSize=14, textColor=AZUL_OSCURO, fontName="Helvetica-Bold"),
    }

def tarjeta_kpi(label: str, valor: str, color_fondo=None) -> Table:
    """Mini-tarjeta KPI para el resumen visual."""
    if color_fondo is None:
        color_fondo = AZUL_CLARO
    t = Table([[Paragraph(label, ParagraphStyle("kl", fontSize=8,
                    textColor=colors.HexColor("#666666"), leading=10)),
                Paragraph(valor, ParagraphStyle("kv", fontSize=16,
                    fontName="Helvetica-Bold",
                    textColor=AZUL_OSCURO, leading=20))
               ]], colWidths=[4.5*cm], rowHeights=[1.5*cm, 2*cm])
    t.setStyle(TableStyle([
        ("BACKGROUND",   (0,0), (-1,-1), color_fondo),
        ("ROUNDEDCORNERS", [6]),
        ("LEFTPADDING",  (0,0), (-1,-1), 10),
        ("TOPPADDING",   (0,0), (-1,-1), 8),
        ("BOTTOMPADDING",(0,0), (-1,-1), 8),
    ]))
    return t


def generar_pdf_analisis(
    titulo_analisis: str,
    descripcion_ejecutiva: str,      # 5 líneas / oraciones
    inventario_archivos: list,       # [{nombre, tipo, alertas}]
    analisis_por_archivo: list,      # [{nombre, stats, insights, graficas}]
    insights_globales: list,
    recomendaciones: list,
    puntos_ciegos: list,
    ruta_salida: str
):
    E = construir_estilos()
    elementos = []

    # ╔══════════════════════════════════════════════════════════════╗
    # ║  PORTADA                                                     ║
    # ╚══════════════════════════════════════════════════════════════╝
    portada_bg = Table(
        [[Paragraph(T["titulo_reporte"], E["titulo"])],
         [Paragraph(titulo_analisis, E["subtitulo_portada"])],
         [Spacer(1, 0.5*cm)],
         [Paragraph(
             f"{T['generado']}: {datetime.now().strftime('%d/%m/%Y %H:%M')} &nbsp;·&nbsp; "
             f"{len(inventario_archivos)} {T['archivos']}",
             ParagraphStyle("meta_portada", fontSize=9,
                            textColor=colors.HexColor("#90B4CE"),
                            alignment=TA_CENTER)
         )]],
        colWidths=[17*cm],
        rowHeights=[2*cm, 2*cm, 0.3*cm, 0.8*cm]
    )
    portada_bg.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,-1), AZUL_OSCURO),
        ("ALIGN",      (0,0), (-1,-1), "CENTER"),
        ("VALIGN",     (0,0), (-1,-1), "MIDDLE"),
        ("TOPPADDING", (0,0), (-1,-1), 20),
        ("BOTTOMPADDING", (0,-1), (-1,-1), 20),
        ("ROUNDEDCORNERS", [8]),
    ]))
    elementos.append(portada_bg)
    elementos.append(Spacer(1, 0.6*cm))

    # ── Descripción Ejecutiva (5 líneas) ──────────────────────────
    elementos.append(HRFlowable(width="100%", thickness=2, color=AZUL_MEDIO))
    elementos.append(Spacer(1, 0.2*cm))
    elementos.append(Paragraph(T["descripcion"], E["seccion"]))
    elementos.append(Paragraph(descripcion_ejecutiva, E["descripcion"]))
    elementos.append(Spacer(1, 0.3*cm))

    # ── Inventario de Archivos ─────────────────────────────────────
    elementos.append(Paragraph(T["inventario"], E["seccion"]))
    if inventario_archivos:
        encabezado = ["Archivo", "Tipo", T["calidad"]]
        filas = [encabezado]
        for a in inventario_archivos:
            alertas_txt = "; ".join(a.get("alertas", [])) or "✔ OK"
            color_calidad = "🔴" if a.get("alertas") else "🟢"
            filas.append([
                a.get("nombre", "—"),
                a.get("tipo", "—"),
                f"{color_calidad} {alertas_txt[:80]}{'…' if len(alertas_txt)>80 else ''}"
            ])
        tbl = Table(filas, colWidths=[5*cm, 3*cm, 9*cm])
        tbl.setStyle(TableStyle([
            ("BACKGROUND",    (0,0), (-1,0), AZUL_OSCURO),
            ("TEXTCOLOR",     (0,0), (-1,0), BLANCO),
            ("FONTNAME",      (0,0), (-1,0), "Helvetica-Bold"),
            ("FONTSIZE",      (0,0), (-1,-1), 8.5),
            ("ROWBACKGROUNDS",(0,1), (-1,-1), [AZUL_CLARO, BLANCO]),
            ("GRID",          (0,0), (-1,-1), 0.4, colors.HexColor("#C8D8EC")),
            ("VALIGN",        (0,0), (-1,-1), "TOP"),
            ("LEFTPADDING",   (0,0), (-1,-1), 6),
            ("TOPPADDING",    (0,0), (-1,-1), 5),
            ("BOTTOMPADDING", (0,0), (-1,-1), 5),
            ("WORDWRAP",      (0,0), (-1,-1), True),
        ]))
        elementos.append(tbl)
    elementos.append(Spacer(1, 0.4*cm))

    # ╔══════════════════════════════════════════════════════════════╗
    # ║  ANÁLISIS DETALLADO POR ARCHIVO                              ║
    # ╚══════════════════════════════════════════════════════════════╝
    elementos.append(Paragraph(T["analisis"], E["seccion"]))
    elementos.append(HRFlowable(width="100%", thickness=1, color=AZUL_CLARO))
    elementos.append(Spacer(1, 0.3*cm))

    for bloque in analisis_por_archivo:
        nombre    = bloque.get("nombre", "—")
        texto_ana = bloque.get("texto_analisis", "")
        stats     = bloque.get("stats_tabla", [])   # [[etiqueta, valor], ...]
        graficas  = bloque.get("graficas", [])

        # Subtítulo de archivo
        elementos.append(Paragraph(f"📄 {nombre}", ParagraphStyle(
            "subarch", fontSize=11, textColor=AZUL_MEDIO,
            fontName="Helvetica-Bold", spaceBefore=10, spaceAfter=4
        )))

        # Estadísticas resumidas en tabla 2-columnas
        if stats:
            filas_s = [["Métrica", "Valor"]]
            for m, v in stats:
                filas_s.append([str(m), str(v)])
            ts = Table(filas_s, colWidths=[8*cm, 8*cm])
            ts.setStyle(TableStyle([
                ("BACKGROUND",    (0,0), (-1,0), AZUL_MEDIO),
                ("TEXTCOLOR",     (0,0), (-1,0), BLANCO),
                ("FONTNAME",      (0,0), (-1,0), "Helvetica-Bold"),
                ("FONTSIZE",      (0,0), (-1,-1), 9),
                ("ROWBACKGROUNDS",(0,1), (-1,-1), [GRIS_SUAVE, BLANCO]),
                ("GRID",          (0,0), (-1,-1), 0.4, colors.HexColor("#DDE8F4")),
                ("LEFTPADDING",   (0,0), (-1,-1), 8),
                ("TOPPADDING",    (0,0), (-1,-1), 5),
                ("BOTTOMPADDING", (0,0), (-1,-1), 5),
            ]))
            elementos.append(ts)
            elementos.append(Spacer(1, 0.25*cm))

        # Texto de análisis
        if texto_ana:
            elementos.append(Paragraph(texto_ana, E["cuerpo"]))

        # Gráficas (2 por fila)
        if graficas:
            for i in range(0, len(graficas), 2):
                par = graficas[i:i+2]
                imgs = []
                for g in par:
                    if os.path.exists(g):
                        try:
                            imgs.append(RLImage(g, width=8*cm, height=5*cm))
                        except Exception:
                            imgs.append(Paragraph("[gráfica no disponible]", E["cuerpo"]))
                    else:
                        imgs.append(Spacer(1, 5*cm))
                if len(imgs) == 1:
                    imgs.append(Spacer(1, 8*cm))
                fila_imgs = Table([imgs], colWidths=[8.5*cm, 8.5*cm])
                fila_imgs.setStyle(TableStyle([
                    ("ALIGN",   (0,0),(-1,-1), "CENTER"),
                    ("VALIGN",  (0,0),(-1,-1), "MIDDLE"),
                    ("TOPPADDING",    (0,0),(-1,-1), 4),
                    ("BOTTOMPADDING", (0,0),(-1,-1), 4),
                ]))
                elementos.append(fila_imgs)
                elementos.append(Spacer(1, 0.2*cm))

        elementos.append(Spacer(1, 0.3*cm))

    # ╔══════════════════════════════════════════════════════════════╗
    # ║  INSIGHTS                                                    ║
    # ╚══════════════════════════════════════════════════════════════╝
    elementos.append(PageBreak())
    elementos.append(Paragraph(T["insights"], E["seccion"]))
    elementos.append(HRFlowable(width="100%", thickness=1, color=AZUL_CLARO))
    elementos.append(Spacer(1, 0.2*cm))

    for ins in insights_globales:
        elementos.append(Paragraph(ins, E["insight"]))

    elementos.append(Spacer(1, 0.5*cm))

    # ╔══════════════════════════════════════════════════════════════╗
    # ║  RECOMENDACIONES                                             ║
    # ╚══════════════════════════════════════════════════════════════╝
    elementos.append(Paragraph(T["recomendaciones"], E["seccion"]))
    elementos.append(HRFlowable(width="100%", thickness=1, color=VERDE))
    elementos.append(Spacer(1, 0.2*cm))

    for i, rec in enumerate(recomendaciones, 1):
        bloque_rec = Table(
            [[Paragraph(f"{i}", ParagraphStyle("n_rec",
                  fontSize=14, fontName="Helvetica-Bold",
                  textColor=BLANCO, alignment=TA_CENTER)),
              Paragraph(rec, E["rec"])]],
            colWidths=[1*cm, 15.5*cm],
            rowHeights=[None]
        )
        bloque_rec.setStyle(TableStyle([
            ("BACKGROUND",    (0,0), (0,-1), VERDE),
            ("BACKGROUND",    (1,0), (1,-1), colors.HexColor("#F0FBF5")),
            ("VALIGN",        (0,0), (-1,-1), "MIDDLE"),
            ("LEFTPADDING",   (0,0), (-1,-1), 8),
            ("TOPPADDING",    (0,0), (-1,-1), 8),
            ("BOTTOMPADDING", (0,0), (-1,-1), 8),
            ("LINEBELOW",     (0,0), (-1,-1), 0.5, colors.HexColor("#C8EED8")),
        ]))
        elementos.append(bloque_rec)
        elementos.append(Spacer(1, 0.15*cm))

    # ╔══════════════════════════════════════════════════════════════╗
    # ║  PUNTOS CIEGOS                                               ║
    # ╚══════════════════════════════════════════════════════════════╝
    if puntos_ciegos:
        elementos.append(Spacer(1, 0.4*cm))
        elementos.append(Paragraph(T["puntos_ciegos"], E["seccion"]))
        for pc in puntos_ciegos:
            elementos.append(Paragraph(f"🔴 {pc}", E["alerta"]))

    # ── Pie de página ─────────────────────────────────────────────
    elementos.append(Spacer(1, 0.6*cm))
    elementos.append(HRFlowable(width="100%", thickness=0.8,
                                color=colors.HexColor("#C8D8EC")))
    elementos.append(Spacer(1, 0.15*cm))
    elementos.append(Paragraph(
        f"Analista de Datos · Claude AI &nbsp;|&nbsp; "
        f"{datetime.now().strftime('%d/%m/%Y %H:%M')}",
        E["pie"]
    ))

    # ── Build ─────────────────────────────────────────────────────
    doc = SimpleDocTemplate(
        ruta_salida, pagesize=A4,
        rightMargin=2*cm, leftMargin=2*cm,
        topMargin=2.5*cm, bottomMargin=2*cm,
        title=titulo_analisis
    )
    doc.build(elementos)
    print(f"[OK] PDF generado: {ruta_salida}")
```

---

## FASE 9 — Orquestador Principal

```python
def ejecutar_analisis_completo(mensaje_usuario: str):
    """
    Punto de entrada. Llama a todas las fases en orden.
    """
    global IDIOMA, T
    IDIOMA = detectar_idioma(mensaje_usuario)
    # T ya fue asignado arriba según IDIOMA

    archivos = inventariar_archivos()
    if not archivos:
        print("No se encontraron archivos en /mnt/user-data/uploads/")
        return

    inventario_final  = []
    analisis_por_arch = []
    insights_globales = []
    recomendaciones   = []
    puntos_ciegos     = []
    todos_insights    = []

    for arch in archivos:
        print(f"[PROCESANDO] {arch['nombre']} ...")

        # Extracción
        contenido = extraer_contenido(arch)

        if contenido["error"]:
            puntos_ciegos.append(
                f"{arch['nombre']}: {contenido['error']}"
            )
            inventario_final.append({
                "nombre": arch["nombre"],
                "tipo": arch["ext"],
                "alertas": [contenido["error"]]
            })
            continue

        bloque_analisis = {
            "nombre": arch["nombre"],
            "graficas": [],
            "stats_tabla": [],
            "texto_analisis": "",
        }

        alertas_arch = []

        # Análisis de DataFrames
        for j, df_raw in enumerate(contenido["dataframes"]):
            auditoria = auditar_calidad(df_raw, f"{arch['nombre']}_tabla{j}")
            alertas_arch.extend(auditoria["alertas"])
            df = auditoria["df_limpio"]

            stats = analizar_dataframe(df)
            insights_df = generar_insights(stats, auditoria["alertas"])
            todos_insights.extend(insights_df)

            # Estadísticas para tabla PDF
            desc = df.describe()
            for col in desc.columns[:4]:  # máx 4 columnas
                for stat_name in ["mean", "std", "min", "max"]:
                    if stat_name in desc.index:
                        val = desc.loc[stat_name, col]
                        bloque_analisis["stats_tabla"].append(
                            [f"{col} — {stat_name}", f"{val:.2f}" if pd.notna(val) else "N/D"]
                        )

            # Gráficas
            elegir_y_generar_graficas(df, f"{arch['nombre'][:15]}_t{j}")
            bloque_analisis["graficas"] = graficas_generadas.copy()

        # Texto de análisis (desde contenido textual)
        if contenido["texto"]:
            bloque_analisis["texto_analisis"] = (
                contenido["texto"][:800] +
                ("…" if len(contenido["texto"]) > 800 else "")
            )

        inventario_final.append({
            "nombre": arch["nombre"],
            "tipo": contenido["tipo"],
            "alertas": alertas_arch
        })
        analisis_por_arch.append(bloque_analisis)

    # Deduplicar insights
    todos_insights = list(dict.fromkeys(todos_insights))

    # Generar recomendaciones globales
    recomendaciones = generar_recomendaciones(todos_insights, {})

    # Título inferido
    titulo_inferido = inferir_titulo(archivos, mensaje_usuario)

    # Descripción ejecutiva (5 líneas)
    descripcion = generar_descripcion_ejecutiva(
        archivos, inventario_final, todos_insights
    )

    # Generar PDF
    ruta_salida = "/mnt/user-data/outputs/analisis_datos.pdf"
    generar_pdf_analisis(
        titulo_analisis       = titulo_inferido,
        descripcion_ejecutiva = descripcion,
        inventario_archivos   = inventario_final,
        analisis_por_archivo  = analisis_por_arch,
        insights_globales     = todos_insights,
        recomendaciones       = recomendaciones,
        puntos_ciegos         = puntos_ciegos,
        ruta_salida           = ruta_salida
    )
    # present_files([ruta_salida])   # ← Llamar después de ejecutar


def inferir_titulo(archivos: list, mensaje: str) -> str:
    """Genera un título descriptivo para el reporte."""
    nombres = [os.path.splitext(a["nombre"])[0] for a in archivos[:3]]
    base = " · ".join(nombres)
    if IDIOMA == "es":
        return f"Análisis de Datos — {base}"
    return f"Data Analysis Report — {base}"


def generar_descripcion_ejecutiva(archivos, inventario, insights) -> str:
    """Redacta un párrafo de 5 líneas resumiendo el análisis."""
    n = len(archivos)
    formatos = list({a["ext"] for a in archivos})
    n_alertas = sum(len(i.get("alertas", [])) for i in inventario)
    n_ins = len(insights)
    if IDIOMA == "es":
        return (
            f"El presente reporte sintetiza el análisis de {n} archivo(s) en formato(s) "
            f"{', '.join(formatos)}, procesados de forma automatizada. "
            f"Se identificaron {n_alertas} alertas de calidad de datos que podrían "
            f"afectar la confiabilidad de las métricas. "
            f"El análisis generó {n_ins} insight(s) clave sobre patrones, tendencias "
            f"y comportamientos detectados en los datos. "
            f"Las secciones siguientes presentan el detalle estadístico, las visualizaciones "
            f"y las recomendaciones estratégicas derivadas del análisis."
        )
    else:
        return (
            f"This report summarizes the analysis of {n} file(s) in {', '.join(formatos)} "
            f"format(s), processed automatically. "
            f"{n_alertas} data quality alert(s) were identified that may affect "
            f"the reliability of key metrics. "
            f"The analysis generated {n_ins} key insight(s) on patterns, trends, "
            f"and behaviors detected in the data. "
            f"The following sections present statistical details, visualizations, "
            f"and strategic recommendations derived from the analysis."
        )
```

---

## Reglas Críticas de Comportamiento

| # | Regla |
|---|-------|
| 1 | **Nunca interrumpas al usuario** para pedirle que instale librerías. Hazlo tú con `bash_tool`. |
| 2 | **Nunca inventes datos.** Si un archivo es ilegible o corrupto, regístralo en Puntos Ciegos. |
| 3 | **Detecta el idioma automáticamente** y emite TODO en ese idioma, incluyendo el PDF. |
| 4 | **El PDF es obligatorio.** Siempre termina con un archivo descargable en `/mnt/user-data/outputs/`. |
| 5 | **Elige el tipo de gráfica según los datos**, no arbitrariamente. Barras=categorías, Líneas=tiempo, Scatter=correlación, Pie=composición, Heatmap=correlaciones múltiples. |
| 6 | **Marca claramente los sesgos y valores anómalos** en el reporte; no los silencies. |
| 7 | **Diseño ejecutivo:** sin ruido visual, paleta consistente, tipografía limpia. |
| 8 | Si no hay archivos subidos, pide al usuario que los suba antes de continuar. |

---

## Formatos Soportados

| Extensión | Método de extracción |
|-----------|---------------------|
| `.pdf` | `pdfplumber` (texto + tablas) |
| `.docx` / `.doc` | `python-docx` / `pandoc` |
| `.xlsx` / `.xlsm` | `openpyxl` |
| `.xls` | `pandas` + `xlrd` |
| `.ods` | `pandas` + `odfpy` |
| `.csv` / `.tsv` | `pandas` |
| `.json` | `json` + `pandas` |
| `.txt` / `.md` | lectura directa UTF-8 |
| `.jpg` / `.jpeg` / `.png` / `.webp` | `Pillow` + `pytesseract` (OCR) |
| `.pptx` | `python-pptx` (texto de diapositivas) |

---

## Notas de Implementación

- El orquestador `ejecutar_analisis_completo(mensaje_usuario)` es el único punto
  de entrada. Llámalo con el mensaje original del usuario.
- Después de `generar_pdf_analisis(...)`, llama a `present_files([ruta_salida])`
  para que el usuario pueda descargar el PDF directamente.
- Para archivos muy grandes (>50MB), aplica muestreo:
  `df = pd.read_csv(ruta, nrows=10000)` y anota en el reporte que se usó muestra.
- Si `pytesseract` falla en producción por falta de `tesseract` binario,
  registra la imagen como punto ciego y continúa.
