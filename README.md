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

## Dos fuentes de datos (junta **y** partido)

La librería es **agnóstica de base de datos**: nunca se conecta a una BD; solo
consume el async iterable `fuenteDatos` que le pasás. Por eso sirve para **las
dos opciones**:

- **Base de la JCE** (datos de la junta) → la API JCE arma `fuenteDatos` desde su
  BD nacional y genera el padrón completo, en su propio servidor (cerca de la BD).
- **Base del software del partido** (sus miembros) → el partido arma `fuenteDatos`
  desde **su** BD y genera el padrón de sus miembros, en su propio servidor.

Mismo diseño, misma librería; cambia solo de dónde salen los electores.

## Uso — diseño oficial (`generarPadronOficial`)

```ts
import {
  generarPadronOficial, almacenamientoS3, presignFotos, descargarFotoUrl,
  type ElectorPadron,
} from "@qualitygb/padron-pdf";

// 1) Electores ya AGRUPADOS por recinto → colegio → cédula (cada quien los
//    saca de SU base: la junta de la BD nacional, el partido de la suya).
async function* fuenteDatos(): AsyncIterable<ElectorPadron> {
  for await (const r of miBaseDeDatos()) {     // keyset, sin cargar todo en memoria
    yield {
      cedula: r.cedula, nombres: r.nombres, apellido1: r.ap1, apellido2: r.ap2,
      sexo: r.sexo, sexoCode: r.sexoCode, fechanacimiento: r.nac,
      colegio: r.colegio, colegioElectores: r.colegioTotal,
      recintoNombre: r.recinto, recintoDireccion: r.direccion, recintoCodigo: r.codRecinto,
      recintoMeta: { sector: r.sector, circ: r.circ, muni: r.muni, prov: r.prov,
                     ciudad: r.ciudad, zona: r.zona, colegios: r.nColegios, electores: r.nElectores },
    };
  }
}

// 2) Fotos: presign por lote + descarga directa de Tigris (egress gratis).
const map = new Map<string, Buffer>();
const fuenteFotos = (cedula: string) => map.get(cedula) ?? null;  // prefetch por lote antes de generar

// 3) Generar.
const res = await generarPadronOficial({
  meta: {
    scope: ["Distrito Nacional", "Distrito Nacional", "Club de Leones El Millón"],
    level: "Recinto", code: "PADRON-20260101-0001",
    date: "01/01/2026", time: "09:00",
    counts: { electores: 603, recintos: 1, colegios: 1 },
    // El partido pone su propia fuente/sello:
    fuente: "Software del Partido XYZ — miembros",
    fuenteCorta: "Generado por Partido XYZ",
    marca: { texto: "PARTIDO XYZ — USO INTERNO", logo: logoBuffer, opacidad: 0.07 },
  },
  fuenteDatos: fuenteDatos(),
  fuenteFotos,
  storage: almacenamientoS3({ endpoint, bucket, accessKeyId, secretAccessKey, prefijo: "padrones/" }),
  nombreArchivo: "padron-club-leones.pdf",
});
// → { url, total, paginas }
```

> El diseño oficial trae portada, una sección por **recinto** (con su meta-grid),
> sub-grupos por **colegio**, tarjetas con foto + sello y un **checkbox** por
> persona para marcar a lápiz. Si solo querés una lista plana simple, usá
> `generarPadron({ fuenteDatos, fuenteFotos, storage, nombreArchivo, plantilla })`.

### Fotos por presign (recomendado a escala)

```ts
import { presignFotos, descargarFotoUrl } from "@qualitygb/padron-pdf";
// por cada lote de ≤500 cédulas, ANTES de generar:
const urls = await presignFotos(cedulas, { token: PHOTO_API_TOKEN });   // Map<cedula, url>
await Promise.all([...urls].map(async ([ced, url]) => {
  const buf = await descargarFotoUrl(url);     // GET directo a Tigris (egress gratis)
  if (buf) map.set(ced, buf);
}));
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
