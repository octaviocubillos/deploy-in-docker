#!/usr/bin/env node

import { Command } from 'commander';
import { FileStack } from './config';
import manages from './manages';
import { handleError } from './handlers';
import chalk from 'chalk';


const program = new Command();


program
	.name("did")
	.version('0.0.0')
	.description('Una herramienta CLI para desplegar y gestionar aplicaciones en contenedores Docker, ya sea de forma local o remota, utilizando un archivo de configuración stack.yaml.')
	.option('-f, --file <path>', 'Especifica la ruta al archivo de configuración del stack.', 'stack.yaml')
	.option('-p, --profile <string>', 'Define el perfil a utilizar del archivo de configuración.', 'default')
	.addHelpText('after', `
Ejemplos de uso:
  $ did deploy -r my-service
  $ did -f /path/to/stack.yaml -p production ps
  $ did logs -f -c my-container`);

const globalOptions = program.opts(); 

const getInterface = () => {
	const stack = new FileStack(globalOptions);
	const profile = stack.getProfile();
	const manage = manages[profile.mode]

	if(!manage){
		return handleError(`Error al obtener manage: ${profile.mode}`);
	}

	return new manage(stack);
}

program
  .command('deploy')
  .description('Construye y despliega los servicios definidos en el stack.')
  .option('-r, --resource <name...>', 'Nombre(s) de los recursos específicos a desplegar.')
  .action(async (options: { resource?: string[] }) => { 
    try {
		const instance = getInterface();
		await instance.deploy(options.resource);
    } catch (error) {
      	handleError(error);
    }
  })
  .addHelpText('after', `
Ejemplos:
  $ did deploy
  $ did deploy -r api-gateway database`);

program
  .command('config')
  .description('Muestra la configuración del stack que se está utilizando.')
  .action(() => {
	try {
		const stack = new FileStack(globalOptions);
		console.log(chalk.green('¡Archivo de configuración cargado!'));
		console.log(JSON.stringify(stack.config, null, 2));
	} catch (error) {
		handleError(error);
	}
  });

program
	.command('ps')
	.alias('ls')
	.description('Lista los contenedores asociados al stack del perfil actual.')
	.option('-a, --all', 'Mostrar todos los contenedores (en ejecución y detenidos).', false)
	.action(async (options: { all: boolean }) => {
			const instance = getInterface();
			await instance.ps(options);
	})
	.addHelpText('after', `
Ejemplos:
  $ did ps
  $ did ps -a`);

program
	.command('remove')
	.alias('rm')
	.description('Detiene y elimina los contenedores asociados al stack.')
	.action(async () => {
		const instance = getInterface();
		await instance.removeStack();
	});

program
	.command('logs')
	.description('Muestra los logs de los contenedores del stack.')
	.option('-t, --tail <number>', 'Número de líneas a mostrar desde el final de los logs.', '100')
  	.option('-f, --follow', 'Seguir la salida de los logs en tiempo real.', false)
	.option('-c, --container <name_or_id...>', 'Nombre(s) o ID(s) de contenedores específicos.')
	.action(async (options: { tail: string, follow: boolean,container?: string[] }) => {
		const instance = getInterface();
		const tailCount = parseInt(options.tail, 10);
		if (isNaN(tailCount) || tailCount <= 0) {
			handleError(new Error('--tail debe ser un número positivo.'));
			return;
		}
		await options.follow ? instance.followStackLogs(tailCount, options.container) : instance.showStackLogs(tailCount, options.container);
	})
	.addHelpText('after', `
Ejemplos:
  $ did logs
  $ did logs -f
  $ did logs -t 200 -c my-container`);

try {
   program.parse(process.argv);
} catch (error) {
    handleError(error);
}