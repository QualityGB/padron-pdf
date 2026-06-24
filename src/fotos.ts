import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

export interface OpcionesFotoCache {
  /** Función base que trae la foto (ej. fetch al proxy /foto/{cedula}). */
  obtener: (cedula: string) => Promise<Buffer | null>;
  /** Carpeta de caché en disco. Si se omite, solo cachea en memoria. */
  dirCache?: string;
  /** Máximo de fotos en memoria (LRU simple). Default 500. */
  maxMemoria?: number;
}

/**
 * Envuelve una función de fotos con caché en disco + memoria. Pensado para
 * padrones masivos: la foto de una cédula se descarga UNA vez; los siguientes
 * padrones (y repeticiones) la leen del caché. Evita millones de requests a la
 * API de fotos.
 */
export function fuenteFotosConCache(opciones: OpcionesFotoCache) {
  const { obtener, dirCache, maxMemoria = 500 } = opciones;
  const memoria = new Map<string, Buffer>();
  const enVuelo = new Map<string, Promise<Buffer | null>>();
  let cacheListo = false;

  const rutaDisco = (cedula: string) => (dirCache ? join(dirCache, `${cedula}.img`) : null);

  const leerDisco = (cedula: string): Promise<Buffer | null> =>
    new Promise((res) => {
      const ruta = rutaDisco(cedula);
      if (!ruta || !existsSync(ruta)) return res(null);
      const partes: Buffer[] = [];
      createReadStream(ruta)
        .on("data", (d) => partes.push(d as Buffer))
        .on("end", () => res(Buffer.concat(partes)))
        .on("error", () => res(null));
    });

  const escribirDisco = (cedula: string, buf: Buffer): Promise<void> =>
    new Promise((res) => {
      const ruta = rutaDisco(cedula);
      if (!ruta) return res();
      const ws = createWriteStream(ruta);
      ws.on("finish", () => res()).on("error", () => res());
      ws.end(buf);
    });

  const recordarMemoria = (cedula: string, buf: Buffer) => {
    memoria.set(cedula, buf);
    if (memoria.size > maxMemoria) {
      const primera = memoria.keys().next().value;
      if (primera !== undefined) memoria.delete(primera);
    }
  };

  return async function foto(cedula: string): Promise<Buffer | null> {
    if (memoria.has(cedula)) return memoria.get(cedula)!;
    if (enVuelo.has(cedula)) return enVuelo.get(cedula)!;

    const tarea = (async () => {
      if (dirCache && !cacheListo) { await mkdir(dirCache, { recursive: true }).catch(() => {}); cacheListo = true; }
      const enDisco = await leerDisco(cedula);
      if (enDisco) { recordarMemoria(cedula, enDisco); return enDisco; }

      const buf = await obtener(cedula).catch(() => null);
      if (buf) { recordarMemoria(cedula, buf); await escribirDisco(cedula, buf); }
      return buf;
    })();

    enVuelo.set(cedula, tarea);
    try { return await tarea; }
    finally { enVuelo.delete(cedula); }
  };
}

// === Flujo PRESIGN (recomendado para padrones a escala) ===
// La API de fotos de la JCE da URLs firmadas por lote y las imágenes se bajan
// DIRECTO del object storage (Tigris) → egress gratis, sin cargar la API.
// (`GET /photos/:cedula` es solo para consultas humanas sueltas.)

export interface OpcionesPresign {
  /** Base de la API de fotos. Default: https://photo-jce-api-production.up.railway.app */
  base?: string;
  /** Token permanente de la API de fotos (header x-api-token). */
  token: string;
  /** TTL de las URLs firmadas en segundos (10–900). Default 900. */
  expiresIn?: number;
}

/** Pide URLs firmadas para un lote de cédulas (≤500 por request). Map<cedula, url|null>. */
export async function presignFotos(cedulas: string[], opciones: OpcionesPresign): Promise<Map<string, string | null>> {
  const base = opciones.base ?? "https://photo-jce-api-production.up.railway.app";
  const expiresIn = opciones.expiresIn ?? 900;
  const urls = new Map<string, string | null>();
  const limpias = [...new Set(cedulas.map(String).filter((c) => /^\d{11}$/.test(c)))];
  for (let i = 0; i < limpias.length; i += 500) {
    const lote = limpias.slice(i, i + 500);
    let intento = 0;
    for (;;) {
      try {
        const r = await fetch(`${base}/photos/presign`, {
          method: "POST",
          headers: { "x-api-token": opciones.token, "Content-Type": "application/json" },
          body: JSON.stringify({ cedulas: lote, expiresIn }),
        });
        if (r.ok) {
          const data = await r.json() as { items?: { cedula: string; found: boolean; url: string | null }[] };
          for (const it of data.items ?? []) urls.set(it.cedula, it.found ? it.url : null);
          break;
        }
      } catch { /* red: reintentar */ }
      if (++intento >= 3) { for (const c of lote) if (!urls.has(c)) urls.set(c, null); break; }
      await new Promise((s) => setTimeout(s, 200 * intento));
    }
  }
  return urls;
}

/** Descarga una imagen DIRECTO de la URL firmada (egress gratis). Buffer o null. */
export async function descargarFotoUrl(url: string | null, intentos = 3): Promise<Buffer | null> {
  if (!url) return null;
  for (let i = 0; i < intentos; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return Buffer.from(await r.arrayBuffer());
      if (r.status === 404 || r.status === 403) return null;
    } catch { /* red: reintentar */ }
    if (i < intentos - 1) await new Promise((s) => setTimeout(s, 150 * (i + 1)));
  }
  return null;
}
