import chalk from "chalk";
import { Readable } from "stream";

export function handleError(error: string|unknown) {
  if (error instanceof Error) {
    if ((error as any).statusCode === 404) {
      console.error(chalk.red('Error: Contenedor no encontrado.'));
    } else if ((error as any).code === 'ECONNREFUSED' || (error as any).errno === -111) {
      console.error(chalk.red('Error: No se pudo conectar a Docker.'));
      console.log(chalk.yellow('¿Estás seguro de que Docker está corriendo?'));
    } else {
      console.error(chalk.red(`Error: ${error.message}`));
    }
  } else if (typeof error == "string") {
    console.error(chalk.red(`Error: ${error}`));
    console.error(chalk.red(`Ejecuta did -h o deploy-in-docker -h para obtener ayuda`));
  } else {
    console.error(chalk.red('Ocurrió un error desconocido.'));
  }
  process.exit(1); // Salir con código de error
}

export const streamToString = (stream: Readable | NodeJS.ReadableStream): Promise<string> => {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => {
      chunks.push(chunk); // Collect chunks as Buffers
    });
    stream.on('error', (err) => {
      // Handle stream errors
      console.error(chalk.red("[streamToString]: Error reading stream"), err);
      reject(err);
    });
    stream.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
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