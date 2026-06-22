// @qualitygb/padron-pdf — generador de padrones electorales en PDF.

export { generarPadron } from "./generar";
export { almacenamientoLocal } from "./storage/local";
export type { OpcionesLocal } from "./storage/local";
export { almacenamientoS3 } from "./storage/s3";
export type { OpcionesS3 } from "./storage/s3";
export { fuenteFotosConCache } from "./fotos";

export type {
  CiudadanoPadron,
  AdaptadorStorage,
  MarcaPartido,
  OpcionesPlantilla,
  OpcionesPadron,
  ResultadoPadron,
} from "./tipos";
