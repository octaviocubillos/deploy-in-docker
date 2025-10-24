import chalk from "chalk";

export function handleError(error: unknown) {
  if (error instanceof Error) {
    if ((error as any).statusCode === 404) {
      console.error(chalk.red('Error: Contenedor no encontrado.'));
    } else if ((error as any).code === 'ECONNREFUSED' || (error as any).errno === -111) {
      console.error(chalk.red('Error: No se pudo conectar a Docker.'));
      console.log(chalk.yellow('¿Estás seguro de que Docker está corriendo?'));
    } else {
      console.error(chalk.red(`Error: ${error.message}`));
    }
  } else {
    console.error(chalk.red('Ocurrió un error desconocido.'));
  }
  process.exit(1); // Salir con código de error
}