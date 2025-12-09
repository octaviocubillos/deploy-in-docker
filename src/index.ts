#!/usr/bin/env node

import { Command } from 'commander';
import { FileStack } from './config';
import manages from './manages';
import { handleError } from './handlers';
import chalk from 'chalk';
import { getDb, closeDbConnection } from './database';
import { DockerManage } from './manages/docker';
import * as crypto from 'crypto';
import spinner from './spinner';
import { saveLocalConfig } from './user-config';

const program = new Command();


program
	.name("oton-pilot")
	.version('0.0.0')
	.description('Una herramienta CLI para desplegar y gestionar aplicaciones en contenedores, ya sea de forma local o remota, utilizando un archivo de configuración stack.yaml.')
	.option('-f, --file <path>', 'Especifica la ruta al archivo de configuración del stack.', 'stack.yaml')
	.option('-p, --profile <string>', 'Define el perfil a utilizar del archivo de configuración.', 'default')
	.addHelpText('after', `
Ejemplos de uso:
  $ oton-pilot deploy -r my-service
  $ oton-pilot -f /path/to/stack.yaml -p production ps
  $ oton-pilot logs -f -c my-container`);

const globalOptions = program.opts();

const getInterface = async () => {
	console.log('obteniendo interface...');
	const stack = new FileStack(globalOptions);

	if (!await stack.getService().isServiceRunning()) {
		console.log('El servicio no está corriendo.');
		return handleError('El servicio no está corriendo.');
	}

	const profile = stack.getProfile();
	const manage = manages[profile.mode]

	if (!manage) {
		return handleError(`Error al obtener manage: ${profile.mode}`);
	}

	return new manage(stack);
}


const dbCommand = new Command('db')
	.description('Gestiona la base de datos de estado local de oton-pilot.');

dbCommand
	.command('create')
	.description('Crea una nueva instancia local de la base de datos en Docker si no existe.')
	.option('-p, --port <number>', 'Port.')
	.action(async (options: { port?: number }) => {
		const instance = await getInterface();
		spinner.start('Verificando el estado de la base de datos local...');
		const dbStatus = await instance.getLocalDbStatus();
		const creds = instance.profile.mongodb;
		if (dbStatus.exists) {
			spinner.succeed('La base de datos local ya existe.');
			console.log(chalk.bold('\nDetalles de la instancia existente:'));
			console.log(`  ${chalk.cyan('Estado:')} ${dbStatus.state}`);
			if (creds?.port) {
				console.log(`  ${chalk.cyan('URI de Conexión:')} mongodb://${creds?.username || '?'}:${creds?.password ? '****' : '?'}@localhost:${creds.port}`);
			}
			if (creds?.username) {
				console.log(`  ${chalk.cyan('Usuario:')} ${creds.username}`);
				console.log(chalk.dim('  (La contraseña está guardada en ~/.config/oton-pilot/credentials.yaml)'));
			}
		} else {
			spinner.info('No se encontró una instancia de base de datos local. Creando una nueva...');
			const port = options.port || creds?.port || 20112;
			const username = creds?.username || 'oton_user';
			const password = creds?.password || crypto.randomBytes(16).toString('hex');

			await instance.createLocalDbContainer({ username, password, port });

			instance.profile.mongodb = { username, password, port };
			if (instance.profile.host)
				instance.profile.mongodb.host = instance.profile.host
			saveLocalConfig(instance.profile);
			console.log(chalk.bold('¡Base de datos creada! Guarda estas credenciales:'));
			console.log(`  ${chalk.cyan('Usuario:')} ${username}`);
			console.log(`  ${chalk.cyan('Contraseña:')} ${password}`);
		}
	});

program.addCommand(dbCommand);


program
	.command('deploy')
	.description('Construye y despliega los servicios definidos en el stack.')
	.option('-r, --resource <name...>', 'Nombre(s) de los recursos específicos a desplegar.')
	.action(async (options: { resource?: string[] }) => {
		try {
			console.log('deploying...');
			const instance = await getInterface();
			await instance.deploy(options.resource);
		} catch (error) {
			handleError(error);
		} finally {
			// cerrar tunnel
		}
	})
	.addHelpText('after', `
Ejemplos:
  $ oton-pilot deploy
  $ oton-pilot deploy -r api-gateway database`);

program
	.command('config')
	.description('Muestra la configuración del stack que se está utilizando.')
	.action(() => {
		try {
			const stack = new FileStack(globalOptions);
			console.log(chalk.green('¡Archivo de configuración cargado!'));
            const output = {
                name: stack.name,
                profile: stack.getProfile(),
                resources: stack.getResources()
            };

			console.log(JSON.stringify(output, null, 2));
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
		const instance = await getInterface();
		await instance.ps(options);
	})
	.addHelpText('after', `
Ejemplos:
  $ oton-pilot ps
  $ oton-pilot ps -a`);

program
	.command('remove')
	.alias('rm')
	.description('Detiene y elimina los contenedores asociados al stack.')
	.action(async () => {
		const instance = await getInterface();
		await instance.removeStack();
	});

program
	.command('logs')
	.description('Muestra los logs de los contenedores del stack.')
	.option('-t, --tail <number>', 'Número de líneas a mostrar desde el final de los logs.', '100')
	.option('-f, --follow', 'Seguir la salida de los logs en tiempo real.', false)
	.option('-c, --container <name_or_id...>', 'Nombre(s) o ID(s) de contenedores específicos.')
	.action(async (options: { tail: string, follow: boolean, container?: string[] }) => {
		const instance = await getInterface();
		const tailCount = parseInt(options.tail, 10);
		if (isNaN(tailCount) || tailCount <= 0) {
			handleError(new Error('--tail debe ser un número positivo.'));
			return;
		}
		await options.follow ? instance.followStackLogs(tailCount, options.container) : instance.showStackLogs(tailCount, options.container);
	})
	.addHelpText('after', `
Ejemplos:
  $ oton-pilot logs
  $ oton-pilot logs -f
  $ oton-pilot logs -t 200 -c my-container`);

try {
	program.parse(process.argv);
} catch (error) {
	handleError(error);
}
