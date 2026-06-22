// Ejemplo: genera el padrón de un recinto real (datos + fotos) a un PDF local.
// Usa la API JCE de producción como fuente de datos y de fotos.
//   node --import tsx ejemplo/generar.ts <TOKEN_JCE>

import { generarPadron, almacenamientoLocal, fuenteFotosConCache } from "../src/index";
import type { CiudadanoPadron } from "../src/index";

const API = process.env.JCE_API_BASE ?? "https://jce-api-production.up.railway.app";
const TOKEN = process.argv[2] ?? process.env.JCE_TOKEN;
if (!TOKEN) { console.error("Falta el token JCE: node --import tsx ejemplo/generar.ts <TOKEN>"); process.exit(1); }

// Fuente de datos: lista de cédulas reales de un recinto (aquí, fijas de ejemplo).
// En producción esto sale del paginador keyset de la API (ver endpoint /padron/generar).
const CEDULAS = ["00100000017", "00100000165", "00113883953"];

async function* fuenteDatos(): AsyncIterable<CiudadanoPadron> {
  for (const cedula of CEDULAS) {
    const r = await fetch(`${API}/padron/${cedula}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    if (!r.ok) continue;
    const p = await r.json();
    yield {
      cedula: p.cedula, nombres: p.nombres, apellido1: p.apellido1, apellido2: p.apellido2,
      sexo: p.descripcionSexo, fechanacimiento: p.fechanacimiento,
      provincia: p.descripcionProvincia, municipio: p.descripcionMunicipio,
      recinto: p.descripcionRecinto, colegio: p.codigocolegio ? `Nº ${p.codigocolegio}` : null,
    };
  }
}

const fuenteFotos = fuenteFotosConCache({
  dirCache: "./salida/cache-fotos",
  obtener: async (cedula) => {
    const r = await fetch(`${API}/foto/${cedula}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    if (!r.ok) return null;
    return Buffer.from(await r.arrayBuffer());
  },
});

const res = await generarPadron({
  fuenteDatos: fuenteDatos(),
  fuenteFotos,
  storage: almacenamientoLocal({ dir: "./salida" }),
  nombreArchivo: "padron-ejemplo.pdf",
  plantilla: {
    titulo: "Padrón electoral — ejemplo",
    subtitulo: "Recinto: Club de Leones El Millón · Distrito Nacional",
    pie: "Generado con @qualitygb/padron-pdf",
  },
  marca: { texto: "PARTIDO DEMO — USO INTERNO", opacidad: 0.07 },
  onProgreso: (n) => process.stdout.write(`\r  procesados: ${n}`),
});

console.log(`\n✅ PDF: ${res.url} · ${res.total} ciudadanos · ${res.paginas} página(s)`);
