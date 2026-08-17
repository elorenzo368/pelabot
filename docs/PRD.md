# PRD — Discord Music Bot Backend

## 1. Resumen

Construir un backend en Node.js que implemente un bot de Discord capaz de reproducir música en canales de voz a partir de:

- URLs de playlists de Spotify.
- URLs de playlists de YouTube.
- URLs de videos individuales de YouTube.
- Búsquedas de texto.

El bot deberá obtener los metadatos de las canciones, resolver una fuente de audio reproducible, administrar una cola por servidor de Discord y transmitir el audio al canal de voz donde se encuentra el usuario.

La primera versión será un servicio backend sin interfaz web.

## 2. Objetivo del producto

Permitir que un usuario dentro de un servidor de Discord pueda ejecutar:

```text
/play <url o búsqueda>
```

y que el bot:

1. Detecte el tipo de entrada.
2. Obtenga las canciones correspondientes.
3. Se conecte al canal de voz del usuario.
4. Cree una cola de reproducción.
5. Resuelva el audio reproducible de cada canción.
6. Reproduzca las canciones secuencialmente.
7. Permita controlar la reproducción mediante comandos de Discord.

## 3. Objetivos de la primera versión

La V1 deberá soportar:

### Spotify

- Playlist pública.
- Canción individual.
- Obtención de:
  - título
  - artista
  - duración
  - portada
  - posición dentro de la playlist

Spotify se utilizará únicamente como fuente de metadata.
El audio se resolverá utilizando otra fuente disponible.

### YouTube

- Video individual.
- Playlist.
- Búsqueda por texto.

### Discord Voice

El bot deberá poder:

- ingresar al canal de voz;
- transmitir audio;
- mantener conexión estable;
- avanzar automáticamente entre canciones;
- desconectarse cuando termina la cola o después de un período configurable de inactividad.

## 4. Fuera de alcance inicial

No forman parte de V1:

- dashboard web;
- cuentas de usuario externas;
- panel de administración;
- aplicación móvil;
- reproducción desde archivos locales;
- Apple Music;
- SoundCloud;
- Tidal;
- reproducción sincronizada entre varios servidores;
- recomendaciones mediante IA;
- sistema social de playlists;
- reproducción directa desde Spotify;
- almacenamiento permanente del audio.

Estas funcionalidades podrán incorporarse posteriormente.

## 5. Stack tecnológico

### Runtime

```text
Node.js
TypeScript
```

Se utilizará TypeScript para mejorar mantenibilidad, tipado y separación entre componentes.

### Discord

```text
discord.js
@discordjs/voice
```

Responsables de:

- conexión con Discord;
- Slash Commands;
- eventos;
- conexión a canales de voz;
- envío de audio.

### Audio

```text
FFmpeg
```

Se utilizará para:

- convertir streams;
- normalizar formatos;
- producir audio compatible con Discord/Opus.

### Resolución de fuentes

La implementación deberá abstraerse detrás de providers.

Ejemplo:

```text
SpotifyProvider
YouTubeProvider
SearchProvider
AudioProvider
```

La lógica del bot nunca deberá depender directamente de una herramienta concreta para resolver el audio.

## 6. Arquitectura general

```text
                    Discord
                       │
                       │ Slash Commands
                       ▼
               ┌────────────────┐
               │ Discord Bot    │
               │ Controller     │
               └───────┬────────┘
                       │
                       ▼
               ┌────────────────┐
               │ Music Service  │
               └───────┬────────┘
                       │
          ┌────────────┼─────────────┐
          │            │             │
          ▼            ▼             ▼
   SpotifyProvider YouTubeProvider SearchProvider
          │            │             │
          └────────────┼─────────────┘
                       │
                       ▼
                Track Resolver
                       │
                       ▼
                Audio Provider
                       │
                       ▼
                    FFmpeg
                       │
                       ▼
                Discord Voice
```

## 7. Concepto central: Track

Toda canción deberá convertirse internamente a un formato común.

```ts
interface Track {
  id: string

  title: string
  artist?: string

  durationMs?: number

  thumbnailUrl?: string

  source:
    | "spotify"
    | "youtube"
    | "search"

  originalUrl?: string

  requestedBy: {
    discordUserId: string
    username: string
  }

  playback?: {
    resolvedSource?: string
    resolvedUrl?: string
    resolvedAt?: Date
  }
}
```

Esto permite desacoplar:

```text
de dónde vino la canción
```

de:

```text
de dónde sale el audio.
```

Ejemplo:

```text
Track original:

source = spotify
title = "Get Lucky"
artist = "Daft Punk"

        ↓

resolver

        ↓

playback.resolvedSource = youtube
```

## 8. Flujo Spotify

Entrada:

```text
/play https://open.spotify.com/playlist/xxxxx
```

Flujo:

```text
Spotify URL
     ↓
SpotifyProvider
     ↓
Spotify API
     ↓
Playlist metadata
     ↓
Tracks
     ↓
Queue
```

Cada canción deberá guardarse inicialmente únicamente como metadata.

Ejemplo:

```json
{
  "title": "Get Lucky",
  "artist": "Daft Punk",
  "source": "spotify"
}
```

La resolución del audio deberá hacerse preferentemente cuando la canción esté próxima a reproducirse.

No resolver toda la playlist inmediatamente.

Esto evita:

- cientos de búsquedas innecesarias;
- URLs expiradas;
- consumo excesivo;
- esperas largas antes de comenzar la reproducción.

## 9. Resolución de canciones

Antes de reproducir una canción proveniente de Spotify:

```text
Track
 ↓
TrackResolver
 ↓
buscar:
"<artist> <title>"
 ↓
obtener candidatos
 ↓
elegir mejor resultado
 ↓
AudioSource
```

Ejemplo:

```text
Daft Punk Get Lucky

↓ búsqueda

1. Daft Punk - Get Lucky (Official Audio)
2. Get Lucky live
3. Get Lucky lyrics
4. cover...
```

El resolver deberá intentar seleccionar automáticamente el resultado más probable.

## 10. Algoritmo inicial de matching

Para V1 se puede utilizar una puntuación sencilla.

Factores:

### Título

Comparar similitud entre:

```text
Spotify title
YouTube title
```

### Artista

Dar mayor puntuación si aparece el nombre del artista.

### Duración

Si Spotify informa:

```text
duration = 369 segundos
```

priorizar resultados con una duración cercana.

Ejemplo:

```text
diferencia < 5 segundos → excelente
diferencia < 15 segundos → buena
diferencia > 30 segundos → penalización
```

### Palabras negativas

Penalizar títulos que contengan:

```text
cover
reaction
tutorial
karaoke
slowed
nightcore
remix
live
```

salvo que esas palabras estén presentes en el título original.

## 11. Queue Manager

Cada servidor de Discord tendrá su propia cola.

Estructura conceptual:

```text
Guild
 │
 └── PlayerSession
       │
       ├── Current Track
       │
       ├── Queue[]
       │
       ├── Voice Connection
       │
       ├── Audio Player
       │
       └── State
```

No deberá existir una cola global compartida.

Ejemplo:

```ts
Map<GuildId, PlayerSession>
```

## 12. Estados de reproducción

Una sesión podrá tener los siguientes estados:

```text
IDLE
CONNECTING
PLAYING
PAUSED
BUFFERING
STOPPED
ERROR
```

## 13. Comandos V1

### /play

```text
/play <query>
```

Acepta:

```text
Spotify playlist
Spotify track
YouTube playlist
YouTube video
texto
```

Ejemplos:

```text
/play https://open.spotify.com/playlist/...
```

```text
/play https://youtube.com/playlist?list=...
```

```text
/play Daft Punk Get Lucky
```

### /pause

Pausa la reproducción.

### /resume

Continúa reproducción.

### /skip

Salta la canción actual.

### /stop

Detiene reproducción y limpia la cola.

### /queue

Muestra:

```text
Now Playing

1. Canción actual

Up next

2. ...
3. ...
4. ...
```

Si la cola es muy extensa deberá paginarse.

### /shuffle

Mezcla las canciones pendientes.
No deberá modificar la canción actualmente reproducida.

### /loop

Modos:

```text
off
track
queue
```

### /volume

Opcional para V1.

```text
/volume 0-100
```

Podrá deshabilitarse inicialmente si complica el pipeline de audio.

## 14. Comportamiento de `/play`

### Bot fuera del canal

Si el usuario está en un canal:

```text
bot entra
↓
agrega canciones
↓
comienza reproducción
```

### Bot ya reproduciendo

```text
/play otra canción
```

deberá:

```text
agregarla al final de la cola.
```

No interrumpir la canción actual.

## 15. Playlist grande

Las playlists pueden contener cientos o miles de canciones.

El backend deberá evitar bloquear el proceso.

Flujo recomendado:

```text
/play playlist

↓

// responder rápidamente a Discord

"Procesando playlist..."

↓

leer metadata

↓

crear Tracks

↓

insertarlos en queue

↓

comenzar a reproducir

↓

resolver audio bajo demanda
```

## 16. Lazy resolution

Este será un requisito importante.

NO hacer:

```text
100 Spotify tracks
↓
100 búsquedas
↓
100 URLs
↓
reproducir
```

Hacer:

```text
100 Spotify tracks
↓
queue metadata
↓
resolver Track #1
↓
play
↓
resolver Track #2
↓
play
```

Opcionalmente:

```text
mientras Track #1 se reproduce

pre-resolver Track #2
```

Esto mejora considerablemente el tiempo de inicio.

## 17. Prefetch

El sistema debería soportar:

```text
PREFETCH_TRACKS=1
```

o:

```text
PREFETCH_TRACKS=2
```

Cuando comienza a reproducirse una canción:

```text
Track N PLAYING

        ↓

resolver Track N+1
```

El objetivo es minimizar pausas entre canciones.

## 18. Errores de reproducción

Si una canción falla:

```text
resolver falla
```

o:

```text
audio falla
```

el bot deberá:

1. registrar el error;
2. informar brevemente en Discord;
3. saltar a la siguiente canción.

No detener toda la cola.

Ejemplo:

```text
⚠ No pude reproducir:
Daft Punk — Something About Us

Saltando a la siguiente canción.
```

## 19. Reconexión

Si la conexión de voz se interrumpe temporalmente:

```text
Discord disconnect
```

el backend deberá intentar reconectarse.

Debe existir un máximo configurable de intentos.

Ejemplo:

```text
VOICE_RECONNECT_ATTEMPTS=5
```

## 20. Timeout de inactividad

Si:

```text
queue = empty
```

el bot esperará:

```text
VOICE_IDLE_TIMEOUT=300
```

Ejemplo:

```text
5 minutos
```

Luego:

```text
disconnect.
```

## 21. Seguridad

Las credenciales nunca deberán estar dentro del repositorio.

Usar variables de entorno:

```env
DISCORD_TOKEN=

DISCORD_CLIENT_ID=

SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=

DISCORD_GUILD_ID=
```

Cuando corresponda:

```env
YOUTUBE_COOKIES_PATH=
```

El archivo de cookies tampoco deberá almacenarse en Git.

Agregarlo al:

```text
.gitignore
```

## 22. Configuración

Crear módulo:

```text
src/config/
```

responsable de validar todas las variables de entorno al iniciar.

Si falta una variable obligatoria:

```text
fail fast
```

Ejemplo:

```text
Missing environment variable:
DISCORD_TOKEN
```

## 23. Estructura inicial del proyecto

```text
src/

  index.ts

  config/
    env.ts

  discord/
    client.ts

    commands/
      play.command.ts
      pause.command.ts
      resume.command.ts
      skip.command.ts
      stop.command.ts
      queue.command.ts
      shuffle.command.ts
      loop.command.ts

    events/
      ready.event.ts
      interactionCreate.event.ts

  music/

    player/
      PlayerManager.ts
      PlayerSession.ts

    queue/
      Queue.ts

    tracks/
      Track.ts
      TrackResolver.ts

    providers/
      spotify/
        SpotifyProvider.ts

      youtube/
        YouTubeProvider.ts

      search/
        SearchProvider.ts

      audio/
        AudioProvider.ts

  services/

  utils/

  errors/
```

## 24. Providers

Todos los providers deberán implementar interfaces.

Ejemplo:

```ts
interface PlaylistProvider {

  canHandle(input: string): boolean

  getTracks(
    input: string
  ): Promise<Track[]>

}
```

Y:

```ts
interface AudioProvider {

  resolve(
    track: Track
  ): Promise<AudioSource>

}
```

Esto permitirá reemplazar implementaciones sin modificar el core.

## 25. Persistencia

Para V1 no es necesario utilizar base de datos.

Las sesiones pueden almacenarse en memoria:

```text
Map<GuildId, PlayerSession>
```

Si el bot reinicia:

```text
las queues se pierden.
```

Esto es aceptable en V1.

## 26. Futuro almacenamiento

Posteriormente se podrá introducir:

```text
PostgreSQL
```

para almacenar:

- playlists favoritas;
- historial;
- preferencias;
- volumen por servidor;
- DJs autorizados;
- estadísticas;
- última playlist;
- configuración por guild.

Pero no es requisito inicial.

## 27. Logging

Implementar logging estructurado.

Ejemplo:

```text
guildId
userId
track
provider
operation
duration
status
error
```

Ejemplo:

```json
{
  "event": "track_started",
  "guildId": "123",
  "title": "Get Lucky",
  "provider": "youtube"
}
```

## 28. Healthcheck

Aunque inicialmente esté desplegado en Bisect, implementar un pequeño servidor HTTP.

Endpoint:

```text
GET /health
```

Respuesta:

```json
{
  "status": "ok",
  "discord": "connected",
  "activePlayers": 2,
  "uptime": 38422
}
```

Esto hará mucho más sencillo mover posteriormente el servicio a:

```text
VPS
Docker
Railway
Kubernetes
```

sin modificar el core.

## 29. Observabilidad

Registrar mínimamente:

```text
bot_ready
voice_connected
voice_disconnected
playlist_loaded
track_resolved
track_started
track_finished
track_failed
queue_finished
```

## 30. Manejo de concurrencia

El backend deberá soportar varios servidores simultáneamente.

Ejemplo:

```text
Discord Server A
    ↓
PlayerSession A

Discord Server B
    ↓
PlayerSession B

Discord Server C
    ↓
PlayerSession C
```

Cada uno deberá operar de manera independiente.

## 31. Límites iniciales

Configurable:

```env
MAX_PLAYLIST_SIZE=500

MAX_QUEUE_SIZE=1000

MAX_SEARCH_RESULTS=5

VOICE_IDLE_TIMEOUT=300

PREFETCH_TRACKS=1
```

## 32. UX de Discord

El bot deberá responder inmediatamente después de `/play`.

Ejemplo:

```text
🎵 Procesando playlist...
```

Luego:

```text
✅ Playlist agregada

Daft Punk Essentials

37 canciones agregadas.

▶ Reproduciendo:
Get Lucky — Daft Punk
```

No dejar interacciones esperando durante procesos largos.

## 33. Now Playing

Cuando comienza una canción:

```text
🎵 Now Playing

Get Lucky
Daft Punk

03:21 / 06:09

Requested by Pela
```

Opcionalmente mostrar:

- thumbnail;
- fuente original;
- posición en cola.

## 34. Bot permissions

Permisos mínimos:

```text
View Channels
Send Messages
Embed Links
Read Message History
Connect
Speak
Use Application Commands
```

Evitar solicitar:

```text
Administrator
```

## 35. Deployment

El proyecto deberá ejecutarse mediante:

```bash
npm install
npm run build
npm start
```

Producción:

```text
Node.js
FFmpeg
audio resolver
```

No deberán existir dependencias específicas de BisectHosting.

## 36. Docker

Aunque Bisect no lo requiera necesariamente, preparar:

```text
Dockerfile
```

para futura portabilidad.

Ejemplo conceptual:

```text
Node
+
FFmpeg
+
app
```

Esto permitirá posteriormente:

```text
docker compose up
```

en cualquier VPS.

## 37. Variables de entorno

Ejemplo:

```env
NODE_ENV=production

DISCORD_TOKEN=
DISCORD_CLIENT_ID=

SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=

MAX_PLAYLIST_SIZE=500
MAX_QUEUE_SIZE=1000

VOICE_IDLE_TIMEOUT=300

PREFETCH_TRACKS=1

LOG_LEVEL=info

PORT=3000
```

## 38. Rate limiting

Implementar límites para evitar spam.

Ejemplo:

```text
/play

máximo:

5 requests / 10 segundos / usuario
```

Esto deberá ser configurable.

## 39. Cancelación

Si durante la importación de una playlist el usuario ejecuta:

```text
/stop
```

la operación de carga pendiente deberá cancelarse cuando sea posible.

Puede utilizarse:

```text
AbortController
```

para operaciones async.

## 40. Pruebas

### Unit tests

Cubrir:

```text
TrackResolver
Queue
shuffle
loop
matching
URL detection
playlist parsing
```

### Integration tests

Mockear:

```text
Spotify API
YouTube provider
```

Probar:

```text
Spotify playlist
↓
Tracks
↓
Queue
↓
Resolver
```

## 41. Requisitos de rendimiento

Objetivos iniciales:

### Comando

Respuesta inicial a Discord:

```text
< 2 segundos
```

### Inicio de una canción individual

Objetivo:

```text
< 5 segundos
```

cuando la fuente responde normalmente.

### Transición entre canciones

Con prefetch:

```text
ideal < 2 segundos.
```

## 42. Criterios de aceptación V1

La V1 se considerará funcional cuando podamos ejecutar:

```text
/play <Spotify playlist>
```

y el bot:

1. ingrese al canal;
2. lea correctamente la playlist;
3. agregue las canciones;
4. encuentre automáticamente una fuente de audio;
5. reproduzca la primera canción;
6. continúe con el resto;
7. permita `/skip`;
8. permita `/pause`;
9. permita `/resume`;
10. permita `/queue`;
11. permita `/shuffle`;
12. permita `/stop`;
13. tolere errores en canciones individuales;
14. se desconecte tras quedar inactivo.

También deberá funcionar:

```text
/play <YouTube playlist>
```

y:

```text
/play <YouTube URL>
```

y:

```text
/play <texto>
```

## 43. Fases de implementación

### Fase 1 — Discord Core

Implementar:

```text
Discord client
Slash Commands
Voice connection
Audio player
```

Validación:

```text
reproducir un archivo/audio de prueba.
```

### Fase 2 — YouTube individual

Implementar:

```text
/play YouTube URL
```

Validación:

```text
video → audio → Discord.
```

### Fase 3 — Queue

Implementar:

```text
queue
skip
pause
resume
stop
```

### Fase 4 — YouTube playlists

Implementar importación y reproducción de playlists.

### Fase 5 — Spotify

Implementar:

```text
Spotify playlist
↓
metadata
↓
TrackResolver
↓
audio source
```

### Fase 6 — Search

Implementar:

```text
/play query
```

### Fase 7 — Robustez

Agregar:

```text
prefetch
reconnections
timeouts
errors
rate limits
logging
healthcheck
```

### Fase 8 — Deploy

Deploy inicial en:

```text
BisectHosting
```

Verificar:

```text
Discord Voice
FFmpeg
audio provider
Spotify API
cookies/configuración
restarts
```

## 44. Principios de arquitectura

La implementación deberá respetar cuatro principios.

### 1. Discord no conoce Spotify

Discord interactúa únicamente con:

```text
MusicService
```

### 2. Spotify no reproduce audio

Spotify solamente produce:

```text
Track metadata
```

### 3. AudioProvider es reemplazable

Nunca acoplar:

```text
Player → implementación específica de YouTube
```

Debe existir:

```text
Player
   ↓
AudioProvider
```

### 4. Hosting agnóstico

El código no debe depender de BisectHosting.

Debe poder correr mediante:

```text
npm start
```

en cualquier servidor compatible.

## 45. Evolución prevista

La arquitectura deberá permitir posteriormente agregar:

```text
/dashboard
```

con:

```text
Next.js
```

y utilizar el backend existente.

Posibles funcionalidades futuras:

```text
Saved Playlists
Favorites
Recent Tracks
History
DJ Roles
Voting
Web Queue
Realtime controls
Lyrics
Recommendations
Autoplay
Crossfade
Equalizer
Per-server settings
```

sin tener que reemplazar el motor de reproducción.

## 46. Definición de éxito

El producto será exitoso inicialmente si dentro de Discord el usuario puede escribir:

```text
/play <playlist de Spotify>
```

y olvidarse completamente de la implementación interna.

Desde su perspectiva deberá comportarse simplemente como:

```text
Spotify playlist
        ↓
Discord music
```

aunque internamente el sistema esté resolviendo metadata, buscando fuentes de audio, convirtiendo streams y administrando la cola.
