# @qualitygb/padron-pdf

A Node backend library for generating electoral rolls ("padrones") as PDFs, with
each voter's data and photo.

- **Streaming.** Voters are consumed from an async iterable and the PDF is written
  page by page, so memory stays constant regardless of roll size.
- **Database-agnostic.** The library never opens a database connection. You supply
  the rows through `fuenteDatos`; the library draws the pages.
- **Photo cache.** Each photo is fetched once and cached on disk/in memory, so
  regenerating a roll reuses it instead of fetching again.
- **Pluggable storage** (local disk, volume, or any S3-compatible target) and an
  optional per-page watermark and logo.

## Install

```bash
npm install git+https://github.com/QualityGB/padron-pdf.git
```

Requires Node 18+ (uses the global `fetch`). Peer runtime deps: `pdfkit` and, for
S3 storage, `@aws-sdk/client-s3`.

## Two data sources

Because the library only consumes the `fuenteDatos` iterable you provide, the same
code generates a roll from either source:

- **JCE database** — the JCE API builds `fuenteDatos` from the national roll and
  generates on its own server, next to the database.
- **Party software** — a party builds `fuenteDatos` from its own member database
  and generates the roll of its members on its own server.

The drawing code is identical; only the data source and the cover wording change.

A complete, runnable version of the party case is in
[`ejemplo/partido.ts`](ejemplo/partido.ts). It uses in-memory data, so it runs with
no database and no network:

```bash
npm run ejemplo:partido      # writes ./salida/padron-partido-demo.pdf
```

## Usage — official layout (`generarPadronOficial`)

Produces a cover page, one section per recinto (with its location grid), sub-groups
per colegio, a card per voter with photo and a tick box, and page numbering.

```ts
import {
  generarPadronOficial, almacenamientoS3, presignFotos, descargarFotoUrl,
  type ElectorPadron,
} from "@qualitygb/padron-pdf";

// Rows are printed in arrival order, grouped by recinto then colegio. Order your
// query by (recinto, colegio, cédula) and yield as you page through it.
async function* fuenteDatos(): AsyncIterable<ElectorPadron> {
  for await (const r of miBaseDeDatos()) {
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

// Photos are read from a Map you fill batch by batch before generating (below).
const fotos = new Map<string, Buffer>();
const fuenteFotos = (cedula: string) => fotos.get(cedula) ?? null;

const res = await generarPadronOficial({
  meta: {
    scope: ["Distrito Nacional", "Distrito Nacional", "Club de Leones El Millón"],
    level: "Recinto", code: "PADRON-20260101-0001",
    date: "01/01/2026", time: "09:00",
    counts: { electores: 603, recintos: 1, colegios: 1 },
    // Document source/labels. Omit to fall back to the JCE wording.
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

For a plain list without cover or grouping, use
`generarPadron({ fuenteDatos, fuenteFotos, storage, nombreArchivo, plantilla })`.

### Photos via presign

Request a batch of pre-signed URLs from the photo API and download the images
directly from object storage:

```ts
import { presignFotos, descargarFotoUrl } from "@qualitygb/padron-pdf";

// Per batch of up to 500 cédulas, just before generating:
const urls = await presignFotos(cedulas, { token: PHOTO_API_TOKEN });   // Map<cédula, url>
await Promise.all([...urls].map(async ([ced, url]) => {
  const buf = await descargarFotoUrl(url);   // direct GET to object storage
  if (buf) fotos.set(ced, buf);
}));
```

Signed URLs are short-lived; sign each batch right before use. A cédula with no
photo on file returns `null`, and the card shows a neutral placeholder.

## API reference

### `generarPadronOficial(opts) => Promise<{ url, total, paginas }>`

| Field | Type | Notes |
| --- | --- | --- |
| `meta` | `MetaPadron` | Cover and header data (below). |
| `fuenteDatos` | `AsyncIterable<ElectorPadron>` | Voters, grouped by recinto → colegio → cédula. |
| `fuenteFotos?` | `(cedula) => Promise<Buffer\|null> \| Buffer \| null` | Photo bytes or `null`. |
| `storage` | `AdaptadorStorage` | Output target. |
| `nombreArchivo` | `string` | Output file name. |

**`MetaPadron`**: `scope: string[]` (breadcrumb; last item is the title), `level`,
`code`, `date`, `time`, `counts: { electores, recintos, colegios }`,
`fuente?` (cover source label, default `"API JCE — base de datos nacional"`),
`fuenteCorta?` (footer label, default `"Generado vía API JCE"`),
`marca?: { texto?, logo?, opacidad?, color? }`.

**`ElectorPadron`**: `cedula` (required), `nombres`, `apellido1`, `apellido2`,
`sexo` (printed word), `sexoCode` (`"M"`/`"F"`, drives the colored label),
`fechanacimiento`, `colegio`, `colegioElectores`, `recintoNombre` (required),
`recintoDireccion`, `recintoCodigo`, `recintoMeta` (`sector`, `circ`, `muni`,
`prov`, `ciudad`, `zona`, `colegios`, `electores`).

### Photos

- `fuenteFotosConCache({ obtener, dirCache?, maxMemoria? })` — wraps a per-cédula
  fetch with a disk + memory cache.
- `presignFotos(cedulas, { token, base?, expiresIn? }) => Promise<Map<cedula, url|null>>`
  — batch (≤500) pre-signed URLs from the photo API.
- `descargarFotoUrl(url, intentos?) => Promise<Buffer|null>` — download one image
  from a signed URL, with retries.

### Storage

| Adapter | Target |
| --- | --- |
| `almacenamientoLocal({ dir, urlBase? })` | Local disk or a mounted volume. |
| `almacenamientoS3({ endpoint?, bucket, accessKeyId, secretAccessKey, prefijo?, urlPublica? })` | Any S3-compatible store (AWS S3, Bunny, MinIO, Railway bucket). Uploads by streaming. |

For another target, implement `AdaptadorStorage` — a single
`guardar(nombre, stream) => Promise<url>` function.

## Layout contents

The cover carries the title, the `scope` breadcrumb, the three counts, the document
code and timestamp, and the legal notice. Each recinto opens with its name, address
and an eight-field grid (sector, circumscription, municipality, province,
city/section, zone, number of colegios, number of voters). Within it, each colegio
has a labelled divider, and each voter is a card with photo, line number, sex, full
name, cédula, date of birth, colegio, and a tick box. Overflowing values are clipped
with an ellipsis.

## Where each roll runs

- A party's member roll runs on the party's server, with its database as
  `fuenteDatos`.
- The JCE full roll runs on the JCE API server, next to the database, via
  `POST /padron/generar`.
