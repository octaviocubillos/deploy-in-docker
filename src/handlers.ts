import { logger } from './logger';
import { Readable } from 'stream';

export const handleError = (error: any) => {
  let errorMessage: string;

  if (error instanceof Error) {
    errorMessage = error.message;
  } else if (typeof error == "string") {
    errorMessage = error;
  } else {
    errorMessage = 'Ocurrió un error desconocido.';
  }
  logger.error(errorMessage);
  // Opcional: mantener la ayuda para errores de CLI
  if (typeof error !== 'object' || !('command' in error)) {
      logger.info(`Ejecuta oton-pilot --help para obtener ayuda.`);
  }
  throw error;
  // process.exit(1); // Salir con código de error

}

export const streamToString = (stream: Readable | NodeJS.ReadableStream): Promise<string> => {
	const chunks: Buffer[] = [];
	return new Promise((resolve, reject) => {
	  stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
	  stream.on('error', (err) => reject(err));
	  stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
	});
};

export const deepMergeObjects = (...objects:any) => {
  const deepCopyObjects = objects.map((object: any) =>
    JSON.parse(JSON.stringify(object))
  );
  return deepCopyObjects.reduce(
    (merged: any, current: any) => ({ ...merged, ...current }),
    {}
  );
};