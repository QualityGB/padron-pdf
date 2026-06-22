import { S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import type { Readable } from "node:stream";
import type { AdaptadorStorage } from "../tipos";

export interface OpcionesS3 {
  /** Endpoint S3. Para AWS, omitir. Para Bunny/MinIO/Railway, su endpoint S3. */
  endpoint?: string;
  region?: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Prefijo de ruta dentro del bucket (ej. "padrones/"). */
  prefijo?: string;
  /** Base de URL pública (ej. CDN de Bunny). Default: URL del endpoint. */
  urlPublica?: string;
  /** Necesario para MinIO/algunos compatibles. Default true si hay endpoint. */
  forcePathStyle?: boolean;
}

/**
 * Guarda el PDF en un storage S3-compatible: cubre AWS S3, Bunny Storage (vía su
 * gateway S3), MinIO y buckets de Railway. Sube por streaming (multipart), así
 * que el PDF nunca se carga entero en memoria.
 */
export function almacenamientoS3(opciones: OpcionesS3): AdaptadorStorage {
  const cliente = new S3Client({
    region: opciones.region ?? "auto",
    endpoint: opciones.endpoint,
    forcePathStyle: opciones.forcePathStyle ?? Boolean(opciones.endpoint),
    credentials: { accessKeyId: opciones.accessKeyId, secretAccessKey: opciones.secretAccessKey },
  });
  const prefijo = (opciones.prefijo ?? "").replace(/^\//, "");

  return {
    async guardar(nombre: string, contenido: Readable): Promise<string> {
      const key = `${prefijo}${nombre}`;
      const subida = new Upload({
        client: cliente,
        params: { Bucket: opciones.bucket, Key: key, Body: contenido, ContentType: "application/pdf" },
      });
      await subida.done();
      if (opciones.urlPublica) return `${opciones.urlPublica.replace(/\/$/, "")}/${key}`;
      const base = opciones.endpoint?.replace(/\/$/, "") ?? `https://${opciones.bucket}.s3.${opciones.region ?? "us-east-1"}.amazonaws.com`;
      return opciones.endpoint ? `${base}/${opciones.bucket}/${key}` : `${base}/${key}`;
    },
  };
}
