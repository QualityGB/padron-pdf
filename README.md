# @qualitygb/padron-pdf

A backend library (Node) for building **electoral rolls — "padrones" — as PDFs**,
with each voter's data and photo. It was written for the case that usually breaks
these things: rolls with millions of people, where a naive approach runs the
database (and your cloud bill) into the ground.

Three decisions keep it cheap and steady at scale:

- **It streams.** You give it an async iterable of voters and it draws the PDF one
  page at a time. A roll of three million people uses about as much memory as a
  roll of three hundred.
- **It doesn't care where the data lives.** The library never opens a database
  connection. You feed it rows; it draws pages. That's the whole contract — and
  it's why the same code works for the Junta's national roll and for a party's own
  membership list (more on that below).
- **It reuses photos.** Each photo is fetched once and cached, so regenerating a
  roll — or generating the one next door — doesn't hammer the photo API again.

Storage is pluggable (local disk, a volume, or anything S3-compatible: AWS, Bunny,
MinIO, a Railway bucket), and every page can carry a party watermark and logo.

## Install

```bash
npm install git+https://github.com/QualityGB/padron-pdf.git
```

## Two data sources: the Junta *and* the party

Because the library only ever consumes the `fuenteDatos` iterable you hand it, the
same design serves both sides of an election with no change to the drawing code:

- **From the Junta's database.** The JCE API builds `fuenteDatos` from the national
  roll and generates the full document on its own server, right next to the data —
  so millions of rows never travel across the network.
- **From the party's own software.** A party builds `fuenteDatos` from *its* member
  database and generates the roll of its own people, on its own server.

Same layout, same library; the only thing that changes is where the voters come
from — and the wording on the cover, which the party sets to its own name.

There's a complete, runnable version of the party case in
[`ejemplo/partido.ts`](ejemplo/partido.ts). It uses a handful of in-memory members
so it runs with no database and no network:

```bash
npm run ejemplo:partido      # writes ./salida/padron-partido-demo.pdf
```

## Usage — the official layout (`generarPadronOficial`)

This is the design you almost certainly want: a cover page, one section per polling
place ("recinto") with its location details, sub-groups per voting table
("colegio"), a card per voter with photo and a **checkbox to tick people off by
hand**, and correct page numbering throughout.

```ts
import {
  generarPadronOficial, almacenamientoS3, presignFotos, descargarFotoUrl,
  type ElectorPadron,
} from "@qualitygb/padron-pdf";

// Walk your own database here. The document is printed in the order rows arrive,
// grouped by recinto and then by colegio, so sort your query by
// (recinto, colegio, cédula) and yield as you go — never load the whole roll at once.
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

// Photos come from a Map that you fill batch by batch before generating (next
// section). The drawing code just asks "this person's photo, or null".
const fotos = new Map<string, Buffer>();
const fuenteFotos = (cedula: string) => fotos.get(cedula) ?? null;

const res = await generarPadronOficial({
  // Everything the cover and the running header need. `scope` reads broad-to-narrow
  // and its last item becomes the big title. The two `fuente*` fields are how a
  // party signs the document as its own — omit them and it falls back to the
  // Junta's wording, which is wrong on a party roll. `marca` adds a faint watermark
  // (and optional logo) so an internal copy can't pass for an official one.
  meta: {
    scope: ["Distrito Nacional", "Distrito Nacional", "Club de Leones El Millón"],
    level: "Recinto", code: "PADRON-20260101-0001",
    date: "01/01/2026", time: "09:00",
    counts: { electores: 603, recintos: 1, colegios: 1 },
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

If you only need a plain list — no cover, no grouping — there's a simpler entry
point: `generarPadron({ fuenteDatos, fuenteFotos, storage, nombreArchivo, plantilla })`.

### Photos at scale, without the egress bill

Don't pull photos one by one through the API for a large roll — that path streams
bytes through the service and you pay for it per image. Instead, ask the photo API
to **pre-sign** a batch of URLs and download the images straight from object
storage, where egress is free:

```ts
import { presignFotos, descargarFotoUrl } from "@qualitygb/padron-pdf";

// For each batch of up to 500 cédulas, just before you generate:
const urls = await presignFotos(cedulas, { token: PHOTO_API_TOKEN });   // Map<cédula, url>
await Promise.all([...urls].map(async ([ced, url]) => {
  const buf = await descargarFotoUrl(url);   // direct GET to object storage
  if (buf) fotos.set(ced, buf);
}));
```

The signed URLs are short-lived, so sign each batch right before you use it. If a
person has no photo on file, you get `null` and the card shows a neutral
placeholder.

## Storage

| Adapter | Use it for |
| --- | --- |
| `almacenamientoLocal({ dir, urlBase? })` | A disk or a mounted volume. The simplest thing that works. |
| `almacenamientoS3({ endpoint?, bucket, accessKeyId, secretAccessKey, prefijo?, urlPublica? })` | AWS S3, Bunny, MinIO, a Railway bucket — anything S3-compatible. Uploads by streaming. The right choice once rolls pile up. |

Need somewhere else? Implement the `AdaptadorStorage` interface — a single
`guardar(nombre, stream) => url` function — and pass it in.

## Where each roll should run

- **A party's member roll** runs on the party's server, with its database as
  `fuenteDatos`.
- **The Junta's full roll** (millions of people) runs on the JCE API server, next
  to the database, via `POST /padron/generar` — so the rows are read where they
  live instead of being shipped across the network.

## What's in the official layout

The cover carries the title, the breadcrumb (`scope`), the three headline counts,
the document code and timestamp, and the legal notice. Each polling place opens
with its name, address and an eight-field grid (sector, circumscription,
municipality, province, city/section, zone, number of tables, number of voters).
Within it, each voting table gets a labelled divider, and every voter is a card
with photo, line number, sex, full name, cédula, date of birth and table — plus
the tick box. Long values are clipped with an ellipsis so nothing collides.

## Why it stays cheap

1. **Keyset paging, never `OFFSET` or "load everything".** Each query rides an
   index and touches a few megabytes, not the whole table.
2. **One photo download per cédula,** reused across rolls.
3. **The PDF never lives in memory** — it streams straight to storage.
4. **Generate once, then serve the file.** Pair it with a check that doesn't
   regenerate a roll that hasn't changed.
