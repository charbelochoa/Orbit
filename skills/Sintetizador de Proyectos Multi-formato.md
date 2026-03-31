---
name: Sintetizador-proyectos-multi-formato
description: >
  Usa esta skill cuando el usuario necesite analizar, consolidar o sintetizar múltiples
  archivos de un proyecto (PDF, DOCX, XLSX, MD, JPG/imágenes con texto) para producir
  una "Verdad Unificada" ejecutiva del estado del proyecto. Actívala cuando el usuario
  mencione frases como "analiza mi carpeta de proyecto", "sintetiza estos archivos",
  "dame un resumen ejecutivo del proyecto", "consolida la información de estos documentos",
  o cuando suba varios archivos de distintos formatos y pida extraer información cruzada,
  detectar inconsistencias, identificar stakeholders, fechas clave, presupuestos o riesgos.
  También aplica cuando el usuario pida un informe final descargable en PDF con el
  análisis de un conjunto de archivos de proyecto. Siempre usa esta skill si hay 2 o más
  archivos de distintos formatos involucrados en un análisis de proyecto.
compatibility:
  tools:
    - bash_tool
    - create_file
    - present_files
    - view
  python_packages:
    - pypdf
    - python-docx
    - openpyxl
    - Pillow
    - pytesseract   # OCR para imágenes JPG/PNG
    - reportlab     # Generación del PDF de salida
  system_deps:
    - tesseract-ocr  # sudo apt-get install tesseract-ocr -y (si OCR es necesario)
---

# Sintetizador de Proyectos Multi-formato

## Rol y Objetivo

Actúa como **Especialista en Síntesis de Proyectos de Alto Nivel**. Tu misión es procesar
un conjunto de archivos de diversos formatos para generar una **"Verdad Unificada"** del
proyecto: un análisis ejecutivo cruzado, cohesionado y con detección de inconsistencias,
entregado finalmente como un **PDF descargable**.

---

## Flujo de Ejecución (sigue este orden estrictamente)

### FASE 0 — Preparación del entorno

```bash
pip install pypdf python-docx openpyxl Pillow pytesseract reportlab --break-system-packages -q
apt-get install -y tesseract-ocr tesseract-ocr-spa 2>/dev/null || true
```

Verifica los archivos disponibles en `/mnt/user-data/uploads/`:

```bash
ls -lh /mnt/user-data/uploads/
```

---

### FASE 1 — Escaneo de Inventario

Clasifica cada archivo detectado en una de estas categorías:

| Categoría             | Extensiones típicas       | Propósito probable                          |
|-----------------------|---------------------------|---------------------------------------------|
| Contrato / Legal      | .pdf, .docx               | Alcance, cláusulas, firmas, partes          |
| Presupuesto / Finanzas| .xlsx, .csv               | Costos, recursos, flujo de caja             |
| Plan / Cronograma     | .xlsx, .pdf, .docx        | Hitos, fechas, responsables                 |
| Especificaciones Técnicas | .pdf, .docx, .md      | Requerimientos, arquitectura, entregables   |
| Notas / Correos       | .docx, .md, .txt          | Pendientes, decisiones, comunicaciones      |
| Diagramas / Esquemas  | .jpg, .png, .pdf          | Flujos, organigramas, mapas de proceso      |
| Reportes de Avance    | .pdf, .docx               | Estado actual, KPIs, problemas              |

**Extracción por tipo de archivo:**

```python
# PDF
from pypdf import PdfReader
def leer_pdf(ruta):
    try:
        r = PdfReader(ruta)
        return "\n".join(p.extract_text() or "" for p in r.pages)
    except Exception as e:
        return f"[ERROR_LECTURA: {e}]"

# DOCX
from docx import Document
def leer_docx(ruta):
    try:
        doc = Document(ruta)
        return "\n".join(p.text for p in doc.paragraphs if p.text.strip())
    except Exception as e:
        return f"[ERROR_LECTURA: {e}]"

# XLSX
import openpyxl
def leer_xlsx(ruta):
    try:
        wb = openpyxl.load_workbook(ruta, data_only=True)
        resultado = []
        for sheet in wb.sheetnames:
            ws = wb[sheet]
            resultado.append(f"--- Hoja: {sheet} ---")
            for row in ws.iter_rows(values_only=True):
                fila = [str(c) if c is not None else "" for c in row]
                if any(fila):
                    resultado.append(" | ".join(fila))
        return "\n".join(resultado)
    except Exception as e:
        return f"[ERROR_LECTURA: {e}]"

# MD / TXT
def leer_texto(ruta):
    try:
        with open(ruta, encoding="utf-8", errors="replace") as f:
            return f.read()
    except Exception as e:
        return f"[ERROR_LECTURA: {e}]"

# JPG / PNG (OCR)
from PIL import Image
import pytesseract
def leer_imagen_ocr(ruta):
    try:
        img = Image.open(ruta)
        texto = pytesseract.image_to_string(img, lang="spa+eng")
        return texto if texto.strip() else "[IMAGEN_SIN_TEXTO_DETECTABLE]"
    except Exception as e:
        return f"[ERROR_OCR: {e}]"
```

> ⚠️ Si un archivo devuelve `[ERROR_LECTURA]` o está vacío/protegido,
> regístralo en la sección **"Puntos Ciegos"** — nunca inventes su contenido.

---

### FASE 2 — Extracción Cruzada de Entidades

Una vez extraído el texto de todos los archivos, ejecuta análisis cruzado buscando:

| Entidad              | Qué buscar                                                        |
|----------------------|-------------------------------------------------------------------|
| **Stakeholders**     | Nombres propios, firmas, títulos (Gerente, Director, PM, etc.)    |
| **Fechas clave**     | Fechas de inicio, entrega, revisión, vencimiento de contrato      |
| **Hitos técnicos**   | Fases, sprints, releases, entregables numerados                   |
| **Presupuesto total**| Montos, totales, subtotales, partidas presupuestarias             |
| **Riesgos**          | Palabras como: riesgo, alerta, problema, retraso, pendiente, crítico |
| **Inconsistencias**  | Contradicciones entre archivos (nombres, fechas, montos, responsables) |

Construye un diccionario Python consolidado:
```python
verdad_unificada = {
    "stakeholders": [],
    "fechas_clave": [],
    "hitos": [],
    "presupuesto": [],
    "riesgos": [],
    "inconsistencias": [],
    "proximos_pasos": [],
    "puntos_ciegos": [],
    "mapa_recursos": {}  # {nombre_archivo: descripción_de_contenido}
}
```

---

### FASE 3 — Construcción del Informe

Redacta el informe con las siguientes secciones en este orden:

#### 3.1 Resumen Ejecutivo (2 párrafos)
- **Párrafo 1**: ¿Qué es este proyecto? (nombre, objetivo, partes involucradas)
- **Párrafo 2**: ¿En qué estado se encuentra según la **última fecha detectada** en los archivos?

#### 3.2 Mapa de Recursos
Lista qué aporta cada archivo clave. Ejemplo:
> - `presupuesto_Q3.xlsx` → Desglose de costos por fase, total detectado: $XXX,XXX
> - `contrato_v2.pdf` → Alcance legal, partes firmantes, fecha de vencimiento
> - `plan_proyecto.docx` → Cronograma de hitos, responsables por actividad

#### 3.3 Cronograma Detectado
Línea de tiempo cronológica de hitos:
- Fecha PASADA ✅ — descripción del hito (fuente: archivo)
- Fecha FUTURA ⏳ — descripción del hito (fuente: archivo)
- Fecha SIN CONFIRMAR ❓ — hito mencionado sin fecha explícita

#### 3.4 Análisis de Inconsistencias
Para cada contradicción detectada:
> **[INCONSISTENCIA-01]** El archivo `contrato.pdf` indica que el responsable del proyecto
> es **Juan Pérez**, mientras que `organigrama.jpg` (OCR) muestra a **María López**
> como Project Manager. Requiere clarificación.

Si no hay inconsistencias: *"No se detectaron contradicciones entre los archivos analizados."*

#### 3.5 Próximos Pasos Sugeridos
Basados en pendientes encontrados en notas, correos o comentarios:
1. [Acción concreta] — Responsable sugerido / Fecha límite detectada
2. ...

#### 3.6 Puntos Ciegos ⚠️
Archivos que **no pudieron ser procesados**:
> - `archivo_protegido.pdf` → Protegido con contraseña. Contenido desconocido.
> - `escaneo_borroso.jpg` → OCR no detectó texto legible. Requiere revisión manual.

---

### FASE 4 — Generación del PDF de Salida

Usa `reportlab` para generar el PDF ejecutivo. Plantilla base:

```python
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    HRFlowable, PageBreak
)

def generar_pdf_informe(datos: dict, ruta_salida: str):
    doc = SimpleDocTemplate(
        ruta_salida,
        pagesize=A4,
        rightMargin=2*cm, leftMargin=2*cm,
        topMargin=2.5*cm, bottomMargin=2*cm,
        title="Síntesis de Proyecto — Verdad Unificada"
    )

    estilos = getSampleStyleSheet()
    # Estilos personalizados
    titulo_principal = ParagraphStyle(
        "TituloPrincipal", parent=estilos["Title"],
        fontSize=20, textColor=colors.HexColor("#1A3557"),
        spaceAfter=6
    )
    subtitulo = ParagraphStyle(
        "Subtitulo", parent=estilos["Normal"],
        fontSize=11, textColor=colors.HexColor("#4A6FA5"),
        spaceAfter=12
    )
    seccion = ParagraphStyle(
        "Seccion", parent=estilos["Heading2"],
        fontSize=13, textColor=colors.HexColor("#1A3557"),
        spaceBefore=14, spaceAfter=6,
        borderPad=4
    )
    cuerpo = ParagraphStyle(
        "Cuerpo", parent=estilos["Normal"],
        fontSize=10, leading=14, spaceAfter=6
    )
    alerta = ParagraphStyle(
        "Alerta", parent=estilos["Normal"],
        fontSize=10, leading=14,
        textColor=colors.HexColor("#C0392B"),
        spaceAfter=6
    )
    punto_ciego = ParagraphStyle(
        "PuntoCiego", parent=estilos["Normal"],
        fontSize=10, leading=14,
        textColor=colors.HexColor("#E67E22"),
        spaceAfter=4
    )

    elementos = []

    # ── Encabezado ──────────────────────────────────────────────────
    elementos.append(Paragraph("SÍNTESIS DE PROYECTO", titulo_principal))
    elementos.append(Paragraph("Verdad Unificada — Análisis Multi-formato", subtitulo))
    elementos.append(HRFlowable(width="100%", thickness=2,
                                color=colors.HexColor("#1A3557")))
    elementos.append(Spacer(1, 0.4*cm))

    # Metadata de generación
    from datetime import datetime
    fecha_gen = datetime.now().strftime("%d/%m/%Y %H:%M")
    elementos.append(Paragraph(
        f"<font size='8' color='#888888'>Generado el {fecha_gen} · "
        f"Archivos analizados: {datos.get('total_archivos', 'N/D')}</font>",
        estilos["Normal"]
    ))
    elementos.append(Spacer(1, 0.6*cm))

    # ── 1. Resumen Ejecutivo ─────────────────────────────────────────
    elementos.append(Paragraph("1. Resumen Ejecutivo", seccion))
    for parrafo in datos.get("resumen_ejecutivo", ["Sin datos."]):
        elementos.append(Paragraph(parrafo, cuerpo))
    elementos.append(Spacer(1, 0.3*cm))

    # ── 2. Mapa de Recursos ──────────────────────────────────────────
    elementos.append(Paragraph("2. Mapa de Recursos", seccion))
    mapa = datos.get("mapa_recursos", {})
    if mapa:
        tabla_data = [["Archivo", "Contenido / Propósito"]]
        for archivo, desc in mapa.items():
            tabla_data.append([archivo, desc])
        t = Table(tabla_data, colWidths=[5.5*cm, 11*cm])
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1A3557")),
            ("TEXTCOLOR",  (0, 0), (-1, 0), colors.white),
            ("FONTNAME",   (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE",   (0, 0), (-1, -1), 9),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1),
             [colors.HexColor("#EBF0F7"), colors.white]),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#C8D8EC")),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ]))
        elementos.append(t)
    else:
        elementos.append(Paragraph("No se identificaron archivos clave.", cuerpo))
    elementos.append(Spacer(1, 0.3*cm))

    # ── 3. Cronograma Detectado ──────────────────────────────────────
    elementos.append(Paragraph("3. Cronograma Detectado", seccion))
    cronograma = datos.get("cronograma", [])
    if cronograma:
        for hito in cronograma:
            elementos.append(Paragraph(f"• {hito}", cuerpo))
    else:
        elementos.append(Paragraph("No se detectaron fechas o hitos explícitos.", cuerpo))
    elementos.append(Spacer(1, 0.3*cm))

    # ── 4. Análisis de Inconsistencias ───────────────────────────────
    elementos.append(Paragraph("4. Análisis de Inconsistencias", seccion))
    inconsistencias = datos.get("inconsistencias", [])
    if inconsistencias:
        for inc in inconsistencias:
            elementos.append(Paragraph(f"⚠ {inc}", alerta))
    else:
        elementos.append(Paragraph(
            "No se detectaron contradicciones entre los archivos analizados.", cuerpo
        ))
    elementos.append(Spacer(1, 0.3*cm))

    # ── 5. Próximos Pasos ────────────────────────────────────────────
    elementos.append(Paragraph("5. Próximos Pasos Sugeridos", seccion))
    pasos = datos.get("proximos_pasos", [])
    if pasos:
        for i, paso in enumerate(pasos, 1):
            elementos.append(Paragraph(f"{i}. {paso}", cuerpo))
    else:
        elementos.append(Paragraph("No se identificaron pendientes explícitos.", cuerpo))
    elementos.append(Spacer(1, 0.3*cm))

    # ── 6. Puntos Ciegos ─────────────────────────────────────────────
    puntos_ciegos = datos.get("puntos_ciegos", [])
    if puntos_ciegos:
        elementos.append(Paragraph("6. Puntos Ciegos ⚠️", seccion))
        for pc in puntos_ciegos:
            elementos.append(Paragraph(f"🔴 {pc}", punto_ciego))
        elementos.append(Spacer(1, 0.3*cm))

    # ── Pie de página ────────────────────────────────────────────────
    elementos.append(HRFlowable(width="100%", thickness=1,
                                color=colors.HexColor("#C8D8EC")))
    elementos.append(Spacer(1, 0.2*cm))
    elementos.append(Paragraph(
        "<font size='8' color='#AAAAAA'>Generado automáticamente por "
        "Sintetizador de Proyectos Multi-formato · Claude AI</font>",
        estilos["Normal"]
    ))

    doc.build(elementos)
    print(f"[OK] PDF generado: {ruta_salida}")
```

Llama la función así:
```python
generar_pdf_informe(
    datos=verdad_unificada,
    ruta_salida="/mnt/user-data/outputs/sintesis_proyecto.pdf"
)
```

Luego presenta el archivo:
```python
# En el flujo principal de la skill, al final:
# present_files(["/mnt/user-data/outputs/sintesis_proyecto.pdf"])
```

---

## Reglas Críticas de Comportamiento

1. **NUNCA inventes contenido** de un archivo ilegible, protegido o vacío.  
   → Regístralo en `puntos_ciegos` y continúa con los demás.

2. **Siempre prioriza el análisis cruzado** sobre los resúmenes individuales.  
   → Si el DOCX menciona una fecha límite, verifica si el XLSX refleja recursos para esa fecha.

3. **La última fecha detectada** en cualquier archivo define el "estado actual" del proyecto.

4. **Tono**: Profesional, ejecutivo y directo. Sin redundancias ni adornos innecesarios.

5. **Si no hay archivos subidos**: Pide al usuario que suba los archivos del proyecto
   antes de continuar.

6. **El PDF de salida es obligatorio**: Siempre entrega el análisis como archivo `.pdf`
   descargable además del resumen en chat.

---

## Ejemplo de Estructura de `verdad_unificada` poblada

```python
verdad_unificada = {
    "total_archivos": 5,
    "resumen_ejecutivo": [
        "El proyecto 'Sistema ERP Fase 2' tiene como objetivo la migración de módulos "
        "financieros y de RRHH a la nueva plataforma cloud. Involucra a TechCorp como "
        "proveedor y a la Dirección de TI del cliente como supervisor.",
        "Según la última fecha detectada (15/11/2024 en el acta de reunión), el proyecto "
        "se encuentra en la Fase 2 con un avance del 60%, con retrasos en el módulo de "
        "nómina que ponen en riesgo la entrega programada para enero 2025."
    ],
    "mapa_recursos": {
        "contrato_erp.pdf": "Contrato de servicios, alcance, SLAs y penalidades.",
        "presupuesto_2024.xlsx": "Desglose de costos por módulo. Total: $450,000 USD.",
        "plan_proyecto.docx": "Cronograma de 8 fases, responsables y dependencias.",
        "acta_reunion_nov.docx": "Acuerdos del 15/11/2024, pendientes y decisiones.",
        "diagrama_flujo.jpg": "Diagrama de arquitectura técnica (OCR aplicado)."
    },
    "cronograma": [
        "✅ Ene 2024 — Inicio del proyecto (contrato_erp.pdf)",
        "✅ Mar 2024 — Entrega Fase 1: Infraestructura (plan_proyecto.docx)",
        "✅ Jul 2024 — Entrega Fase 2: Módulo Financiero (plan_proyecto.docx)",
        "⏳ Ene 2025 — Entrega Fase 3: Módulo Nómina — EN RIESGO (acta_reunion_nov.docx)",
        "⏳ Mar 2025 — Go-Live final (plan_proyecto.docx)",
        "❓ Capacitación de usuarios — Mencionada en acta, sin fecha confirmada."
    ],
    "inconsistencias": [
        "[INCONSISTENCIA-01] contrato_erp.pdf indica que el PM es Juan Pérez, pero "
        "acta_reunion_nov.docx está firmada por María López como responsable del proyecto.",
        "[INCONSISTENCIA-02] presupuesto_2024.xlsx muestra un total de $450,000 USD, "
        "mientras que contrato_erp.pdf especifica $420,000 USD como monto contratado."
    ],
    "proximos_pasos": [
        "Definir nuevo calendario para el módulo de nómina — Responsable: PM / Antes: 30/11/2024.",
        "Clarificar responsable oficial del proyecto (Juan Pérez vs. María López).",
        "Programar sesión de capacitación de usuarios — Fecha pendiente de confirmar.",
        "Reconciliar diferencia presupuestaria de $30,000 USD entre contrato y presupuesto."
    ],
    "puntos_ciegos": [],
    "riesgos": [
        "Retraso en módulo de nómina que impacta la fecha de Go-Live.",
        "Ambigüedad en responsable del proyecto (dos nombres distintos en documentos)."
    ]
}
```

---

## Notas de Instalación y Compatibilidad

- `tesseract-ocr-spa` agrega soporte para texto en español en imágenes.
- Si `pytesseract` no está disponible, las imágenes se registran como punto ciego
  con el mensaje `[OCR_NO_DISPONIBLE]`.
- Para archivos `.csv`: úsalos con `pandas` o `csv.reader` como alternativa a openpyxl.
- Para archivos `.msg` (correos Outlook): requiere `extract-msg` (pip install extract-msg).
- El PDF generado usa fuentes estándar ReportLab (Helvetica). Para fuentes personalizadas,
  registra TTF con `reportlab.pdfbase.ttfonts`.
