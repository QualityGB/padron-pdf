import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import type { AdaptadorStorage } from "../tipos";

export interface OpcionesLocal {
  /** Carpeta donde guardar los PDFs. */
  dir: string;
  /** Prefijo de URL pública si los sirves por HTTP (ej. "/padrones"). Default: ruta de archivo. */
  urlBase?: string;
}

/** Guarda el PDF en el filesystem (o un volumen Railway). */
export function almacenamientoLocal(opciones: OpcionesLocal): AdaptadorStorage {
  return {
    async guardar(nombre: string, contenido: Readable): Promise<string> {
      const destino = resolve(join(opciones.dir, nombre));
      await mkdir(dirname(destino), { recursive: true });
      await pipeline(contenido, createWriteStream(destino));
      return opciones.urlBase ? `${opciones.urlBase.replace(/\/$/, "")}/${nombre}` : destino;
    },
  };
}
