import type { Readable } from "node:stream";

/** Un ciudadano en el padrón. Solo `cedula` es obligatoria; el resto se imprime si viene. */
export interface CiudadanoPadron {
  cedula: string;
  nombres?: string | null;
  apellido1?: string | null;
  apellido2?: string | null;
  sexo?: string | null;
  fechanacimiento?: string | null;
  provincia?: string | null;
  municipio?: string | null;
  recinto?: string | null;
  colegio?: string | null;
  /** Campos extra a mostrar como "etiqueta: valor". */
  extra?: Record<string, string | null | undefined>;
}

/** Adaptador de almacenamiento del PDF. Recibe el PDF como stream y devuelve su URL/ruta. */
export interface AdaptadorStorage {
  guardar(nombre: string, contenido: Readable): Promise<string>;
}

/** Marca/distintivo del partido para estampar en cada página. */
export interface MarcaPartido {
  /** Texto del sello (ej. "PARTIDO XYZ — USO INTERNO"). */
  texto?: string;
  /** Logo (PNG/JPG) en el encabezado. */
  logo?: Buffer;
  /** Opacidad del sello de fondo (0–1). Default 0.08. */
  opacidad?: number;
  /** Color del sello (hex). Default gris. */
  color?: string;
}

export interface OpcionesPlantilla {
  /** Título principal del padrón. */
  titulo: string;
  /** Subtítulo/ámbito (ej. "Provincia: Santiago — Recinto: Liceo X"). */
  subtitulo?: string;
  /** Mostrar la foto del ciudadano. Default true. */
  conFoto?: boolean;
  /** Tamaño de la foto en puntos. Default 48. */
  tamanoFoto?: number;
  /** Pie de página (ej. nombre del partido + fecha). */
  pie?: string;
}

export interface OpcionesPadron {
  /** Fuente de ciudadanos: async iterable (la librería los consume en streaming). */
  fuenteDatos: AsyncIterable<CiudadanoPadron>;
  /** Foto por cédula (Buffer JPEG/PNG) o null si no hay. Recomendado: con caché. */
  fuenteFotos?: (cedula: string) => Promise<Buffer | null>;
  /** Dónde guardar el PDF. */
  storage: AdaptadorStorage;
  /** Nombre del archivo de salida (ej. "padron-santiago.pdf"). */
  nombreArchivo: string;
  /** Diseño. */
  plantilla: OpcionesPlantilla;
  /** Marca del partido (opcional). */
  marca?: MarcaPartido;
  /** Concurrencia de descarga de fotos. Default 8. */
  concurrenciaFotos?: number;
  /** Callback de progreso cada N ciudadanos. */
  onProgreso?: (procesados: number) => void;
}

export interface ResultadoPadron {
  /** URL o ruta del PDF guardado. */
  url: string;
  /** Total de ciudadanos impresos. */
  total: number;
  /** Páginas generadas. */
  paginas: number;
}
