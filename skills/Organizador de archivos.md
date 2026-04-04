---
Name: Organizador de Archivos
description: >
  Activa esta skill cuando el usuario necesite organizar, limpiar, renombrar o
  estructurar un sistema de archivos desordenado. Disparadores: "organiza mis archivos",
  "renombra estos documentos", "ordena esta carpeta", "limpia mi directorio",
  "clasifica estos archivos", "estructura mis documentos", "tengo archivos desordenados",
  "dale orden a mis carpetas", "¿puedes organizar esto?", o cualquier solicitud que
  implique analizar un sistema de archivos y reorganizarlo de forma lógica y profesional.
  La skill opera en tres fases: Escaneo silencioso → Propuesta de cambios (Dry Run con
  confirmación del usuario) → Ejecución real. NUNCA ejecuta cambios destructivos sin
  autorización explícita. Genera un log completo de cada operación realizada.
  Toda ejecución de código o comandos de terminal requiere autorización explícita
  del usuario antes de proceder.
compatibility:
  tools: [bash_tool, create_file, present_files, view, str_replace]
  python: ">=3.9"
  os: ["linux", "macOS", "windows-wsl"]
  auto_installs: true
  requires_user_authorization: true   # CRÍTICO: nunca ejecuta cambios sin confirmación
---

# Curador Autónomo de Archivos — Skill Completa

## 1. Definición de Rol

Eres un **Bibliotecario Digital de Precisión** — un agente experto en Gestión de
Activos Digitales (DAM) con criterio de archivista profesional y precisión quirúrgica.

Tu misión es analizar sistemas de archivos caóticos y transformarlos en estructuras
coherentes, buscables y mantenibles a largo plazo. Operas bajo un principio fundamental:

> **"Primero analiza, luego propone, después ejecuta — y nunca sin permiso."**

Tu comportamiento tiene tres características permanentes:

| Característica | Descripción |
|---|---|
| **No destructivo** | Nunca eliminas un archivo original sin respaldo previo |
| **Trazable** | Cada acción queda registrada en un log detallado |
| **Semántico** | Clasificas por contenido real, no por extensión de archivo |

Detectas el idioma del usuario automáticamente y operas en **Español** o **Inglés**.

---

## 2. FASE 0 — Instalación Silenciosa de Dependencias

**Ejecuta esto primero, sin preguntar al usuario. Requiere autorización para bash.**

```bash
pip install \
  pypdf pdfplumber \
  python-docx \
  openpyxl xlrd \
  Pillow pytesseract \
  python-magic \
  chardet \
  langdetect \
  rich \
  --break-system-packages -q 2>&1 | tail -5

# Herramientas de sistema
apt-get install -y \
  tesseract-ocr tesseract-ocr-spa tesseract-ocr-eng \
  file \
  poppler-utils \
  2>/dev/null | tail -3 || true

# Verificación
python3 -c "
import pypdf, pdfplumber, docx, openpyxl, PIL, chardet, langdetect
print('[OK] Dependencias del Curador listas')
" 2>&1
```

---

## 3. Lógica de Clasificación Semántica

> ⚠️ **Principio Cardinal:** La extensión del archivo (`.pdf`, `.docx`, `.jpg`)
> es irrelevante para la clasificación. Lo que importa es la **naturaleza del
> contenido** que el archivo representa.

### 3.1 Router de Extracción de Contenido

```python
import os, hashlib, datetime
import pdfplumber
from docx import Document
import openpyxl
from PIL import Image
import pytesseract
import chardet

def extraer_texto_para_clasificacion(ruta: str) -> str:
    """
    Extrae hasta 2000 caracteres del contenido de cualquier archivo
    para alimentar la lógica de clasificación semántica.
    Nunca lanza errores fatales: devuelve string vacío si falla.
    """
    ext = os.path.splitext(ruta)[1].lower()
    texto = ""

    try:
        # ── PDF ─────────────────────────────────────────────────────
        if ext == ".pdf":
            with pdfplumber.open(ruta) as pdf:
                for pag in pdf.pages[:3]:  # Solo primeras 3 páginas
                    t = pag.extract_text()
                    if t:
                        texto += t + "\n"
                    if len(texto) > 2000:
                        break

        # ── DOCX ────────────────────────────────────────────────────
        elif ext in (".docx", ".doc"):
            doc = Document(ruta)
            for para in doc.paragraphs[:40]:
                texto += para.text + "\n"

        # ── XLSX ────────────────────────────────────────────────────
        elif ext in (".xlsx", ".xlsm"):
            wb = openpyxl.load_workbook(ruta, read_only=True, data_only=True)
            ws = wb.active
            for i, row in enumerate(ws.iter_rows(values_only=True)):
                if i > 20:
                    break
                texto += " ".join(str(c) for c in row if c) + "\n"

        # ── TXT / MD / CSV ──────────────────────────────────────────
        elif ext in (".txt", ".md", ".csv", ".json", ".xml", ".html"):
            with open(ruta, "rb") as f:
                raw = f.read(4096)
            enc = chardet.detect(raw)["encoding"] or "utf-8"
            texto = raw.decode(enc, errors="replace")

        # ── IMÁGENES (OCR) ──────────────────────────────────────────
        elif ext in (".jpg", ".jpeg", ".png", ".webp", ".tiff", ".bmp"):
            img = Image.open(ruta)
            texto = pytesseract.image_to_string(img, lang="spa+eng")

        # ── PPTX ────────────────────────────────────────────────────
        elif ext == ".pptx":
            from pptx import Presentation
            prs = Presentation(ruta)
            for slide in list(prs.slides)[:5]:
                for shape in slide.shapes:
                    if hasattr(shape, "text"):
                        texto += shape.text + "\n"

    except Exception as e:
        texto = f"[ERROR_EXTRACCION: {e}]"

    return texto[:2000].strip()
```

### 3.2 Motor de Clasificación Semántica

La IA clasifica por **naturaleza documental**, usando palabras clave extraídas
del contenido. La jerarquía de decisión es la siguiente:

```python
# Mapa semántico: Tipo → palabras clave características
MAPA_SEMANTICO = {
    # ── FINANZAS ────────────────────────────────────────────────────
    "Factura": [
        "factura", "invoice", "rfc", "subtotal", "iva", "total a pagar",
        "folio fiscal", "cfdi", "receptor", "emisor", "concepto", "importe"
    ],
    "Cotización": [
        "cotización", "cotizacion", "quote", "presupuesto", "propuesta económica",
        "precio unitario", "descuento", "vigencia"
    ],
    "Estado_de_Cuenta": [
        "estado de cuenta", "account statement", "saldo", "movimientos",
        "depósito", "retiro", "saldo final", "corte"
    ],
    "Nómina": [
        "nómina", "nomina", "payroll", "percepciones", "deducciones",
        "salario", "sueldo", "imss", "infonavit", "quincenal"
    ],
    "Recibo": [
        "recibo", "receipt", "pago realizado", "comprobante de pago",
        "pagado", "acuse"
    ],

    # ── LEGAL ───────────────────────────────────────────────────────
    "Contrato": [
        "contrato", "contract", "acuerdo", "agreement", "cláusula",
        "partes", "obligaciones", "vigencia", "firma", "notario"
    ],
    "Convenio": [
        "convenio", "convenido", "addendum", "adenda", "modificación al contrato"
    ],
    "Poder_Notarial": [
        "poder notarial", "poder especial", "poderdante", "apoderado",
        "ante notario", "fe pública"
    ],
    "Acta": [
        "acta", "minutes", "sesión", "asamblea", "quórum", "acuerdos tomados",
        "presidente de mesa", "secretario"
    ],
    "NDA": [
        "confidencialidad", "non-disclosure", "nda", "información confidencial",
        "no divulgar", "secreto industrial"
    ],

    # ── PROYECTOS ───────────────────────────────────────────────────
    "Brief": [
        "brief", "briefing", "objetivo del proyecto", "alcance", "entregables",
        "kpis", "métricas de éxito", "audiencia objetivo"
    ],
    "Propuesta": [
        "propuesta", "proposal", "presentamos", "nuestra oferta",
        "solución propuesta", "metodología"
    ],
    "Guion": [
        "guion", "guión", "script", "escena", "ext.", "int.", "v.o.",
        "personaje", "acción", "diálogo", "fade in", "cut to"
    ],
    "Plan_de_Trabajo": [
        "plan de trabajo", "cronograma", "gantt", "hitos", "milestone",
        "sprint", "fase", "entrega"
    ],
    "Reporte": [
        "reporte", "report", "informe", "resultados", "conclusiones",
        "hallazgos", "análisis de", "periodo"
    ],
    "Presentación": [
        "deck", "presentación ejecutiva", "agenda", "siguiente diapositiva",
        "slide", "puntos clave"
    ],

    # ── MULTIMEDIA / REFERENCIA VISUAL ──────────────────────────────
    "Referencia_Visual": [
        "moodboard", "referencia", "paleta", "tipografía", "estilo visual",
        "inspiración", "mood", "dirección de arte"
    ],
    "Manual": [
        "manual", "instructivo", "guía de uso", "user guide",
        "paso a paso", "procedimiento", "instrucciones"
    ],

    # ── RECURSOS HUMANOS ────────────────────────────────────────────
    "CV": [
        "curriculum", "currículum", "resume", "experiencia laboral",
        "habilidades", "formación académica", "referencias"
    ],
    "Oferta_Laboral": [
        "oferta de trabajo", "job offer", "puesto", "salario ofrecido",
        "prestaciones", "fecha de inicio"
    ],

    # ── GENÉRICO ────────────────────────────────────────────────────
    "Documento_General": []  # Fallback si ninguno coincide
}


def clasificar_semanticamente(texto: str, nombre_archivo: str) -> str:
    """
    Determina el TIPO_DOCUMENTO basándose en el contenido extraído.
    Devuelve la clave del MAPA_SEMANTICO con mayor coincidencia.
    """
    texto_lower = (texto + " " + nombre_archivo).lower()
    puntuaciones = {}

    for tipo, palabras_clave in MAPA_SEMANTICO.items():
        if not palabras_clave:
            continue
        hits = sum(1 for kw in palabras_clave if kw in texto_lower)
        if hits > 0:
            puntuaciones[tipo] = hits

    if not puntuaciones:
        return "Documento_General"

    return max(puntuaciones, key=puntuaciones.get)
```

---

## 4. Protocolo de Renombrado Inteligente

### 4.1 Patrón Estándar de Nomenclatura

```
[YYYY-MM-DD]_[ENTIDAD]_[TIPO_DOCUMENTO]_[DESCRIPCIÓN_BREVE].ext
```

| Campo | Descripción | Fuente de extracción |
|---|---|---|
| `YYYY-MM-DD` | Fecha del documento | Metadatos del archivo → texto del contenido → fecha de creación del sistema |
| `ENTIDAD` | Empresa, persona u organización involucrada | Encabezado, RFC, membrete, firma |
| `TIPO_DOCUMENTO` | Naturaleza semántica del archivo | Motor de clasificación semántica (sección 3) |
| `DESCRIPCIÓN_BREVE` | 2-4 palabras que identifican el documento | Título, asunto, primer párrafo |

> **Reglas de formato para los campos:**
> - Todo en `Snake_Case`, sin espacios, sin acentos, sin caracteres especiales
> - Máximo 30 caracteres por campo
> - Sustituir espacios por guión bajo `_`
> - Eliminar: `/ \ : * ? " < > |`

### 4.2 Ejemplos de Renombrado

| Nombre Original | Nombre Renombrado | Motivo |
|---|---|---|
| `doc001.pdf` | `2024-03-15_ACME_Factura_Servicios_Enero.pdf` | Fecha extraída del CFDI; entidad del RFC |
| `FINAL_v3_DEFINITIVO.docx` | `2024-11-02_ClienteXYZ_Contrato_Servicios_Diseño.docx` | Fecha del encabezado; tipo por cláusulas detectadas |
| `sin_titulo.xlsx` | `2025-01-10_Interno_Estado_de_Cuenta_Q1.xlsx` | Fecha de la celda A1; "movimientos" en columna B |
| `imagen_captura.png` | `2024-08-20_NA_Referencia_Visual_Paleta_Colores.png` | OCR detectó "paleta" y "tipografía" |
| `script_ep3.txt` | `2025-02-01_Produccion_Guion_Episodio_03.txt` | "INT.", "EXT.", nombres de personajes detectados |
| `CV Juan.docx` | `2024-12-05_Juan_Garcia_CV_Desarrollador_Senior.docx` | Nombre extraído del encabezado; "experiencia laboral" detectado |
| `escaneo0042.pdf` | `2023-06-18_Notaria12_Poder_Notarial_Acto_Comercial.pdf` | "poderdante", "ante notario" detectados por OCR |

### 4.3 Extractor de Campos para el Nombre

```python
import re
from datetime import datetime

MESES_ES = {
    "enero": "01", "febrero": "02", "marzo": "03",
    "abril": "04", "mayo": "05", "junio": "06",
    "julio": "07", "agosto": "08", "septiembre": "09",
    "octubre": "10", "noviembre": "11", "diciembre": "12"
}

def extraer_fecha(texto: str, ruta_archivo: str) -> str:
    """
    Intenta extraer fecha del contenido. Si falla, usa mtime del archivo.
    Devuelve string en formato YYYY-MM-DD.
    """
    # Patrón ISO: 2024-03-15
    m = re.search(r"\b(20\d{2})[-/](0[1-9]|1[0-2])[-/]([0-2]\d|3[01])\b", texto)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"

    # Patrón mexicano: 15 de marzo de 2024
    m = re.search(
        r"\b(\d{1,2})\s+de\s+(" + "|".join(MESES_ES) + r")\s+de\s+(20\d{2})\b",
        texto.lower()
    )
    if m:
        return f"{m.group(3)}-{MESES_ES[m.group(2)]}-{m.group(1).zfill(2)}"

    # Patrón US: March 15, 2024
    m = re.search(
        r"\b(january|february|march|april|may|june|july|august|"
        r"september|october|november|december)\s+(\d{1,2}),?\s+(20\d{2})\b",
        texto.lower()
    )
    if m:
        meses_en = {
            "january":"01","february":"02","march":"03","april":"04",
            "may":"05","june":"06","july":"07","august":"08",
            "september":"09","october":"10","november":"11","december":"12"
        }
        return f"{m.group(3)}-{meses_en[m.group(1)]}-{m.group(2).zfill(2)}"

    # Fallback: fecha de modificación del archivo
    ts = os.path.getmtime(ruta_archivo)
    return datetime.fromtimestamp(ts).strftime("%Y-%m-%d")


def extraer_entidad(texto: str) -> str:
    """
    Extrae la entidad principal del documento (empresa, persona, organización).
    """
    # RFC mexicano → nombre en línea anterior
    m = re.search(r"RFC[:\s]+([A-Z&]{3,4}\d{6}[A-Z0-9]{3})", texto.upper())
    if m:
        idx = texto.upper().find(m.group(0))
        fragmento_anterior = texto[max(0, idx-100):idx]
        lineas = [l.strip() for l in fragmento_anterior.split("\n") if l.strip()]
        if lineas:
            return limpiar_campo(lineas[-1])[:30]

    # Patrón "Razón Social:" o "Company:"
    m = re.search(
        r"(?:razón social|empresa|company|cliente|proveedor)[:\s]+([^\n]{3,40})",
        texto, re.IGNORECASE
    )
    if m:
        return limpiar_campo(m.group(1))[:30]

    return "NA"


def extraer_descripcion(texto: str, tipo_doc: str) -> str:
    """
    Genera una descripción breve de 2-4 palabras basada en el contenido.
    """
    # Usar las primeras palabras significativas del primer párrafo o título
    lineas = [l.strip() for l in texto.split("\n") if len(l.strip()) > 10]
    if lineas:
        primera = lineas[0]
        palabras = [p for p in primera.split()
                    if len(p) > 3 and p.lower() not in
                    {"para", "como", "este", "esta", "that", "with", "from"}]
        return limpiar_campo("_".join(palabras[:3]))[:35]
    return tipo_doc


def limpiar_campo(texto: str) -> str:
    """Elimina caracteres no permitidos en nombres de archivo."""
    import unicodedata
    # Normalizar acentos
    nfkd = unicodedata.normalize("NFKD", texto)
    sin_acentos = "".join(c for c in nfkd if not unicodedata.combining(c))
    # Reemplazar espacios y caracteres especiales
    limpio = re.sub(r"[^\w\-]", "_", sin_acentos)
    limpio = re.sub(r"_+", "_", limpio).strip("_")
    return limpio


def construir_nombre_final(ruta_original: str, texto: str) -> str:
    """
    Orquesta la extracción de todos los campos y construye el nombre final.
    """
    _, ext = os.path.splitext(ruta_original)
    nombre_original = os.path.basename(ruta_original)

    fecha       = extraer_fecha(texto, ruta_original)
    entidad     = extraer_entidad(texto) or "NA"
    tipo_doc    = clasificar_semanticamente(texto, nombre_original)
    descripcion = extraer_descripcion(texto, tipo_doc)

    nombre_nuevo = f"{fecha}_{entidad}_{tipo_doc}_{descripcion}{ext.lower()}"
    return nombre_nuevo
```

---

## 5. Arquitectura de Carpetas Sugerida

### 5.1 Estructura Base

```
📁 RAIZ_ORGANIZADA/
│
├── 📁 01_Finanzas/
│   ├── 📁 Facturas/
│   │   ├── 📁 Emitidas/
│   │   └── 📁 Recibidas/
│   ├── 📁 Cotizaciones/
│   ├── 📁 Estados_de_Cuenta/
│   ├── 📁 Nominas/
│   └── 📁 Recibos_y_Comprobantes/
│
├── 📁 02_Legal/
│   ├── 📁 Contratos/
│   │   ├── 📁 Vigentes/
│   │   └── 📁 Finalizados/
│   ├── 📁 Convenios_y_Adendas/
│   ├── 📁 Poderes_Notariales/
│   ├── 📁 Actas/
│   └── 📁 NDAs/
│
├── 📁 03_Proyectos_Activos/
│   ├── 📁 [Nombre_Proyecto_1]/
│   │   ├── 📁 Briefs/
│   │   ├── 📁 Propuestas/
│   │   ├── 📁 Entregas/
│   │   └── 📁 Reportes/
│   └── 📁 [Nombre_Proyecto_2]/
│
├── 📁 04_Recursos_Humanos/
│   ├── 📁 CVs/
│   └── 📁 Ofertas_Laborales/
│
├── 📁 05_Multimedia/
│   ├── 📁 Referencias_Visuales/
│   ├── 📁 Guiones/
│   ├── 📁 Presentaciones/
│   └── 📁 Manuales/
│
├── 📁 06_Archivo_Historico/
│   └── 📁 [YYYY]/          # Un subfolder por año
│
├── 📁 _Duplicados/          # Archivos duplicados detectados
├── 📁 _No_Clasificados/     # Archivos que no pudieron clasificarse
└── 📁 _Papelera_Temporal/   # NUNCA se borra sin revisión manual
```

### 5.2 Mapa Tipo → Carpeta Destino

```python
MAPA_CARPETAS = {
    # Finanzas
    "Factura":           "01_Finanzas/Facturas/Recibidas",
    "Cotización":        "01_Finanzas/Cotizaciones",
    "Estado_de_Cuenta":  "01_Finanzas/Estados_de_Cuenta",
    "Nómina":            "01_Finanzas/Nominas",
    "Recibo":            "01_Finanzas/Recibos_y_Comprobantes",

    # Legal
    "Contrato":          "02_Legal/Contratos/Vigentes",
    "Convenio":          "02_Legal/Convenios_y_Adendas",
    "Poder_Notarial":    "02_Legal/Poderes_Notariales",
    "Acta":              "02_Legal/Actas",
    "NDA":               "02_Legal/NDAs",

    # Proyectos
    "Brief":             "03_Proyectos_Activos/_Sin_Asignar/Briefs",
    "Propuesta":         "03_Proyectos_Activos/_Sin_Asignar/Propuestas",
    "Guion":             "05_Multimedia/Guiones",
    "Plan_de_Trabajo":   "03_Proyectos_Activos/_Sin_Asignar/Entregas",
    "Reporte":           "03_Proyectos_Activos/_Sin_Asignar/Reportes",
    "Presentación":      "05_Multimedia/Presentaciones",

    # Multimedia
    "Referencia_Visual": "05_Multimedia/Referencias_Visuales",
    "Manual":            "05_Multimedia/Manuales",

    # RRHH
    "CV":                "04_Recursos_Humanos/CVs",
    "Oferta_Laboral":    "04_Recursos_Humanos/Ofertas_Laborales",

    # Fallback
    "Documento_General": "_No_Clasificados",
}


def determinar_carpeta_destino(tipo_doc: str, raiz_destino: str) -> str:
    """
    Devuelve la ruta absoluta de destino para un tipo de documento.
    Crea el directorio si no existe.
    """
    subcarpeta = MAPA_CARPETAS.get(tipo_doc, "_No_Clasificados")
    ruta_completa = os.path.join(raiz_destino, subcarpeta)
    os.makedirs(ruta_completa, exist_ok=True)
    return ruta_completa
```

---

## 6. Reglas de Gestión de Duplicados

> Un duplicado debe detectarse por **contenido idéntico**, no por nombre similar.
> Dos archivos llamados igual pueden ser versiones distintas; dos archivos con
> nombres distintos pueden ser exactamente el mismo documento.

### 6.1 Algoritmo de Detección

```python
import hashlib
from collections import defaultdict

def calcular_hash(ruta: str, bloque: int = 65536) -> str:
    """
    Calcula SHA-256 del archivo en bloques para soportar archivos grandes.
    Devuelve hex digest.
    """
    sha256 = hashlib.sha256()
    try:
        with open(ruta, "rb") as f:
            while True:
                datos = f.read(bloque)
                if not datos:
                    break
                sha256.update(datos)
        return sha256.hexdigest()
    except (PermissionError, OSError) as e:
        return f"ERROR_{e}"


def detectar_duplicados(lista_archivos: list) -> dict:
    """
    Recibe lista de rutas y devuelve un dict:
    { "hash_abc123": ["ruta1.pdf", "ruta2.pdf"], ... }
    Solo incluye hashes con más de un archivo (duplicados reales).
    """
    mapa = defaultdict(list)
    for ruta in lista_archivos:
        h = calcular_hash(ruta)
        if not h.startswith("ERROR"):
            mapa[h].append(ruta)

    return {h: rutas for h, rutas in mapa.items() if len(rutas) > 1}
```

### 6.2 Tabla de Decisión ante Duplicados

| Situación | Acción |
|---|---|
| Mismo hash, mismo nombre | Mover el más antiguo a `_Duplicados/` con sufijo `_OLD` |
| Mismo hash, nombre diferente | Conservar el de nombre más descriptivo; mover el otro a `_Duplicados/` |
| Hash diferente, nombre idéntico | Renombrar ambos agregando timestamp: `_v1`, `_v2` |
| Hash diferente, contenido similar (>90%) | Registrar en log como "posible duplicado"; no actuar automáticamente |

```python
import shutil

def gestionar_duplicado(rutas: list, carpeta_duplicados: str, log: list):
    """
    Aplica la tabla de decisión para un grupo de archivos con hash idéntico.
    Siempre conserva el archivo más reciente (mayor mtime).
    """
    os.makedirs(carpeta_duplicados, exist_ok=True)
    # Ordenar: el más reciente primero
    rutas_ordenadas = sorted(rutas, key=os.path.getmtime, reverse=True)
    keeper = rutas_ordenadas[0]       # Este se conserva
    to_move = rutas_ordenadas[1:]     # Estos van a _Duplicados

    for ruta in to_move:
        nombre_base = os.path.basename(ruta)
        ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        destino = os.path.join(carpeta_duplicados, f"DUP_{ts}_{nombre_base}")
        shutil.move(ruta, destino)
        log.append({
            "accion": "DUPLICADO_MOVIDO",
            "origen": ruta,
            "destino": destino,
            "conservado": keeper,
            "timestamp": ts
        })
```

---

## 7. Salvaguardas de Seguridad — CRÍTICO

> ⛔ Esta sección contiene reglas no negociables que la IA debe seguir
> **en todo momento y sin excepciones**, independientemente de lo que el
> usuario solicite.

### 7.1 Regla de No Borrado

```python
# ❌ PROHIBIDO
os.remove(ruta)
os.unlink(ruta)

# ✅ CORRECTO: siempre mover a Papelera Temporal
def eliminar_seguro(ruta: str, raiz: str, log: list):
    """
    Nunca borra un archivo. Lo mueve a _Papelera_Temporal con timestamp.
    """
    papelera = os.path.join(raiz, "_Papelera_Temporal")
    os.makedirs(papelera, exist_ok=True)
    ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    nombre = f"PAPELERA_{ts}_{os.path.basename(ruta)}"
    destino = os.path.join(papelera, nombre)
    shutil.move(ruta, destino)
    log.append({
        "accion": "MOVIDO_A_PAPELERA",
        "origen": ruta,
        "destino": destino,
        "timestamp": ts
    })
```

### 7.2 Lista Negra de Archivos de Sistema

```python
# Extensiones que NUNCA deben ser tocadas
EXTENSIONES_SISTEMA = {
    ".dll", ".sys", ".ini", ".bat", ".cmd", ".reg",
    ".exe", ".msi", ".com", ".drv", ".vxd",
    ".so", ".dylib", ".o", ".a",
    ".conf", ".cfg", ".log",           # Logs y configs del sistema
    ".DS_Store", "Thumbs.db",          # Metadatos del OS
    ".gitignore", ".git",              # Control de versiones
    "__pycache__", ".pyc", ".pyo",     # Python compilado
    "node_modules",                    # Dependencias JS
}

# Directorios que NUNCA deben escanearse
DIRS_SISTEMA = {
    "/System", "/Windows", "/usr", "/bin", "/sbin",
    "/etc", "/var", "/proc", "/dev", "/boot",
    "C:\\Windows", "C:\\Program Files",
    "C:\\Program Files (x86)", "C:\\ProgramData"
}

def es_archivo_seguro(ruta: str) -> bool:
    """
    Retorna True si el archivo puede ser procesado.
    Retorna False si es un archivo de sistema o protegido.
    """
    ext = os.path.splitext(ruta)[1].lower()
    nombre = os.path.basename(ruta)

    # Verificar extensión
    if ext in EXTENSIONES_SISTEMA:
        return False

    # Verificar nombres exactos de sistema
    if nombre in {"Thumbs.db", ".DS_Store", "desktop.ini", ".gitignore"}:
        return False

    # Verificar si la ruta cae dentro de un directorio de sistema
    for dir_sys in DIRS_SISTEMA:
        if ruta.startswith(dir_sys):
            return False

    # Verificar permisos de lectura
    if not os.access(ruta, os.R_OK):
        return False

    return True
```

### 7.3 Sistema de Log

```python
import json
from datetime import datetime

class LogCurador:
    """
    Registra todas las operaciones realizadas en un archivo JSON + resumen TXT.
    """
    def __init__(self, raiz_destino: str):
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        self.ruta_json = os.path.join(raiz_destino, f"curador_log_{ts}.json")
        self.ruta_txt  = os.path.join(raiz_destino, f"curador_resumen_{ts}.txt")
        self.eventos   = []
        self.inicio    = datetime.now()

    def registrar(self, accion: str, origen: str, destino: str = None,
                  nombre_nuevo: str = None, nota: str = None):
        evento = {
            "timestamp":   datetime.now().isoformat(),
            "accion":      accion,       # RENOMBRADO | MOVIDO | DUPLICADO | OMITIDO | ERROR
            "origen":      origen,
            "destino":     destino,
            "nombre_nuevo": nombre_nuevo,
            "nota":        nota
        }
        self.eventos.append(evento)

    def guardar(self):
        # JSON estructurado
        with open(self.ruta_json, "w", encoding="utf-8") as f:
            json.dump({
                "inicio":    self.inicio.isoformat(),
                "fin":       datetime.now().isoformat(),
                "total_ops": len(self.eventos),
                "eventos":   self.eventos
            }, f, ensure_ascii=False, indent=2)

        # Resumen legible
        conteo = {}
        for e in self.eventos:
            conteo[e["accion"]] = conteo.get(e["accion"], 0) + 1

        with open(self.ruta_txt, "w", encoding="utf-8") as f:
            f.write(f"{'='*60}\n")
            f.write(f"  CURADOR AUTÓNOMO DE ARCHIVOS — LOG DE OPERACIONES\n")
            f.write(f"{'='*60}\n")
            f.write(f"  Inicio : {self.inicio.strftime('%Y-%m-%d %H:%M:%S')}\n")
            f.write(f"  Fin    : {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
            f.write(f"{'='*60}\n\n")
            f.write("RESUMEN:\n")
            for accion, total in conteo.items():
                f.write(f"  {accion:<20} {total:>5} operaciones\n")
            f.write("\nDETALLE:\n")
            for e in self.eventos:
                f.write(f"\n[{e['timestamp']}] {e['accion']}\n")
                f.write(f"  Origen : {e['origen']}\n")
                if e.get("destino"):
                    f.write(f"  Destino: {e['destino']}\n")
                if e.get("nombre_nuevo"):
                    f.write(f"  Nuevo nombre: {e['nombre_nuevo']}\n")
                if e.get("nota"):
                    f.write(f"  Nota   : {e['nota']}\n")

        return self.ruta_json, self.ruta_txt
```

---

## 8. Flujo de Trabajo (Workflow)

```
┌─────────────────────────────────────────────────────────────────┐
│  CURADOR AUTÓNOMO — FLUJO DE TRES FASES                        │
│                                                                 │
│  FASE 1: ESCANEO          FASE 2: DRY RUN         FASE 3: EJECUCIÓN │
│  (Automático)             (Solo lectura)           (Con autorización) │
│                                                                 │
│  Inventariar archivos  →  Generar propuesta   →  Ejecutar cambios    │
│  Extraer contenido        Mostar al usuario       Registrar en log    │
│  Detectar duplicados       Esperar confirmación    Generar reporte     │
│  Clasificar semántic.      SÍ / NO / EDITAR       Presentar archivos  │
└─────────────────────────────────────────────────────────────────┘
```

### FASE 1 — Escaneo (Automático, sin cambios)

```python
def fase_escaneo(directorio_origen: str) -> list:
    """
    Recorre el directorio de forma recursiva.
    Solo lectura. No modifica nada.
    Devuelve lista de dicts con información de cada archivo.
    """
    inventario = []

    for root, dirs, files in os.walk(directorio_origen):
        # Excluir directorios de sistema
        dirs[:] = [d for d in dirs
                   if not d.startswith(".")
                   and d not in {"node_modules", "__pycache__", "_Papelera_Temporal"}]

        for nombre_archivo in files:
            ruta_abs = os.path.join(root, nombre_archivo)

            if not es_archivo_seguro(ruta_abs):
                inventario.append({
                    "ruta": ruta_abs,
                    "nombre": nombre_archivo,
                    "estado": "OMITIDO_SISTEMA",
                    "motivo": "Archivo de sistema o sin permisos"
                })
                continue

            try:
                stat  = os.stat(ruta_abs)
                texto = extraer_texto_para_clasificacion(ruta_abs)
                tipo  = clasificar_semanticamente(texto, nombre_archivo)
                hash_ = calcular_hash(ruta_abs)
                nuevo_nombre = construir_nombre_final(ruta_abs, texto)

                inventario.append({
                    "ruta":         ruta_abs,
                    "nombre":       nombre_archivo,
                    "nombre_nuevo": nuevo_nombre,
                    "tipo_doc":     tipo,
                    "hash":         hash_,
                    "bytes":        stat.st_size,
                    "estado":       "PENDIENTE"
                })
            except Exception as e:
                inventario.append({
                    "ruta":   ruta_abs,
                    "nombre": nombre_archivo,
                    "estado": "ERROR",
                    "motivo": str(e)
                })

    return inventario
```

### FASE 2 — Propuesta de Cambios (Dry Run)

```python
def fase_dry_run(inventario: list, raiz_destino: str) -> str:
    """
    Genera y MUESTRA al usuario un reporte detallado de los cambios
    que se realizarían, SIN ejecutar ninguno.
    Devuelve el reporte como string para mostrar en consola/chat.
    """
    lineas = []
    lineas.append("=" * 70)
    lineas.append("  PROPUESTA DE REORGANIZACIÓN — DRY RUN (sin cambios aún)")
    lineas.append("=" * 70)
    lineas.append(f"  Directorio origen  : {raiz_destino}")
    lineas.append(f"  Total archivos     : {len(inventario)}")

    pendientes  = [a for a in inventario if a["estado"] == "PENDIENTE"]
    omitidos    = [a for a in inventario if a["estado"] == "OMITIDO_SISTEMA"]
    con_error   = [a for a in inventario if a["estado"] == "ERROR"]

    lineas.append(f"  A procesar         : {len(pendientes)}")
    lineas.append(f"  Omitidos (sistema) : {len(omitidos)}")
    lineas.append(f"  Con errores        : {len(error)}")
    lineas.append("")
    lineas.append("CAMBIOS PROPUESTOS:")
    lineas.append("-" * 70)

    for arch in pendientes:
        carpeta_dest = determinar_carpeta_destino(arch["tipo_doc"], raiz_destino)
        lineas.append(f"\n  📄 ORIGEN  : {arch['nombre']}")
        lineas.append(f"     NUEVO   : {arch['nombre_nuevo']}")
        lineas.append(f"     TIPO    : {arch['tipo_doc']}")
        lineas.append(f"     MOVER A : .../{os.path.relpath(carpeta_dest, raiz_destino)}/")

    lineas.append("\n" + "=" * 70)
    lineas.append("  ¿Deseas ejecutar estos cambios? Responde:")
    lineas.append("  ✅ SÍ  — para ejecutar todos los cambios")
    lineas.append("  ❌ NO  — para cancelar sin modificar nada")
    lineas.append("  ✏️  EDITAR — para ajustar reglas antes de ejecutar")
    lineas.append("=" * 70)

    reporte = "\n".join(lineas)
    print(reporte)
    return reporte
```

### FASE 3 — Ejecución Tras Confirmación

```python
def fase_ejecucion(inventario: list, raiz_destino: str,
                   autorizacion_usuario: bool = False) -> tuple:
    """
    Ejecuta los cambios SOLO si autorizacion_usuario es True.
    Si es False, levanta excepción inmediatamente.
    Devuelve (ruta_log_json, ruta_log_txt).
    """
    if not autorizacion_usuario:
        raise PermissionError(
            "⛔ EJECUCIÓN BLOQUEADA: Se requiere autorización explícita del usuario. "
            "Responde 'SÍ' para confirmar."
        )

    log = LogCurador(raiz_destino)
    duplicados_hash = detectar_duplicados([
        a["ruta"] for a in inventario if a["estado"] == "PENDIENTE"
    ])
    hashes_dup = set(a["hash"] for a in inventario
                     if a.get("hash") in duplicados_hash)

    for arch in inventario:
        if arch["estado"] != "PENDIENTE":
            log.registrar("OMITIDO", arch["ruta"], nota=arch.get("motivo"))
            continue

        try:
            ruta_origen = arch["ruta"]

            # ── Gestionar duplicado ──────────────────────────────────
            if arch.get("hash") in hashes_dup:
                carpeta_dup = os.path.join(raiz_destino, "_Duplicados")
                gestionar_duplicado(
                    duplicados_hash[arch["hash"]], carpeta_dup, log.eventos
                )
                continue

            # ── Determinar destino ───────────────────────────────────
            carpeta_dest = determinar_carpeta_destino(arch["tipo_doc"], raiz_destino)
            ruta_destino = os.path.join(carpeta_dest, arch["nombre_nuevo"])

            # Evitar sobreescritura
            if os.path.exists(ruta_destino):
                ts = datetime.now().strftime("%H%M%S")
                base, ext = os.path.splitext(arch["nombre_nuevo"])
                ruta_destino = os.path.join(carpeta_dest, f"{base}_{ts}{ext}")

            # ── Mover y renombrar ────────────────────────────────────
            shutil.move(ruta_origen, ruta_destino)
            log.registrar(
                accion      = "MOVIDO_Y_RENOMBRADO",
                origen      = ruta_origen,
                destino     = ruta_destino,
                nombre_nuevo = arch["nombre_nuevo"]
            )

        except Exception as e:
            log.registrar("ERROR", arch["ruta"], nota=str(e))

    return log.guardar()
```

### Orquestador Principal

```python
def curar_directorio(directorio: str, autorizacion: bool = False):
    """
    Punto de entrada único. Llama las tres fases en orden.
    autorizacion=False  → Solo escanea y presenta Dry Run.
    autorizacion=True   → Ejecuta cambios tras mostrar Dry Run.

    ⚠️  NUNCA establecer autorizacion=True sin confirmación explícita del usuario.
    """
    print(f"[CURADOR] Iniciando escaneo de: {directorio}")

    # FASE 1
    inventario = fase_escaneo(directorio)
    print(f"[CURADOR] Escaneo completo: {len(inventario)} archivos encontrados.")

    # FASE 2
    reporte_dry = fase_dry_run(inventario, directorio)

    if not autorizacion:
        print("\n[CURADOR] Modo Dry Run completado. Esperando autorización del usuario.")
        return reporte_dry

    # FASE 3 (solo con autorización)
    print("\n[CURADOR] Autorización recibida. Ejecutando reorganización...")
    ruta_json, ruta_txt = fase_ejecucion(inventario, directorio, autorizacion_usuario=True)
    print(f"[CURADOR] ✅ Reorganización completa.")
    print(f"[CURADOR] Log JSON : {ruta_json}")
    print(f"[CURADOR] Log TXT  : {ruta_txt}")
    return ruta_json, ruta_txt
```

---

## 9. Reglas Críticas de Comportamiento

| # | Regla |
|---|---|
| 1 | **Nunca ejecutes cambios sin autorización explícita del usuario.** El Dry Run es obligatorio antes de cualquier ejecución. |
| 2 | **Nunca borres archivos.** Cualquier eliminación debe ser un movimiento a `_Papelera_Temporal/`. |
| 3 | **No toques archivos de sistema.** Usa `es_archivo_seguro()` antes de procesar cualquier archivo. |
| 4 | **Clasifica por contenido, nunca por extensión.** Un `.pdf` puede ser una factura o un guion; el contenido lo decide. |
| 5 | **Genera siempre el log.** Cada movimiento, renombrado y omisión debe quedar registrado. |
| 6 | **Informa claramente el Dry Run.** El usuario debe entender exactamente qué cambiará antes de confirmar. |
| 7 | **Instala dependencias automáticamente** con `bash_tool`, sin interrumpir al usuario para pedirle que lo haga manualmente. |
| 8 | **Ante la duda, omite y registra.** Si un archivo no puede clasificarse con certeza, va a `_No_Clasificados/` y se registra. |
| 9 | **Ejecución de código y comandos terminal:** solo con autorización del usuario. Pregunta antes de cada `bash_tool` destructivo. |
| 10 | **Preserva la estructura de proyectos activos.** Si detectas carpetas con nombre de proyecto ya estructuradas, consúltale al usuario antes de reorganizarlas. |

---

## 10. Formatos Soportados para Clasificación

| Extensión | Método de extracción de contenido |
|---|---|
| `.pdf` | `pdfplumber` (texto + tablas, primeras 3 páginas) |
| `.docx` / `.doc` | `python-docx` (primeros 40 párrafos) |
| `.xlsx` / `.xlsm` | `openpyxl` (primeras 20 filas de hoja activa) |
| `.xls` | `pandas` + `xlrd` |
| `.txt` / `.md` / `.csv` | Lectura directa UTF-8 con detección de encoding |
| `.json` / `.xml` / `.html` | Lectura directa, primeros 4096 bytes |
| `.jpg` / `.jpeg` / `.png` / `.webp` / `.tiff` | `Pillow` + `pytesseract` OCR (spa+eng) |
| `.pptx` | `python-pptx` (texto de primeras 5 diapositivas) |

---

## 11. Notas de Implementación

- El orquestador `curar_directorio(directorio, autorizacion)` es el único punto
  de entrada. Llámalo con `autorizacion=False` primero; cambia a `True` solo
  tras confirmación del usuario.
- Para directorios muy grandes (>10,000 archivos), aplica paginación en el
  Dry Run: muestra bloques de 50 archivos y solicita confirmación por bloque.
- Si `pytesseract` no está disponible, registra las imágenes en `_No_Clasificados/`
  y anota en el log "OCR_NO_DISPONIBLE".
- El log final debe entregarse al usuario vía `present_files([ruta_json, ruta_txt])`.
- La `_Papelera_Temporal/` nunca se vacía automáticamente. El usuario la gestiona
  manualmente. La IA puede recordárselo al final de cada sesión.
