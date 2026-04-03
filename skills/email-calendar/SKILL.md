---
name: email-calendar
description: "Gestión de correo electrónico y calendario. Úsame cuando el usuario quiera revisar sus emails, ver eventos del día, programar reuniones, agendar citas, crear eventos, revisar su agenda, enviar correos o buscar en su bandeja de entrada."
---

# Skill: Email & Calendar Integration

## Flujos Principales

### 1. Ver agenda del día
```
Acción: Usar `calendar_check` con action="today"
Cuándo: "¿qué tengo hoy?", "mi agenda", "reuniones hoy", "citas de hoy"
Resultado: Lista de eventos con hora, título y ubicación
```

### 2. Ver semana
```
Acción: Usar `calendar_check` con action="week"
Cuándo: "agenda de la semana", "qué tengo esta semana", "próximas reuniones"
```

### 3. Revisar correo
```
Acción: Usar `email_read` con action="unread"
Cuándo: "tengo correos?", "mis emails sin leer", "revisa mi bandeja"
Opcional: maxCount=20 para ver más
```

### 4. Briefing completo
```
Acción: Usar `get_briefing` con type="morning"
Cuándo: "qué hay de nuevo?", "briefing del día", "ponme al día"
Combina: clima + calendario + correo + todos pendientes
```

### 5. Evening digest
```
Acción: Usar `get_briefing` con type="evening"
Cuándo: "resumen del día", "qué hice hoy?", "qué queda pendiente?"
Combina: todos + apps usadas + calendario de mañana
```

## Configuración Requerida

### Gmail
1. Ve a: https://developers.google.com/oauthplayground
2. Selecciona scope: `https://www.googleapis.com/auth/gmail.readonly`
3. Autoriza y obtén el Access Token
4. Añade a `.env`: `GMAIL_ACCESS_TOKEN=<token>`
> Nota: los tokens de Gmail expiran en 1 hora. Para uso persistente, configura OAuth2 con refresh token.

### Google Calendar
1. Ve a: https://developers.google.com/oauthplayground
2. Selecciona scope: `https://www.googleapis.com/auth/calendar.readonly`
3. Autoriza y obtén el Access Token
4. Añade a `.env`: `GOOGLE_CALENDAR_TOKEN=<token>`

### Microsoft Outlook (automático)
- Si tienes Outlook instalado, funciona sin configuración adicional.
- Orbit usa la COM automation de Windows para leer el calendario e inbox.

## Patrones de Uso

### Briefing matutino proactivo
```yaml
# config/orbit.yaml — añadir en proactive.schedules:
- id: morning-briefing
  cron: "0 9 * * 1-5"
  goal: "Presenta el briefing matutino completo: clima, calendario de hoy, correos sin leer y tareas pendientes"
  enabled: true
```

### Evening digest proactivo
```yaml
- id: evening-digest
  cron: "0 19 * * 1-5"
  goal: "Presenta el digest del día: resumen de actividad, tareas pendientes y agenda de mañana"
  enabled: true
```

## Notas
- `calendar_check` y `email_read` fallan silenciosamente si no hay integración configurada
- El briefing siempre produce output útil (clima + todos) aunque no haya email/calendario
- La flag `type="quick"` del briefing es ideal para interrupciones breves durante el trabajo
