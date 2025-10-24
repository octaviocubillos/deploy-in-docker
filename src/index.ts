#!/usr/bin/env node

import { Command } from 'commander';
import { FileStack } from './config';
import manages from './manages';


const program = new Command();

program
  .version('1.0.0')
  .description('Un CLI simple para gestionar Docker local');


program
  .option('-f, --file <path>', 'Ruta del archivo para leer los datos', 'stack.yaml')
  .option('-p, --profile <str>', 'profileprofile', 'default');

  
program.parse(process.argv);

const stack = new FileStack(program.opts())

const profile = stack.getProfile()

if (!profile){
  console.error(`Error al obtener profile: ${program.opts().profile}`);
  process.exit(1);
}

const manage = manages[profile.mode];

if(!manage){
  console.error(`Error al obtener profile: ${program.opts().profile}`);
  process.exit(1);
}

const instance = new manage(profile.protocol  == 'local' ? undefined : profile);

program
  .command('ps')
  .description('Listar contenedores')
  .option('-a, --all', 'Mostrar todos los contenedores (incluidos detenidos)', false)
  .option('-o', 'oooo', false)
  .action(instance.ps);

program
  .command('deploy')
  .description('deploy')
  .option('-f, --file <path>', 'Ruta del archivo para leer el nombre')
  .action(() => instance.deploy(stack))

// --- Comando: start ---
// program
//   .command('start <id>')
//   .description('Iniciar un contenedor por ID o nombre')
//   .action(async (id: string) => {
//     try {
//       console.log(chalk.blue(`Iniciando contenedor '${id}'...`));
//       const container = docker.getContainer(id);
//       await container.start();
//       console.log(chalk.green(`Contenedor '${id}' iniciado exitosamente.`));
//     } catch (error) {
//       handleError(error);
//     }
//   });

// --- Comando: stop ---
// program
//   .command('stop <id>')
//   .description('Detener un contenedor por ID o nombre')
//   .action(async (id: string) => {
//     try {
//       console.log(chalk.blue(`Deteniendo contenedor '${id}'...`));
//       const container = docker.getContainer(id);
//       await container.stop();
//       console.log(chalk.yellow(`Contenedor '${id}' detenido exitosamente.`));
//     } catch (error) {
//       handleError(error);
//     }
//   });

// Parsear los argumentos y ejecutar el comando
program.parse(process.argv);
