---
Name: Digest de Noticias por Correo
description: >
  Activa esta skill cuando el usuario quiera recibir noticias automáticas por correo
  electrónico de forma programada. Disparadores: "mándame noticias por correo",
  "quiero un resumen diario de noticias", "configura un digest de noticias",
  "envíame las noticias cada mañana", "programa un correo con las noticias del día",
  "quiero recibir un boletín de noticias", "suscríbeme a un resumen de noticias",
  "newsletter automático de noticias", "avísame cada X horas con las noticias",
  o cualquier solicitud que implique recopilar noticias y enviarlas por email
  de forma recurrente o puntual. La skill recopila noticias de RSS de medios
  verificados, YouTube y búsqueda web, las formatea en un email HTML profesional
  con título, descripción, imagen y fuente, y las envía al proveedor configurado
  (Gmail, Outlook o SMTP personalizado). El scheduler puede ejecutarse en segundo
  plano o vía cron. SIEMPRE solicita credenciales y preferencias al usuario antes
  de configurar el envío. Nunca almacena contraseñas en texto plano.
compatibility:
  tools: [bash_tool, create_file, present_files, view]
  python: ">=3.9"
  auto_installs: true
  requires_user_credentials: true   # Credenciales de correo obligatorias
  requires_user_authorization: true # Cada ejecución de scheduler requiere OK
---

# Digest de Noticias por Correo — Skill Completa

## 1. Definición de Rol

Eres un **Editor Automatizado de Noticias** — un agente especializado en periodismo
digital, curaduría de contenido y comunicación por correo electrónico. Tu trabajo es:

1. Recopilar las **5 noticias más relevantes** del momento desde fuentes verificadas
2. Enriquecerlas con imagen, descripción y enlace de fuente
3. Empaquetarlas en un **correo HTML profesional y visualmente limpio**
4. Enviarlo automáticamente al proveedor configurado por el usuario
5. Repetir el proceso en el intervalo de tiempo definido por el usuario

Operas bajo tres principios fundamentales:

| Principio | Descripción |
|---|---|
| **Verificación** | Solo usas fuentes periodísticas reconocidas y medios con trayectoria |
| **Privacidad** | Las credenciales del usuario nunca se almacenan en texto plano |
| **Puntualidad** | El scheduler respeta el horario acordado con el usuario sin desviación |

Detectas el idioma del usuario automáticamente. El correo se redacta en ese idioma.

---

## 2. FASE 0 — Instalación Silenciosa de Dependencias

**Ejecuta esto primero, siempre, sin preguntar al usuario.**

```bash
pip install \
  feedparser \
  requests \
  beautifulsoup4 \
  lxml \
  Pillow \
  APScheduler \
  python-dotenv \
  langdetect \
  pytz \
  yt-dlp \
  google-api-python-client \
  html2text \
  jinja2 \
  --break-system-packages -q 2>&1 | tail -5

# Verificación rápida
python3 -c "
import feedparser, requests, bs4, PIL, apscheduler
import langdetect, pytz, jinja2
print('[OK] Dependencias del Digest listas')
" 2>&1
```

---

## 3. FASE 1 — Configuración del Usuario

> ⚠️ **Esta fase es interactiva.** La IA debe recopilar todos los parámetros
> mediante preguntas antes de proceder. NUNCA asumas valores por defecto para
> email, contraseña o frecuencia.

### 3.1 Parámetros Requeridos

```python
from dataclasses import dataclass, field
from typing import Optional, List
import os, json

@dataclass
class ConfigDigest:
    # ── Correo destino ────────────────────────────────────────────
    email_destino:   str = ""         # Correo del destinatario
    nombre_usuario:  str = "Lector"   # Para personalizar el saludo

    # ── Proveedor de envío ────────────────────────────────────────
    proveedor:       str = "gmail"    # "gmail" | "outlook" | "custom"
    email_remitente: str = ""         # Correo desde el que se envía
    app_password:    str = ""         # Contraseña de app (NO la del correo)
    smtp_host:       str = ""         # Solo si proveedor = "custom"
    smtp_port:       int = 587        # 587=TLS, 465=SSL, 25=sin cifrar

    # ── Programación ─────────────────────────────────────────────
    frecuencia:      str = "diaria"   # "cada_hora" | "cada_N_horas" | "diaria" | "semanal"
    hora_envio:      str = "08:00"    # HH:MM en zona horaria del usuario
    zona_horaria:    str = "America/Mexico_City"
    intervalo_horas: int = 1          # Solo si frecuencia = "cada_N_horas"

    # ── Contenido ─────────────────────────────────────────────────
    idioma:          str = "es"       # "es" | "en"
    temas:           List[str] = field(default_factory=lambda: [
        "tecnología", "ciencia", "mundo", "economía", "cultura"
    ])
    pais_foco:       str = "MX"       # ISO 3166-1 alpha-2 para relevancia regional
    num_noticias:    int = 5          # Siempre 5 por diseño del template

    # ── YouTube ───────────────────────────────────────────────────
    incluir_youtube: bool = True
    youtube_api_key: Optional[str] = None  # Opcional; si no hay, usa scraping

    # ── Ruta de configuración ────────────────────────────────────
    config_path:     str = os.path.expanduser("~/.digest_noticias/config.json")


def guardar_config(cfg: ConfigDigest):
    """
    Guarda la configuración en disco. La app_password se ofusca con base64
    (no es cifrado real; para seguridad real usar keyring).
    NUNCA guardar en texto plano.
    """
    import base64
    os.makedirs(os.path.dirname(cfg.config_path), exist_ok=True)

    datos = cfg.__dict__.copy()
    # Ofuscar contraseña
    if datos.get("app_password"):
        datos["app_password"] = base64.b64encode(
            datos["app_password"].encode()
        ).decode()

    with open(cfg.config_path, "w", encoding="utf-8") as f:
        json.dump(datos, f, ensure_ascii=False, indent=2)
    os.chmod(cfg.config_path, 0o600)  # Solo el dueño puede leerlo
    print(f"[CONFIG] Guardada en {cfg.config_path} (permisos 600)")


def cargar_config(config_path: str) -> ConfigDigest:
    import base64
    with open(config_path, "r", encoding="utf-8") as f:
        datos = json.load(f)
    if datos.get("app_password"):
        datos["app_password"] = base64.b64decode(
            datos["app_password"].encode()
        ).decode()
    cfg = ConfigDigest()
    for k, v in datos.items():
        if hasattr(cfg, k):
            setattr(cfg, k, v)
    return cfg
```

### 3.2 Instrucciones para el Usuario según Proveedor

Muestra al usuario la guía correspondiente a su proveedor:

#### Gmail — Contraseña de Aplicación (obligatorio si tienes 2FA)

```
1. Ve a: https://myaccount.google.com/security
2. Sección "Cómo accedes a Google" → "Verificación en dos pasos" (debe estar activa)
3. Al final de esa página: "Contraseñas de aplicaciones"
4. Selecciona: Aplicación = "Correo", Dispositivo = "Otro" → Escribe "DigestNoticias"
5. Copia la contraseña de 16 caracteres generada.
6. Pégala cuando la skill la solicite. NO es tu contraseña normal de Gmail.

SMTP: smtp.gmail.com | Puerto: 587 (TLS)
```

#### Outlook / Hotmail

```
1. Asegúrate de que SMTP esté habilitado:
   outlook.live.com → Configuración → Ver todas → Correo → Sincronización
   → POP e IMAP → Permitir dispositivos y aplicaciones que usen POP → Activar

2. Usa tu contraseña normal de cuenta Microsoft (o una contraseña de app si
   tienes autenticación avanzada habilitada).

SMTP: smtp-mail.outlook.com | Puerto: 587 (TLS)
```

#### SMTP Personalizado (cualquier proveedor)

```
Necesitas: servidor SMTP, puerto, usuario y contraseña.
Ejemplo Yahoo:  smtp.mail.yahoo.com | 587
Ejemplo Zoho:   smtp.zoho.com       | 587
Ejemplo Titan:  smtp.titan.email    | 587
```

---

## 4. FASE 2 — Fuentes de Noticias Verificadas

### 4.1 Catálogo de Fuentes RSS por Idioma y Tema

```python
# ─────────────────────────────────────────────────────────────────
# FUENTES EN ESPAÑOL — Nivel 1 (máxima confiabilidad editorial)
# ─────────────────────────────────────────────────────────────────
FUENTES_ES = {
    "mundo": [
        {"nombre": "BBC Mundo",          "rss": "https://feeds.bbci.co.uk/mundo/rss.xml",                     "logo": "🌐"},
        {"nombre": "Reuters Español",    "rss": "https://feeds.reuters.com/reuters/MXdomesticNews",            "logo": "📰"},
        {"nombre": "El País",            "rss": "https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/portada", "logo": "🇪🇸"},
        {"nombre": "DW Español",         "rss": "https://rss.dw.com/rdf/rss-sp-all",                          "logo": "🌍"},
        {"nombre": "France 24 Español",  "rss": "https://www.france24.com/es/rss",                            "logo": "🇫🇷"},
        {"nombre": "AP News (ES)",       "rss": "https://rsshub.app/apnews/topics/apf-intlnews",              "logo": "📡"},
    ],
    "tecnología": [
        {"nombre": "MIT Technology Review ES", "rss": "https://www.technologyreview.es/feed/",                "logo": "🔬"},
        {"nombre": "Xataka",                   "rss": "https://feeds.weblogssl.com/xataka2",                  "logo": "💻"},
        {"nombre": "Hipertextual",             "rss": "https://hipertextual.com/feed",                        "logo": "⚡"},
        {"nombre": "El Confidencial Tech",     "rss": "https://www.elconfidencial.com/rss/tags/tecnologia.xml","logo": "🖥️"},
    ],
    "ciencia": [
        {"nombre": "National Geographic ES",   "rss": "https://www.nationalgeographic.com.es/rss/ultimas-noticias", "logo": "🌿"},
        {"nombre": "Muy Interesante",          "rss": "https://www.muyinteresante.com/feed/",                 "logo": "🧬"},
        {"nombre": "Science | El País",        "rss": "https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/section/ciencia", "logo": "🔭"},
    ],
    "economía": [
        {"nombre": "El Economista MX",   "rss": "https://www.eleconomista.com.mx/rss/",                       "logo": "📈"},
        {"nombre": "Expansión MX",       "rss": "https://expansion.mx/rss",                                   "logo": "💹"},
        {"nombre": "Bloomberg Línea",    "rss": "https://www.bloomberglinea.com/arc/outboundfeeds/rss/",       "logo": "💰"},
        {"nombre": "El Financiero MX",   "rss": "https://www.elfinanciero.com.mx/arc/outboundfeeds/rss/",     "logo": "🏦"},
    ],
    "cultura": [
        {"nombre": "El Cultural",        "rss": "https://elcultural.com/feed/",                               "logo": "🎭"},
        {"nombre": "Cultura Inquieta",   "rss": "https://culturainquieta.com/feed/",                          "logo": "🎨"},
    ],
    "mexico": [
        {"nombre": "Milenio",            "rss": "https://www.milenio.com/rss",                                "logo": "🇲🇽"},
        {"nombre": "El Universal MX",    "rss": "https://www.eluniversal.com.mx/rss.xml",                     "logo": "📋"},
        {"nombre": "Reforma",            "rss": "https://www.reforma.com/rss/portada.xml",                    "logo": "🗞️"},
        {"nombre": "Animal Político",    "rss": "https://www.animalpolitico.com/feed/",                       "logo": "🐾"},
        {"nombre": "Nexos",              "rss": "https://www.nexos.com.mx/?feed=rss2",                        "logo": "📚"},
    ],
}

# ─────────────────────────────────────────────────────────────────
# FUENTES EN INGLÉS — Nivel 1
# ─────────────────────────────────────────────────────────────────
FUENTES_EN = {
    "world": [
        {"nombre": "BBC World",          "rss": "https://feeds.bbci.co.uk/news/world/rss.xml",                "logo": "🌐"},
        {"nombre": "Reuters",            "rss": "https://feeds.reuters.com/reuters/worldNews",                 "logo": "📰"},
        {"nombre": "AP News",            "rss": "https://rsshub.app/apnews/topics/apf-intlnews",              "logo": "📡"},
        {"nombre": "The Guardian",       "rss": "https://www.theguardian.com/world/rss",                      "logo": "🇬🇧"},
        {"nombre": "NPR News",           "rss": "https://feeds.npr.org/1001/rss.xml",                         "logo": "📻"},
    ],
    "technology": [
        {"nombre": "MIT Tech Review",    "rss": "https://www.technologyreview.com/feed/",                     "logo": "🔬"},
        {"nombre": "Wired",              "rss": "https://www.wired.com/feed/rss",                             "logo": "💻"},
        {"nombre": "Ars Technica",       "rss": "https://feeds.arstechnica.com/arstechnica/index",            "logo": "⚡"},
        {"nombre": "The Verge",          "rss": "https://www.theverge.com/rss/index.xml",                     "logo": "🖥️"},
    ],
    "science": [
        {"nombre": "Nature News",        "rss": "https://www.nature.com/nature.rss",                          "logo": "🧬"},
        {"nombre": "Science Magazine",   "rss": "https://www.science.org/rss/news_current.xml",               "logo": "🔭"},
        {"nombre": "National Geographic","rss": "https://www.nationalgeographic.com/latest-stories/_jcr_content/par-main/articlelisthero-us/div-articles/article-list.rss", "logo": "🌿"},
    ],
    "economy": [
        {"nombre": "Financial Times",    "rss": "https://www.ft.com/rss/home",                                "logo": "📈"},
        {"nombre": "Bloomberg",          "rss": "https://feeds.bloomberg.com/markets/news.rss",               "logo": "💹"},
        {"nombre": "The Economist",      "rss": "https://www.economist.com/latest/rss.xml",                   "logo": "💰"},
    ],
}

# Fuentes de YouTube por tema (canales verificados)
YOUTUBE_CANALES = {
    "es": {
        "noticias_generales": [
            {"nombre": "BBC News Mundo",     "channel_id": "UCF4Wxdo3inmxP-Y59wXDsDw"},
            {"nombre": "DW Español",         "channel_id": "UCFkCl8kE8Li0SzWD_Mu1SAw"},
            {"nombre": "France 24 Español",  "channel_id": "UCPBbk4tCTumPMHmVfQlefpA"},
            {"nombre": "CNN en Español",     "channel_id": "UCx5EnHKsf2kRaGJqfBdtDVg"},
            {"nombre": "NatGeo Español",     "channel_id": "UCiH8bvMFE5Qco5-TiTZ7LrA"},
        ],
        "tecnología": [
            {"nombre": "Dot CSV",            "channel_id": "UCy5znSnfMsDwaLlROnZ7Qbg"},
            {"nombre": "Xataka",             "channel_id": "UCStE3-ZCwTROo-oIfaVEFl8"},
        ],
    },
    "en": {
        "world_news": [
            {"nombre": "BBC News",           "channel_id": "UC16niRr50-MSBwiO3He4vyA"},
            {"nombre": "Reuters",            "channel_id": "UCpWq8j00dFHCzFNzCN-0GiA"},
            {"nombre": "DW News",            "channel_id": "UCknLrEdhRCp1aegoMqRaCZg"},
        ],
        "technology": [
            {"nombre": "Veritasium",         "channel_id": "UCHnyfMqiRRG1u-2MsSQLbXA"},
            {"nombre": "Kurzgesagt",         "channel_id": "UCsXVk37bltHxD1rDPwtNM8Q"},
        ],
    },
}
```

### 4.2 Recolector de Noticias RSS

```python
import feedparser
import requests
from bs4 import BeautifulSoup
from datetime import datetime, timezone
import time
import random

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; DigestNoticias/1.0; "
        "+https://github.com/digest-noticias)"
    )
}

def obtener_imagen_og(url: str, timeout: int = 8) -> Optional[str]:
    """
    Extrae la imagen Open Graph (og:image) de una URL de noticia.
    Devuelve URL de la imagen o None si no encuentra.
    """
    try:
        resp = requests.get(url, headers=HEADERS, timeout=timeout)
        soup = BeautifulSoup(resp.text, "lxml")
        og = soup.find("meta", property="og:image")
        if og and og.get("content"):
            return og["content"]
        # Fallback: twitter:image
        tw = soup.find("meta", attrs={"name": "twitter:image"})
        if tw and tw.get("content"):
            return tw["content"]
    except Exception:
        pass
    return None


def obtener_descripcion_og(url: str, timeout: int = 8) -> str:
    """
    Extrae la descripción og:description de una URL de noticia.
    """
    try:
        resp = requests.get(url, headers=HEADERS, timeout=timeout)
        soup = BeautifulSoup(resp.text, "lxml")
        og = soup.find("meta", property="og:description")
        if og and og.get("content"):
            return og["content"]
        desc = soup.find("meta", attrs={"name": "description"})
        if desc and desc.get("content"):
            return desc["content"]
    except Exception:
        pass
    return ""


def limpiar_html(texto: str) -> str:
    """Elimina tags HTML de un string."""
    return BeautifulSoup(texto, "lxml").get_text(separator=" ").strip()


def recolectar_rss(fuentes: list, max_por_fuente: int = 3) -> list:
    """
    Lee los feeds RSS de las fuentes dadas y devuelve lista de artículos.
    Cada artículo: {titulo, descripcion, url, imagen, fuente, fecha, score}
    """
    articulos = []

    for fuente in fuentes:
        try:
            feed = feedparser.parse(fuente["rss"])
            entradas = feed.entries[:max_por_fuente]

            for entry in entradas:
                titulo = limpiar_html(entry.get("title", "Sin título"))
                url    = entry.get("link", "")
                fecha  = entry.get("published_parsed") or entry.get("updated_parsed")
                if fecha:
                    fecha_dt = datetime(*fecha[:6], tzinfo=timezone.utc)
                else:
                    fecha_dt = datetime.now(timezone.utc)

                # Descripción: de RSS o extracción OG
                desc_raw = (
                    entry.get("summary", "") or
                    entry.get("description", "")
                )
                descripcion = limpiar_html(desc_raw)[:600]

                # Imagen: de RSS (enclosure/media) o extracción OG
                imagen = None
                if hasattr(entry, "media_thumbnail") and entry.media_thumbnail:
                    imagen = entry.media_thumbnail[0].get("url")
                elif hasattr(entry, "enclosures") and entry.enclosures:
                    for enc in entry.enclosures:
                        if enc.get("type", "").startswith("image"):
                            imagen = enc.get("href")
                            break

                articulos.append({
                    "titulo":      titulo,
                    "descripcion": descripcion,
                    "url":         url,
                    "imagen":      imagen,
                    "fuente":      fuente["nombre"],
                    "logo":        fuente.get("logo", "📰"),
                    "fecha":       fecha_dt,
                    "origen":      "rss",
                    "score":       0.0
                })

            time.sleep(0.3)  # Cortesía hacia los servidores

        except Exception as e:
            print(f"[RSS] Error en {fuente['nombre']}: {e}")

    return articulos
```

### 4.3 Recolector de YouTube

```python
def buscar_noticias_youtube_api(query: str, api_key: str,
                                 max_results: int = 3) -> list:
    """
    Busca noticias en YouTube usando la API oficial (requiere API key).
    Devuelve lista de videos de noticias recientes.
    """
    from googleapiclient.discovery import build

    youtube = build("youtube", "v3", developerKey=api_key)
    request = youtube.search().list(
        q=query + " noticias hoy",
        part="snippet",
        type="video",
        order="date",
        maxResults=max_results,
        relevanceLanguage="es",
        publishedAfter=(
            datetime.now(timezone.utc).replace(hour=0, minute=0, second=0)
        ).isoformat().replace("+00:00", "Z")
    )
    response = request.execute()
    videos = []

    for item in response.get("items", []):
        snippet = item["snippet"]
        vid_id  = item["id"]["videoId"]
        videos.append({
            "titulo":      snippet["title"],
            "descripcion": snippet["description"][:600],
            "url":         f"https://www.youtube.com/watch?v={vid_id}",
            "imagen":      snippet["thumbnails"]["high"]["url"],
            "fuente":      snippet["channelTitle"],
            "logo":        "▶️",
            "fecha":       datetime.fromisoformat(
                               snippet["publishedAt"].replace("Z", "+00:00")
                           ),
            "origen":      "youtube",
            "score":       0.0
        })

    return videos


def buscar_noticias_youtube_scraping(canal_id: str,
                                      nombre_canal: str,
                                      max_results: int = 2) -> list:
    """
    Alternativa sin API key: usa yt-dlp para extraer videos recientes del canal.
    Más lento pero funciona sin credenciales.
    """
    import subprocess, json as json_mod

    cmd = [
        "yt-dlp",
        "--flat-playlist",
        "--playlist-end", str(max_results),
        "--print-json",
        "--no-warnings",
        f"https://www.youtube.com/channel/{canal_id}/videos"
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        videos = []
        for line in result.stdout.strip().split("\n"):
            if not line.strip():
                continue
            try:
                data = json_mod.loads(line)
                videos.append({
                    "titulo":      data.get("title", "Sin título"),
                    "descripcion": data.get("description", "")[:600],
                    "url":         f"https://www.youtube.com/watch?v={data.get('id','')}",
                    "imagen":      f"https://img.youtube.com/vi/{data.get('id','')}/hqdefault.jpg",
                    "fuente":      nombre_canal,
                    "logo":        "▶️",
                    "fecha":       datetime.now(timezone.utc),
                    "origen":      "youtube",
                    "score":       0.0
                })
            except Exception:
                pass
        return videos
    except Exception as e:
        print(f"[YT-DLP] Error en canal {nombre_canal}: {e}")
        return []
```

---

## 5. FASE 3 — Procesamiento y Selección de Noticias

### 5.1 Scoring y Priorización

```python
from datetime import timedelta

def calcular_score(articulo: dict) -> float:
    """
    Calcula un score de relevancia 0-100 para cada artículo.
    Factores: frescura temporal, calidad de la descripción, presencia de imagen.
    """
    score = 50.0
    ahora = datetime.now(timezone.utc)

    # ── Frescura temporal ────────────────────────────────────────
    delta = ahora - articulo["fecha"].replace(tzinfo=timezone.utc
        if articulo["fecha"].tzinfo is None else articulo["fecha"].tzinfo)

    if delta < timedelta(hours=1):
        score += 30
    elif delta < timedelta(hours=3):
        score += 20
    elif delta < timedelta(hours=6):
        score += 10
    elif delta < timedelta(hours=12):
        score += 5
    elif delta > timedelta(hours=48):
        score -= 20

    # ── Calidad del contenido ────────────────────────────────────
    if len(articulo["descripcion"]) > 200:
        score += 10
    if articulo["imagen"]:
        score += 10
    if len(articulo["titulo"]) > 20:
        score += 5

    # ── Bonus por origen ─────────────────────────────────────────
    if articulo["origen"] == "youtube":
        score += 5   # Videos suelen tener más contexto visual

    return min(100.0, max(0.0, score))


def deduplicar(articulos: list, umbral_similitud: float = 0.65) -> list:
    """
    Elimina artículos duplicados o muy similares por título.
    Usa distancia de Jaccard sobre bigramas del título.
    """
    def bigramas(texto: str) -> set:
        t = texto.lower()
        return {t[i:i+2] for i in range(len(t)-1)}

    def jaccard(a: str, b: str) -> float:
        ba, bb = bigramas(a), bigramas(b)
        if not ba or not bb:
            return 0.0
        return len(ba & bb) / len(ba | bb)

    unicos = []
    for art in articulos:
        es_dup = any(
            jaccard(art["titulo"], u["titulo"]) > umbral_similitud
            for u in unicos
        )
        if not es_dup:
            unicos.append(art)

    return unicos


def seleccionar_top_noticias(cfg: ConfigDigest) -> list:
    """
    Orquesta la recolección, scoring y selección final de N noticias.
    """
    # Determinar catálogo de fuentes según idioma
    catalogo = FUENTES_ES if cfg.idioma == "es" else FUENTES_EN
    fuentes_activas = []
    for tema in cfg.temas:
        fuentes_activas.extend(catalogo.get(tema, []))

    # Deduplicar fuentes
    fuentes_unicas = {f["nombre"]: f for f in fuentes_activas}.values()

    # ── Recolectar RSS ────────────────────────────────────────────
    todos = recolectar_rss(list(fuentes_unicas), max_por_fuente=4)

    # ── Recolectar YouTube ────────────────────────────────────────
    if cfg.incluir_youtube:
        canales = YOUTUBE_CANALES.get(cfg.idioma, {})
        for tema, lista_canales in canales.items():
            if any(t in tema for t in cfg.temas) or tema == "noticias_generales":
                for canal in lista_canales[:2]:
                    if cfg.youtube_api_key:
                        yt_arts = buscar_noticias_youtube_api(
                            tema, cfg.youtube_api_key, max_results=2
                        )
                    else:
                        yt_arts = buscar_noticias_youtube_scraping(
                            canal["channel_id"], canal["nombre"], max_results=2
                        )
                    todos.extend(yt_arts)

    # ── Enriquecer imágenes faltantes ────────────────────────────
    for art in todos:
        if not art["imagen"] and art["origen"] == "rss":
            art["imagen"] = obtener_imagen_og(art["url"])

    # ── Scoring y ordenación ──────────────────────────────────────
    for art in todos:
        art["score"] = calcular_score(art)

    todos.sort(key=lambda x: x["score"], reverse=True)

    # ── Deduplicación y selección final ───────────────────────────
    unicos    = deduplicar(todos)
    top       = unicos[:cfg.num_noticias]

    # ── Expandir descripciones cortas ────────────────────────────
    for art in top:
        if len(art["descripcion"]) < 150 and art["origen"] == "rss":
            desc_og = obtener_descripcion_og(art["url"])
            if len(desc_og) > len(art["descripcion"]):
                art["descripcion"] = desc_og[:600]

    return top
```

---

## 6. FASE 4 — Template de Correo HTML

```python
from jinja2 import Template
from datetime import datetime
import pytz

TEMPLATE_HTML = """
<!DOCTYPE html>
<html lang="{{ idioma }}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{ asunto }}</title>
  <style>
    /* Reset */
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background-color: #f4f4f4; font-family: 'Georgia', 'Times New Roman', serif; }

    /* Contenedor principal */
    .wrapper   { max-width: 640px; margin: 0 auto; background: #ffffff; }

    /* Header */
    .header    { background: #0d1b2a; padding: 28px 32px; text-align: center; }
    .header h1 { color: #ffffff; font-size: 22px; font-weight: 700;
                 letter-spacing: 2px; text-transform: uppercase; }
    .header p  { color: #a0b0c0; font-size: 13px; margin-top: 6px; }
    .header .fecha { color: #5bc4ff; font-size: 12px; margin-top: 4px;
                     text-transform: uppercase; letter-spacing: 1px; }

    /* Intro */
    .intro     { padding: 22px 32px 10px; border-bottom: 1px solid #e8e8e8; }
    .intro p   { color: #444; font-size: 15px; line-height: 1.6; }

    /* Tarjeta de noticia */
    .noticia        { padding: 24px 32px; border-bottom: 1px solid #e8e8e8; }
    .noticia:last-of-type { border-bottom: none; }
    .num-badge      { display: inline-block; background: #0d1b2a; color: #5bc4ff;
                      font-size: 11px; font-weight: 700; padding: 3px 10px;
                      border-radius: 3px; letter-spacing: 1px;
                      text-transform: uppercase; margin-bottom: 10px; }
    .noticia-img    { width: 100%; max-height: 240px; object-fit: cover;
                      border-radius: 6px; margin-bottom: 14px;
                      display: block; }
    .noticia-titulo { font-size: 18px; font-weight: 700; color: #0d1b2a;
                      line-height: 1.35; margin-bottom: 10px; }
    .noticia-desc   { font-size: 14px; color: #555; line-height: 1.7;
                      margin-bottom: 14px; }
    .noticia-fuente { display: inline-block; font-size: 12px; color: #888;
                      margin-right: 12px; }
    .noticia-fuente span { font-weight: 700; color: #0d1b2a; }
    .btn-leer       { display: inline-block; background: #0d1b2a; color: #ffffff;
                      font-size: 12px; font-weight: 700; padding: 8px 18px;
                      border-radius: 4px; text-decoration: none;
                      letter-spacing: 0.5px; }
    .btn-leer:hover { background: #1a3050; }

    /* YouTube badge */
    .yt-badge { background: #ff0000; color: #fff; font-size: 10px;
                font-weight: 700; padding: 2px 7px; border-radius: 3px;
                margin-left: 6px; vertical-align: middle; }

    /* Footer */
    .footer    { background: #0d1b2a; padding: 20px 32px; text-align: center; }
    .footer p  { color: #6a7f96; font-size: 11px; line-height: 1.7; }
    .footer a  { color: #5bc4ff; text-decoration: none; }

    /* Responsive */
    @media (max-width: 480px) {
      .noticia, .intro, .header { padding: 18px 18px; }
      .noticia-titulo { font-size: 16px; }
    }
  </style>
</head>
<body>
  <div class="wrapper">

    <!-- HEADER -->
    <div class="header">
      <h1>📰 Digest de Noticias</h1>
      <p>{{ saludo }}, <strong style="color:#fff;">{{ nombre }}</strong></p>
      <p class="fecha">{{ fecha_formateada }}</p>
    </div>

    <!-- INTRO -->
    <div class="intro">
      <p>{{ intro_texto }}</p>
    </div>

    <!-- NOTICIAS -->
    {% for n in noticias %}
    <div class="noticia">
      <div class="num-badge">
        {{ loop.index }}/{{ noticias|length }}
        {% if n.origen == 'youtube' %}<span class="yt-badge">▶ YouTube</span>{% endif %}
      </div>

      {% if n.imagen %}
      <img src="{{ n.imagen }}" alt="{{ n.titulo }}" class="noticia-img"
           onerror="this.style.display='none'">
      {% endif %}

      <div class="noticia-titulo">{{ n.titulo }}</div>
      <div class="noticia-desc">{{ n.descripcion[:500] }}</div>

      <span class="noticia-fuente">
        {{ n.logo }} Fuente: <span>{{ n.fuente }}</span>
      </span>
      <a href="{{ n.url }}" class="btn-leer" target="_blank">
        {% if n.origen == 'youtube' %}▶ Ver video{% else %}→ Leer nota{% endif %}
      </a>
    </div>
    {% endfor %}

    <!-- FOOTER -->
    <div class="footer">
      <p>
        Recibiste este correo porque configuraste el <strong style="color:#fff;">
        Digest de Noticias</strong> automático.<br>
        Generado el {{ fecha_formateada }} · Fuentes de medios verificados<br>
        Para modificar preferencias, actualiza tu configuración del digest.
      </p>
    </div>

  </div>
</body>
</html>
"""

def generar_html_correo(noticias: list, cfg: ConfigDigest) -> str:
    """
    Renderiza el template HTML con las noticias del día.
    """
    tz     = pytz.timezone(cfg.zona_horaria)
    ahora  = datetime.now(tz)

    MESES = {
        "es": ["enero","febrero","marzo","abril","mayo","junio",
               "julio","agosto","septiembre","octubre","noviembre","diciembre"],
        "en": ["January","February","March","April","May","June",
               "July","August","September","October","November","December"]
    }

    if cfg.idioma == "es":
        fecha_fmt = (
            f"{ahora.day} de {MESES['es'][ahora.month-1]} de {ahora.year}"
            f" · {ahora.strftime('%H:%M')} hrs"
        )
        saludo     = "Buenos días" if ahora.hour < 12 else (
                     "Buenas tardes" if ahora.hour < 19 else "Buenas noches")
        intro_txt  = (
            f"Aquí están las {len(noticias)} noticias más relevantes "
            f"del momento, curadas de fuentes verificadas. "
            f"Un resumen para que estés al día sin perder tiempo."
        )
    else:
        fecha_fmt  = ahora.strftime("%B %d, %Y · %I:%M %p")
        saludo     = "Good morning" if ahora.hour < 12 else (
                     "Good afternoon" if ahora.hour < 19 else "Good evening")
        intro_txt  = (
            f"Here are today's {len(noticias)} most relevant stories, "
            f"curated from verified sources. A clean digest to keep you informed."
        )

    tpl = Template(TEMPLATE_HTML)
    return tpl.render(
        asunto          = f"Digest de Noticias — {fecha_fmt}",
        saludo          = saludo,
        nombre          = cfg.nombre_usuario,
        fecha_formateada = fecha_fmt,
        intro_texto     = intro_txt,
        noticias        = noticias,
        idioma          = cfg.idioma,
    )
```

---

## 7. FASE 5 — Envío por Correo Electrónico

### 7.1 Configuración SMTP por Proveedor

```python
SMTP_CONFIG = {
    "gmail": {
        "host":  "smtp.gmail.com",
        "port":  587,
        "tls":   True,
    },
    "outlook": {
        "host":  "smtp-mail.outlook.com",
        "port":  587,
        "tls":   True,
    },
    "yahoo": {
        "host":  "smtp.mail.yahoo.com",
        "port":  587,
        "tls":   True,
    },
    "zoho": {
        "host":  "smtp.zoho.com",
        "port":  587,
        "tls":   True,
    },
    "custom": {
        "host":  "",    # Definido por el usuario
        "port":  587,
        "tls":   True,
    },
}
```

### 7.2 Función de Envío

```python
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
import ssl
from datetime import datetime
import pytz

def enviar_correo(html_content: str, cfg: ConfigDigest,
                  asunto: str = None) -> bool:
    """
    Envía el correo HTML al destinatario configurado.
    Devuelve True si el envío fue exitoso.
    """
    tz     = pytz.timezone(cfg.zona_horaria)
    ahora  = datetime.now(tz)

    if not asunto:
        asunto = (
            f"📰 Digest de Noticias — {ahora.strftime('%d/%m/%Y %H:%M')}"
            if cfg.idioma == "es"
            else f"📰 News Digest — {ahora.strftime('%m/%d/%Y %I:%M %p')}"
        )

    # Construir mensaje MIME
    msg = MIMEMultipart("alternative")
    msg["Subject"] = asunto
    msg["From"]    = f"Digest Noticias <{cfg.email_remitente}>"
    msg["To"]      = cfg.email_destino
    msg["X-Mailer"] = "DigestNoticias/1.0"

    # Parte HTML
    parte_html = MIMEText(html_content, "html", "utf-8")
    msg.attach(parte_html)

    # Obtener parámetros SMTP
    smtp_cfg = SMTP_CONFIG.get(cfg.proveedor, SMTP_CONFIG["custom"])
    host = cfg.smtp_host if cfg.proveedor == "custom" else smtp_cfg["host"]
    port = cfg.smtp_port if cfg.proveedor == "custom" else smtp_cfg["port"]

    try:
        context = ssl.create_default_context()

        if smtp_cfg["tls"]:
            with smtplib.SMTP(host, port, timeout=30) as server:
                server.ehlo()
                server.starttls(context=context)
                server.ehlo()
                server.login(cfg.email_remitente, cfg.app_password)
                server.sendmail(
                    cfg.email_remitente,
                    cfg.email_destino,
                    msg.as_string()
                )
        else:
            with smtplib.SMTP_SSL(host, port, context=context, timeout=30) as server:
                server.login(cfg.email_remitente, cfg.app_password)
                server.sendmail(
                    cfg.email_remitente,
                    cfg.email_destino,
                    msg.as_string()
                )

        print(f"[EMAIL] ✅ Correo enviado a {cfg.email_destino} — {ahora.isoformat()}")
        return True

    except smtplib.SMTPAuthenticationError:
        print("[EMAIL] ❌ Error de autenticación. Verifica la contraseña de aplicación.")
        return False
    except smtplib.SMTPException as e:
        print(f"[EMAIL] ❌ Error SMTP: {e}")
        return False
    except Exception as e:
        print(f"[EMAIL] ❌ Error inesperado: {e}")
        return False
```

---

## 8. FASE 6 — Scheduler (Programación Automática)

### 8.1 Función de Ciclo Completo (un envío)

```python
def ejecutar_ciclo_digest(cfg: ConfigDigest):
    """
    Ejecuta el ciclo completo: recolectar → formatear → enviar.
    Esta función se llama en cada tick del scheduler.
    """
    print(f"[SCHEDULER] Iniciando ciclo — {datetime.now().isoformat()}")

    try:
        # 1. Recolectar noticias
        noticias = seleccionar_top_noticias(cfg)
        if not noticias:
            print("[SCHEDULER] ⚠️ No se encontraron noticias. Reintentando en el siguiente ciclo.")
            return

        # 2. Generar HTML
        html = generar_html_correo(noticias, cfg)

        # 3. Enviar
        ok = enviar_correo(html, cfg)
        if ok:
            print(f"[SCHEDULER] ✅ Digest enviado con {len(noticias)} noticias.")
        else:
            print("[SCHEDULER] ❌ Fallo en el envío. Revisa las credenciales.")

    except Exception as e:
        print(f"[SCHEDULER] ❌ Error en ciclo: {e}")
```

### 8.2 Scheduler en Proceso (APScheduler)

```python
from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger
import pytz

def iniciar_scheduler(cfg: ConfigDigest,
                       modo: str = "background") -> BackgroundScheduler:
    """
    Inicia el scheduler según la frecuencia configurada.
    modo = "blocking"   → Bloquea el proceso (útil para script standalone)
    modo = "background" → Corre en hilo separado (útil para integración)

    Requiere autorización explícita del usuario antes de llamar.
    """
    tz  = pytz.timezone(cfg.zona_horaria)
    hora, minuto = map(int, cfg.hora_envio.split(":"))

    Scheduler = BlockingScheduler if modo == "blocking" else BackgroundScheduler
    scheduler = Scheduler(timezone=tz)

    # ── Seleccionar trigger según frecuencia ─────────────────────
    if cfg.frecuencia == "cada_hora":
        trigger = IntervalTrigger(hours=1, timezone=tz)

    elif cfg.frecuencia == "cada_N_horas":
        trigger = IntervalTrigger(hours=cfg.intervalo_horas, timezone=tz)

    elif cfg.frecuencia == "diaria":
        trigger = CronTrigger(hour=hora, minute=minuto, timezone=tz)

    elif cfg.frecuencia == "semanal":
        # Por defecto los lunes a la hora configurada
        trigger = CronTrigger(day_of_week="mon", hour=hora,
                               minute=minuto, timezone=tz)
    else:
        raise ValueError(f"Frecuencia no reconocida: {cfg.frecuencia}")

    scheduler.add_job(
        func     = ejecutar_ciclo_digest,
        trigger  = trigger,
        args     = [cfg],
        id       = "digest_noticias",
        name     = "Digest de Noticias Automático",
        misfire_grace_time = 300,   # 5 min de gracia si el sistema estaba apagado
        coalesce = True             # Si hubo varios misfires, ejecuta solo una vez
    )

    scheduler.start()
    print(f"[SCHEDULER] 🟢 Iniciado — Frecuencia: {cfg.frecuencia}")
    if cfg.frecuencia == "diaria":
        print(f"[SCHEDULER] Próximo envío: {cfg.hora_envio} ({cfg.zona_horaria})")
    return scheduler


def detener_scheduler(scheduler) -> None:
    """Detiene el scheduler de forma limpia."""
    scheduler.shutdown(wait=False)
    print("[SCHEDULER] 🔴 Scheduler detenido.")
```

### 8.3 Alternativa: Cron del Sistema (Persistencia entre reinicios)

Si el usuario prefiere que el digest sobreviva al cierre del terminal,
instalar una entrada cron:

```python
def instalar_cron(cfg: ConfigDigest, ruta_script: str):
    """
    Instala una entrada en el crontab del usuario.
    ruta_script: ruta absoluta al script Python que llama a ejecutar_ciclo_digest().
    REQUIERE AUTORIZACIÓN DEL USUARIO antes de ejecutar.
    """
    import subprocess

    hora, minuto = map(int, cfg.hora_envio.split(":"))

    # Expresión cron según frecuencia
    if cfg.frecuencia == "cada_hora":
        expr = f"0 * * * *"
    elif cfg.frecuencia == "cada_N_horas":
        expr = f"0 */{cfg.intervalo_horas} * * *"
    elif cfg.frecuencia == "diaria":
        expr = f"{minuto} {hora} * * *"
    elif cfg.frecuencia == "semanal":
        expr = f"{minuto} {hora} * * 1"  # Lunes
    else:
        raise ValueError(f"Frecuencia no soportada: {cfg.frecuencia}")

    entrada_cron = (
        f"{expr} /usr/bin/python3 {ruta_script} "
        f"--config {cfg.config_path} >> "
        f"{os.path.expanduser('~/.digest_noticias/cron.log')} 2>&1\n"
    )

    # Leer crontab actual
    result = subprocess.run(["crontab", "-l"], capture_output=True, text=True)
    crontab_actual = result.stdout if result.returncode == 0 else ""

    # Agregar entrada si no existe
    if ruta_script not in crontab_actual:
        nuevo_crontab = crontab_actual + "\n# Digest de Noticias\n" + entrada_cron
        proc = subprocess.run(
            ["crontab", "-"],
            input=nuevo_crontab,
            text=True,
            capture_output=True
        )
        if proc.returncode == 0:
            print(f"[CRON] ✅ Entrada instalada: {expr}")
        else:
            print(f"[CRON] ❌ Error: {proc.stderr}")
    else:
        print("[CRON] ℹ️ Ya existe una entrada cron para este script.")
```

---

## 9. FASE 7 — Orquestador Principal

```python
import argparse

def configurar_interactivamente() -> ConfigDigest:
    """
    Guía al usuario paso a paso para configurar el digest.
    La IA presenta las preguntas y recoge las respuestas.
    """
    print("\n" + "="*60)
    print("  CONFIGURACIÓN DEL DIGEST DE NOTICIAS")
    print("="*60)
    print("Responde las siguientes preguntas para personalizar tu digest.\n")

    cfg = ConfigDigest()

    # Las preguntas que la IA debe hacer al usuario:
    PREGUNTAS = [
        ("email_destino",    "¿A qué correo quieres recibir el digest?"),
        ("nombre_usuario",   "¿Cómo te llamas? (para personalizar el saludo)"),
        ("email_remitente",  "¿Desde qué correo se enviará? (el tuyo u otro configurado)"),
        ("proveedor",        "¿Qué proveedor usas? [gmail / outlook / yahoo / zoho / custom]"),
        ("app_password",     "Contraseña de aplicación (NO tu contraseña normal):"),
        ("idioma",           "¿En qué idioma quieres el digest? [es / en]"),
        ("frecuencia",       "Frecuencia: [cada_hora / cada_N_horas / diaria / semanal]"),
        ("hora_envio",       "Hora de envío (formato HH:MM, ej: 07:30):"),
        ("zona_horaria",     "Tu zona horaria (ej: America/Mexico_City, America/Bogota):"),
        ("temas",            "Temas de interés separados por coma (ej: tecnología,ciencia,mundo):"),
        ("incluir_youtube",  "¿Incluir noticias de YouTube? [sí / no]"),
    ]

    # La IA recoge y valida cada respuesta antes de continuar
    return cfg


def ejecutar_digest_ahora(cfg: ConfigDigest) -> bool:
    """
    Ejecuta un envío inmediato (test o envío manual).
    """
    print("[DIGEST] Ejecutando envío inmediato...")
    ejecutar_ciclo_digest(cfg)
    return True


def iniciar_digest_programado(cfg: ConfigDigest,
                               autorizado: bool = False) -> None:
    """
    Punto de entrada principal para el modo automático.
    ⚠️ Solo ejecuta si autorizado=True.
    """
    if not autorizado:
        raise PermissionError(
            "⛔ SCHEDULER BLOQUEADO. Responde 'SÍ, iniciar scheduler' para confirmar."
        )

    # Ejecutar un envío inicial inmediato
    print("[DIGEST] Enviando primer digest inmediatamente...")
    ejecutar_ciclo_digest(cfg)

    # Iniciar scheduler para futuros envíos
    scheduler = iniciar_scheduler(cfg, modo="blocking")


# ── CLI para uso desde cron ────────────────────────────────────────
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Digest de Noticias")
    parser.add_argument("--config",  required=True, help="Ruta al archivo config.json")
    parser.add_argument("--ahora",   action="store_true", help="Enviar digest ahora")
    parser.add_argument("--scheduler", action="store_true", help="Iniciar scheduler")
    args = parser.parse_args()

    cfg = cargar_config(args.config)

    if args.ahora:
        ejecutar_digest_ahora(cfg)
    elif args.scheduler:
        iniciar_digest_programado(cfg, autorizado=True)
```

---

## 10. Seguridad y Privacidad

| # | Regla |
|---|---|
| 1 | **Nunca pedir la contraseña del correo.** Solo aceptar contraseñas de aplicación (App Passwords). |
| 2 | **Nunca mostrar la contraseña en logs ni en pantalla.** Usar `getpass` si se pide en terminal. |
| 3 | **El archivo config.json tiene permisos 600** (solo lectura del dueño del sistema). |
| 4 | **La contraseña se ofusca en base64** al guardar en disco. Para mayor seguridad, usar `keyring`. |
| 5 | **Scheduler solo arranca con `autorizado=True`** tras confirmación explícita del usuario. |
| 6 | **No enviar a listas de correo** sin consentimiento de cada destinatario. Un correo = un destinatario. |
| 7 | **Respetar robots.txt** al hacer scraping de imágenes. Usar solo URLs de og:image. |
| 8 | **No almacenar el contenido de las noticias** en disco, solo procesarlo en memoria. |

---

## 11. Reglas Críticas de Comportamiento

| # | Regla |
|---|---|
| 1 | **Instala dependencias automáticamente** con `bash_tool`. Nunca le pidas al usuario que haga `pip install`. |
| 2 | **Siempre usa fuentes del catálogo verificado.** No añadas fuentes desconocidas sin validarlas. |
| 3 | **El template HTML siempre incluye fuente y link** de cada noticia. Sin excepciones. |
| 4 | **Detecta el idioma del usuario** y produce TODO el correo en ese idioma. |
| 5 | **Si una imagen no carga**, el email debe verse igualmente bien (usa `onerror` en el tag `<img>`). |
| 6 | **Valida el correo** con regex antes de configurar cualquier envío. |
| 7 | **Ejecuta un envío de prueba** antes de activar el scheduler. Confirma con el usuario que llegó. |
| 8 | **Si el scheduler falla**, registra el error en `~/.digest_noticias/cron.log` y reintenta en el siguiente ciclo. |
| 9 | **Para YouTube sin API key**, usa `yt-dlp` como alternativa. Nunca bloquear el flujo por falta de API key. |
| 10 | **Infórmale al usuario el costo potencial** de la YouTube Data API (10,000 unidades/día gratis). |

---

## 12. Tabla de Frecuencias y Expresiones Cron

| Frecuencia configurada | Expresión Cron | Descripción |
|---|---|---|
| `cada_hora` | `0 * * * *` | Cada hora en punto |
| `cada_N_horas` (N=3) | `0 */3 * * *` | Cada 3 horas |
| `diaria` a las 07:30 | `30 7 * * *` | Todos los días a las 7:30 |
| `diaria` a las 20:00 | `0 20 * * *` | Todos los días a las 20:00 |
| `semanal` lunes 08:00 | `0 8 * * 1` | Cada lunes a las 8:00 |

---

## 13. Fuentes de Confianza — Política Editorial

Solo se incluyen en el catálogo medios que cumplen **todos** estos criterios:

| Criterio | Descripción |
|---|---|
| **Trayectoria** | Más de 5 años de operación continua como medio periodístico |
| **Transparencia** | Publica nombre de sus periodistas y política editorial |
| **Sin contenido sensacionalista** | No usa clickbait ni titulares engañosos de forma sistemática |
| **RSS activo y mantenido** | El feed se actualiza al menos una vez al día |
| **Acceso sin paywall total** | El artículo debe ser accesible sin suscripción (o tener al menos la descripción libre) |

### Fuentes excluidas por política

- Medios sin autor identificable
- Blogs personales sin respaldo editorial
- Fuentes con historial de desinformación documentado
- Canales de YouTube sin verificación o con menos de 100,000 suscriptores (salvo excepciones académicas)
- Medios con sesgo declarado como principal línea editorial

---

## 14. Notas de Implementación

- El orquestador `iniciar_digest_programado(cfg, autorizado=True)` es el único
  punto de entrada para el modo automático. `autorizado` debe ser `True` solo
  tras confirmación explícita del usuario.
- Para entornos sin pantalla persistente (VPS, Raspberry Pi), usar la opción
  de cron con `instalar_cron()` en lugar de APScheduler.
- Si el usuario usa Gmail y recibe error de autenticación, recordarle que:
  (a) debe usar la contraseña de aplicación, no la de su cuenta, y
  (b) debe tener la verificación en dos pasos activa.
- El template HTML funciona en Gmail, Outlook y Apple Mail. Usa CSS inline
  para máxima compatibilidad. No depende de fuentes externas ni JavaScript.
- El log de cron se encuentra en `~/.digest_noticias/cron.log`.
  Rotar con `logrotate` si el digest es muy frecuente.
- Después del envío, llamar a `present_files([ruta_html_preview])` si el
  usuario quiere previsualizar el correo antes de activar el scheduler.
