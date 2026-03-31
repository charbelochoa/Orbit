---
name: spotify
description: 'Cuándo usar: reproducir música, pausar, cambiar canción, ajustar volumen en Spotify, buscar artistas o playlists.'
metadata:
  orbit:
    emoji: 🎵
    category: comms
    tools: [open_app, computer_settings, browser_control, computer_control]
---
# Spotify

## Controles rápidos (Spotify ya abierto)

### Reproducción
```
computer_control { action: "key", key: "space" }           // play/pause
computer_control { action: "key", key: "ctrl+right" }      // siguiente canción
computer_control { action: "key", key: "ctrl+left" }       // canción anterior
computer_control { action: "key", key: "ctrl+shift+down" } // bajar volumen
computer_control { action: "key", key: "ctrl+shift+up" }   // subir volumen
```

### Volumen del sistema
```
computer_settings { action: "volume_set", value: 60 }
```

## Buscar y reproducir algo específico

### Patrón: reproducir artista/canción/playlist
1. `open_app { app_name: "spotify" }` — abrir Spotify (si no está abierto)
2. `computer_control { action: "key", key: "ctrl+l" }` — foco en barra de búsqueda
3. `computer_control { action: "type", text: "nombre del artista o canción" }` — escribir
4. `computer_control { action: "key", key: "return" }` — buscar
5. `click_element "primer resultado"` — click en el primer resultado relevante

## Spotify Web Player (alternativa)
```
browser_control { action: "go_to", url: "https://open.spotify.com" }
```
Luego interactúa con `click_element` para controlar.

## Reglas
- Los atajos de teclado solo funcionan si Spotify tiene el foco
- Si Spotify no responde, usa `click_element` para hacer click en el botón visualmente
- Para "pon música de X", usa la búsqueda y click en el primer resultado
- Para playlists, navega a la pestaña de playlists antes de buscar
