# @qualitygb/padron-pdf

Generador de **padrones electorales en PDF** (datos + foto del ciudadano),
plug-and-play y pensado para **escala sin romperte económicamente**. Librería de
backend (Node).

- **Streaming real:** consume los ciudadanos de un async iterable y escribe el
  PDF página a página — nunca carga millones de filas en memoria.
- **Storage configurable:** local / volumen, o S3-compatible (AWS S3, Bunny,
  MinIO, buckets de Railway). Sube por streaming.
- **Fotos con caché:** cada foto se descarga una vez y se reutiliza; evita
  millones de requests a la API de fotos.
- **Diseño por defecto** profesional + **marca del partido** (watermark).

## Instalación

```bash
npm install git+https://github.com/QualityGB/padron-pdf.git
```

## Uso

```ts
import {
  generarPadron, almacenamientoS3, almacenamientoLocal, fuenteFotosConCache
} from "@qualitygb/padron-pdf";

// 1) De dónde salen los ciudadanos (por lotes, sin cargar todo en memoria).
//    En la junta: un paginador keyset de la BD. En el partido: su propia base.
async function* fuenteDatos() {
  let desde = "";
  while (true) {
    const lote = await traerLote(desde);      // ej. WHERE cedula > $desde ORDER BY cedula LIMIT 5000
    if (!lote.length) break;
    for (const c of lote) yield c;             // { cedula, nombres, apellido1, recinto, colegio, ... }
    desde = lote[lote.length - 1].cedula;
  }
}

// 2) Fotos con caché (se descargan una vez).
const fuenteFotos = fuenteFotosConCache({
  dirCache: "/datos/cache-fotos",
  obtener: async (cedula) => {
    const r = await fetch(`${API}/foto/${cedula}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    return r.ok ? Buffer.from(await r.arrayBuffer()) : null;
  },
});

// 3) Generar.
const res = await generarPadron({
  fuenteDatos: fuenteDatos(),
  fuenteFotos,
  storage: almacenamientoS3({ endpoint, bucket, accessKeyId, secretAccessKey, prefijo: "padrones/" }),
  nombreArchivo: "padron-santiago.pdf",
  plantilla: { titulo: "Padrón electoral", subtitulo: "Provincia: Santiago", pie: "Partido XYZ" },
  marca: { texto: "PARTIDO XYZ — USO INTERNO", logo: logoBuffer, opacidad: 0.07 },
});
// → { url, total, paginas }
```

## Storage

| Adaptador | Cuándo |
| --- | --- |
| `almacenamientoLocal({ dir, urlBase? })` | Disco / volumen Railway. Simple. |
| `almacenamientoS3({ endpoint?, bucket, accessKeyId, secretAccessKey, prefijo?, urlPublica? })` | AWS S3, Bunny, MinIO, Railway bucket. Recomendado a escala. |

¿Otro destino? Implementa la interfaz `AdaptadorStorage` (una función
`guardar(nombre, stream) => url`).

## Por qué no se rompe económicamente

1. **Keyset, no OFFSET ni cargar todo:** lee por lotes usando índices; cada
   consulta toca pocos MB, no la tabla entera.
2. **Caché de fotos:** una descarga por cédula, reutilizada entre padrones.
3. **Streaming a storage:** el PDF nunca vive entero en RAM.
4. **Genera una vez, sirve el archivo:** combínalo con caché del PDF (no
   regenerar el mismo padrón).

## Dónde se ejecuta

- **Padrón de los miembros del partido** → en el servidor del partido, con su
  base como `fuenteDatos`.
- **Padrón general de la junta** (millones) → en el servidor de la API JCE, cerca
  de la base (endpoint `POST /padron/generar`), para no mover millones de filas
  por la red.

## Opciones de plantilla

`titulo`, `subtitulo`, `pie`, `conFoto` (default true), `tamanoFoto` (default 48).
`marca`: `{ texto, logo, opacidad, color }`. Cada línea se trunca con `…` para no
desbordar.
