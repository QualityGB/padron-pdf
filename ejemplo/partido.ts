/*
 * A party-side example: build an electoral roll ("padrón") for your own members.
 *
 * The whole point of this library is that it never talks to a database — you hand
 * it an async stream of voters and it draws the PDF. So the same code that the
 * Junta runs against the national roll, a party runs against its own membership
 * list. Here we fake a small membership in memory so the example runs offline,
 * with no database and no network. Swap `miembrosDeMuestra()` for a real cursor
 * over your tables and you have a production roll.
 *
 * Run it with:  npm run ejemplo:partido
 * The PDF lands in ./salida/ and the script prints the path.
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  generarPadronOficial,
  almacenamientoLocal,
  type ElectorPadron,
} from "../src/index";

/*
 * Pretend this is your members table. In real life you'd never load everyone
 * into an array — you'd page through the database. But a dozen rows is plenty to
 * show the shape the library expects, and it keeps the example self-contained.
 *
 * One rule that matters: the roll is printed in the order it arrives, grouped by
 * recinto and then by colegio (the polling place and the table within it). So the
 * stream has to come out sorted that way. If you order your query by
 * (recinto, colegio, cédula) you get this for free.
 */
function miembrosDeMuestra(): ElectorPadron[] {
  // The recinto header carries this block of context, shown once per polling place.
  const recinto = {
    recintoNombre: "Club de Leones El Millón",
    recintoDireccion: "Calle Domingo Mayol esq. Interior B, El Millón",
    recintoCodigo: "00501",
    recintoMeta: {
      sector: "El Millón",
      circ: "1ra. Circunscripción",
      muni: "Distrito Nacional",
      prov: "Distrito Nacional",
      ciudad: "Santo Domingo",
      zona: "D",
      colegios: 2,
      electores: 6,
    },
  };

  // `sexoCode` ("M"/"F") only drives the little colored label on each card;
  // `sexo` is the word that actually gets printed. Keeping them separate means
  // you can localize the label without touching the styling logic.
  const personas: Omit<ElectorPadron, keyof typeof recinto>[] = [
    { cedula: "00100000017", nombres: "Altagracia", apellido1: "Abreu", apellido2: "Guzmán", sexo: "FEMENINO", sexoCode: "F", fechanacimiento: "1952-11-11", colegio: "0001", colegioElectores: 3 },
    { cedula: "00100065572", nombres: "Yira Lisette", apellido1: "Rodríguez", apellido2: "Soto", sexo: "FEMENINO", sexoCode: "F", fechanacimiento: "1959-02-19", colegio: "0001", colegioElectores: 3 },
    { cedula: "00100078526", nombres: "Alexander Manuel", apellido1: "Bello", apellido2: "Domínguez", sexo: "MASCULINO", sexoCode: "M", fechanacimiento: "1964-07-30", colegio: "0001", colegioElectores: 3 },
    { cedula: "00100111806", nombres: "Luis Alberico", apellido1: "Ramos", apellido2: "Valdez", sexo: "MASCULINO", sexoCode: "M", fechanacimiento: "1953-05-06", colegio: "0002", colegioElectores: 3 },
    { cedula: "00100137298", nombres: "Cándida María", apellido1: "Gil", apellido2: "Polonio", sexo: "FEMENINO", sexoCode: "F", fechanacimiento: "1952-12-19", colegio: "0002", colegioElectores: 3 },
    { cedula: "00100397629", nombres: "Soraya Altagracia", apellido1: "Sención", apellido2: "Melo", sexo: "FEMENINO", sexoCode: "F", fechanacimiento: "1966-04-04", colegio: "0002", colegioElectores: 3 },
  ];

  return personas.map((p) => ({ ...recinto, ...p }));
}

/*
 * The library pulls voters from an async iterable, not an array — that's what lets
 * it stream a roll of millions without blowing up memory. Our generator just walks
 * the sample list, but the signature is the one you'd use over a paged DB query:
 * yield a row, fetch the next page when you run out, stop when there's nothing left.
 */
async function* fuenteDatos(): AsyncIterable<ElectorPadron> {
  for (const persona of miembrosDeMuestra()) {
    yield persona;
  }
}

async function main() {
  const salida = join(process.cwd(), "salida");
  await mkdir(salida, { recursive: true });

  const ahora = new Date();
  const fecha = ahora.toLocaleDateString("es-DO");
  const hora = ahora.toLocaleTimeString("es-DO", { hour: "2-digit", minute: "2-digit" });

  const resultado = await generarPadronOficial({
    /*
     * `meta` is everything the cover page and the running header need. `scope` is
     * the breadcrumb from broad to narrow; the last item becomes the big title.
     * The two `fuente*` fields are where a party signs the document as its own —
     * leave them out and it falls back to the Junta's wording, which is wrong for
     * a party roll. `marca` stamps a faint watermark (and an optional logo) so an
     * internal copy can't be passed off as official.
     */
    meta: {
      scope: ["Distrito Nacional", "Distrito Nacional", "Club de Leones El Millón"],
      level: "Recinto",
      code: `PADRON-${ahora.getFullYear()}-DEMO`,
      date: fecha,
      time: hora,
      counts: { electores: 6, recintos: 1, colegios: 2 },
      fuente: "Software del Partido — base de miembros",
      fuenteCorta: "Generado por el Partido",
      marca: { texto: "USO INTERNO DEL PARTIDO", opacidad: 0.06 },
    },

    fuenteDatos: fuenteDatos(),

    /*
     * Photos are optional and deliberately left out here so the example needs no
     * network — every card shows the neutral "s/foto" placeholder. In production
     * you'd prefetch each batch through the photo API's presign endpoint and hand
     * back the bytes from a Map (see the README for the four-line pattern). Either
     * way the function just answers "give me this person's photo, or null".
     */
    fuenteFotos: async () => null,

    // Drop the PDF on disk. For real volumes you'd point this at S3 / a bucket and
    // it would upload by streaming, the same way it writes to a file here.
    storage: almacenamientoLocal({ dir: salida, urlBase: "/padrones" }),
    nombreArchivo: "padron-partido-demo.pdf",
  });

  console.log("Padrón generado:");
  console.log(`  archivo:   ${join(salida, "padron-partido-demo.pdf")}`);
  console.log(`  electores: ${resultado.total}`);
  console.log(`  páginas:   ${resultado.paginas}`);
}

main().catch((error) => {
  console.error("Falló la generación:", error);
  process.exit(1);
});
