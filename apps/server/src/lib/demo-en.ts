/**
 * Traducción al inglés de los datos de demostración. Se aplica sustituyendo frases
 * (de la más larga a la más corta) en todos los textos: nombres, descripciones, scripts,
 * bodies y nombres de variables. Al aplicarse a todo por igual, las referencias
 * ({{ciudad}} → {{city}}, claves del CSV, aserciones de los tests…) siguen encajando.
 */
const EN: Record<string, string> = {
  // Blog
  '# API del blog\n\nAPI REST de ejemplo de [JSONPlaceholder](https://jsonplaceholder.typicode.com): posts, usuarios y comentarios.\n\n- **Base URL:** `{{baseUrl}}`\n- Las escrituras (POST/PUT/PATCH/DELETE) se simulan: responden como si funcionaran, pero no guardan nada.\n- Cada petición tiene tests y un **ejemplo real guardado**, que es lo que devuelve el *mock server* «Mock del blog».':
    '# Blog API\n\nSample REST API from [JSONPlaceholder](https://jsonplaceholder.typicode.com): posts, users and comments.\n\n- **Base URL:** `{{baseUrl}}`\n- Writes (POST/PUT/PATCH/DELETE) are simulated: they respond as if they worked, but nothing is stored.\n- Every request has tests and a **saved real example**, which is what the “Blog mock” *mock server* returns.',
  'Entradas del blog.': 'Blog posts.',
  'Devuelve los 10 primeros posts. Quita `_limit` para recibir los 100.': 'Returns the first 10 posts. Remove `_limit` to get all 100.',
  'Usa variables dinámicas (`{{$randomLoremSentence}}`) para generar un título distinto en cada envío.': 'Uses dynamic variables (`{{$randomLoremSentence}}`) to generate a different title on every send.',
  'Ejemplo de **variable de ruta** (`:userId`), editable en la pestaña Params.': 'Example of a **path variable** (`:userId`), editable in the Params tab.',
  'Id del usuario (1-10)': 'User id (1-10)',
  'Responde en menos de 3 s': 'Responds in under 3 s',
  'Listar posts': 'List posts',
  'Obtener post': 'Get post',
  'Crear post': 'Create post',
  'Actualizar post': 'Update post',
  'Editar título (PATCH)': 'Edit title (PATCH)',
  'Borrar post': 'Delete post',
  'Listar usuarios': 'List users',
  'Obtener usuario': 'Get user',
  'Tareas de un usuario': 'A user’s todos',
  'Comentarios de un post': 'Comments on a post',
  Comentarios: 'Comments',
  Usuarios: 'Users',
  'Código 201 Created': 'Status 201 Created',
  'Código 200': 'Status 200',
  'Código 418': 'Status 418',
  'Devuelve 10 posts': 'Returns 10 posts',
  'Cada post tiene id, título y cuerpo': 'Every post has id, title and body',
  'Es el post pedido': 'It is the requested post',
  'Devuelve el id nuevo': 'Returns the new id',
  'Post creado con id': 'Post created with id',
  'Título actualizado desde Cartero': 'Title updated from Cartero',
  'Contenido nuevo': 'New content',
  'Título cambiado': 'Title changed',
  'Solo cambio el título': 'Only the title changes',
  'Hay 10 usuarios': 'There are 10 users',
  'Tiene email válido': 'Has a valid email',
  'Cumple el schema': 'Matches the schema',
  'Todas pendientes': 'All pending',
  'Al menos un comentario': 'At least one comment',
  'Post no encontrado': 'Post not found',
  '(respuesta real)': '(real response)',
  'Mock del blog': 'Blog mock',
  // httpbin
  'Pruebas de autenticación y del protocolo HTTP contra [httpbin.org](https://httpbin.org).\n\nActiva el entorno **«httpbin (credenciales)»**: guarda usuario, contraseña, token y API key como variables, las secretas cifradas.':
    'Authentication and HTTP protocol tests against [httpbin.org](https://httpbin.org).\n\nActivate the **“httpbin (credentials)”** environment: it stores user, password, token and API key as variables, the secret ones encrypted.',
  'httpbin — Autenticación y HTTP': 'httpbin — Authentication and HTTP',
  'httpbin (credenciales)': 'httpbin (credentials)',
  'Salud de httpbin': 'httpbin health',
  'Se envía en la cabecera X-API-Key': 'Sent in the X-API-Key header',
  Autenticación: 'Authentication',
  'Autenticado con Digest': 'Authenticated with Digest',
  Autenticado: 'Authenticated',
  'Token aceptado': 'Token accepted',
  'API key en cabecera': 'API key in header',
  'La cabecera llega al servidor': 'The header reaches the server',
  'Soy una tetera (418)': 'I’m a teapot (418)',
  'Seguir redirecciones': 'Follow redirects',
  'Termina en /get': 'Ends at /get',
  'Respuesta lenta (1 s)': 'Slow response (1 s)',
  'Tarda al menos 1 s': 'Takes at least 1 s',
  'Guardar una cookie': 'Set a cookie',
  'La cookie queda en el jar': 'The cookie is stored in the jar',
  'Formulario urlencoded': 'Urlencoded form',
  'El servidor recibe el formulario': 'The server receives the form',
  herramienta: 'tool',
  'UUID aleatorio': 'Random UUID',
  'Es un UUID': 'Is a UUID',
  'Imagen PNG': 'PNG image',
  'Abre la pestaña **Vista previa** de la respuesta.': 'Open the response’s **Preview** tab.',
  'Página HTML': 'HTML page',
  usuario: 'user',
  // Clima
  'Encadena dos APIs reales de [Open-Meteo](https://open-meteo.com) sin clave:\n\n1. **Buscar ciudad** → un script guarda latitud y longitud.\n2. **Tiempo actual** y **Previsión** usan esas variables.\n\nCambia de ciudad con el entorno (Madrid, Barcelona, Ciudad de México…) o ejecútala en el runner con un CSV de ciudades.':
    'Chains two real [Open-Meteo](https://open-meteo.com) APIs, no key needed:\n\n1. **Find city** → a script saves latitude and longitude.\n2. **Current weather** and **Forecast** use those variables.\n\nSwitch city with the environment (Madrid, Barcelona, Mexico City…) or run it in the runner with a CSV of cities.',
  'Clima — Open-Meteo': 'Weather — Open-Meteo',
  'El tiempo en Madrid': 'Madrid weather',
  '1. Buscar ciudad': '1. Find city',
  '2. Tiempo actual': '2. Current weather',
  '3. Previsión 7 días': '3. 7-day forecast',
  'Encuentra la ciudad': 'Finds the city',
  'Coordenadas de': 'Coordinates of',
  'Hay temperatura': 'Has a temperature',
  'Temperatura razonable': 'Reasonable temperature',
  'Ahora en ': 'Now in ',
  ', humedad ': ', humidity ',
  ', viento ': ', wind ',
  '7 días de previsión': '7-day forecast present',
  'Máxima ≥ mínima': 'Max ≥ min',
  'Ciudad de México': 'Mexico City',
  'language=es': 'language=en',
  Sevilla: 'Seville',
  Tokio: 'Tokyo',
  ciudad: 'city',
  // PokeAPI
  'La [PokeAPI](https://pokeapi.co): listados paginados y peticiones encadenadas por URL.': 'The [PokeAPI](https://pokeapi.co): paginated lists and requests chained by URL.',
  'La URL la guarda el script de «Obtener Pokémon».': 'The URL is saved by the “Get Pokémon” script.',
  'Listar Pokémon': 'List Pokémon',
  'Obtener Pokémon': 'Get Pokémon',
  'Es el Pokémon pedido': 'It is the requested Pokémon',
  'Especie (encadenada)': 'Species (chained)',
  'Cadena evolutiva (encadenada)': 'Evolution chain (chained)',
  'Tiene cadena evolutiva': 'Has an evolution chain',
  'Incluye al Pokémon': 'Includes the Pokémon',
  '20 resultados': '20 results',
  "language.name === 'es'": "language.name === 'en'",
  'Descripción:': 'Description:',
  'Evolución:': 'Evolution:',
  'tipos:': 'types:',
  // Países
  'Consultas GraphQL reales contra [countries.trevorblades.com](https://countries.trevorblades.com).': 'Real GraphQL queries against [countries.trevorblades.com](https://countries.trevorblades.com).',
  'Países — GraphQL': 'Countries — GraphQL',
  'País por código': 'Country by code',
  'Países de Sudamérica': 'South American countries',
  'Más de 10 países': 'More than 10 countries',
  'Es España': 'It is Spain',
  '· moneda:': '· currency:',
  // Importadas
  'Petstore — importada de OpenAPI': 'Petstore — imported from OpenAPI',
  'Importada directamente de la especificación OpenAPI 3 publicada en ': 'Imported directly from the OpenAPI 3 spec published at ',
  'GitHub — importada de cURL': 'GitHub — imported from cURL',
  'Repositorio postman-runtime': 'postman-runtime repository',
  'Repo público': 'Public repo',
  // Colaboración
  '¿Validamos también que el título no venga vacío? En producción nos ha pasado.': 'Should we also check that the title isn’t empty? It happened to us in production.',
  'Buena idea, lo añado al test. 👍': 'Good idea, I’ll add it to the test. 👍',
  'He subido el límite de tiempo a 3 s en la colección, que JSONPlaceholder a veces va lento.': 'I raised the time limit to 3 s on the collection, since JSONPlaceholder is sometimes slow.',
  'Añadido por Laura': 'Added by Laura',
  'Blog — fork de Laura': 'Blog — Laura’s fork',
  'Buscar posts por usuario': 'Find posts by user',
  // Globales
  appNombre: 'appName',
  idioma: 'language',
}

const KEYS = Object.keys(EN).sort((a, b) => b.length - a.length)

function replaceAll(s: string): string {
  let out = s
  for (const k of KEYS) if (out.includes(k)) out = out.split(k).join(EN[k])
  return out
}

/** Devuelve una función que traduce (en profundidad) textos y objetos de la demo. */
export function demoTranslator(lang: 'es' | 'en') {
  const deep = (v: any): any => {
    if (lang !== 'en') return v
    if (typeof v === 'string') return replaceAll(v)
    if (Array.isArray(v)) return v.map(deep)
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x)]))
    return v
  }
  return deep as <T>(v: T) => T
}
