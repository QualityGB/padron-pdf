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
