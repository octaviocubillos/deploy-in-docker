import chalk from 'chalk';
import Docker from 'dockerode';
import Table from 'cli-table3';
import path from 'path';
import fs from 'fs';
import readline from 'readline/promises'; 

import { deepMergeObjects, handleError, streamToString } from '../handlers';
import { Manage, Profile } from '../types';
import { FileStack, Resource } from '../config';
import * as tar from 'tar-fs'; 

import Templates from '../templates';
import spinner from '../spinner';
import { Readable, Writable } from 'stream'; // Importa Writable también
import { PassThrough } from 'stream'; // Para crear streams intermedios
import { version } from 'os';



const COLORS = [chalk.cyan, chalk.magenta, chalk.blue, chalk.yellow, chalk.green];



export class DockerManage implements Manage {
    stack: FileStack;
    profile: Profile;
    docker: Docker;

    deployFolder: string = ".deploy"

    constructor(stack: FileStack) {
        this.profile = stack.getProfile()
        this.stack = stack;
        this.docker = new Docker(this.profile.protocol == "local" ? undefined: this.profile as Docker.DockerOptions);
    }

    deploy = async (resourceOptions?: string[]) => {
        console.log(`Comenzando despliegue a: [${this.profile.protocol}]${this.profile.host || ""}`)
        const resources = this.stack.getResources(resourceOptions);
        for( const resource of resources) {
            console.log(`Desplegando ${this.stack.name}-${resource.name}`);

            resource.version = await this.getNextVersion(resource.name);

            resource.templateObj.process(resource)
            
            resource.imageName = await this.createImage(resource)
            await this.clean(resource.name)
            await this.start(resource);

        }
    }

    ps = async (options: { all: boolean }) => {
        try {
            const filters = {
                label: [
                    'deploy-in-docker' 
                ]
            };
            
            const containers = (await this.docker.listContainers({
                all: options.all,
                filters: JSON.stringify(filters)
            })).filter(container => {
                return container.Labels && Object.entries(container.Labels).find(([k, v]) => k == 'stack' && v == this.stack.name);
            });

    
            if (containers.length === 0) {
                console.log(chalk.yellow('No se encontraron contenedores.'));
                return;
            }

            containers.forEach(c => console.log(c.Ports))

            const table = new Table({
                head: [
                    chalk.cyan('ID'),
                    chalk.cyan('Nombre'),
                    chalk.cyan('Imagen'),
                    chalk.cyan('Estado'),
                    chalk.cyan('Status'),
                    chalk.cyan('Networks'),
                    chalk.cyan('PrivatePorts')
                ]
            });
            console.log(containers[0].HostConfig)
            containers.forEach(c => {
                table.push([
                    c.Id.substring(0, 12),
                    c.Names.map(n => n.replace('/', '')).join(', '),
                    c.Image,
                    c.State,
                    c.Status,
                    Object.keys(containers[0].NetworkSettings.Networks).join(),
                    Object.values(c.Ports).reduce((acc, portInfo) => (!acc.includes(portInfo.PrivatePort)? [...acc, portInfo.PrivatePort]:[...acc]), [] as number[]).join(", ")
                ]);
            });
        
            console.log(table.toString());
    
        } catch (error) {
            handleError(error);
        }
    }

    followStackLogs = async (tail: number, specificContainers?:string[]): Promise<void> => {
        const activeStreams: Readable[] = []; 
        const cleanupStreams: (()=>void)[] = [];

        const cleanup = () => {
            console.log(chalk.yellow('\n\nDeteniendo seguimiento de logs...'));
            cleanupStreams.forEach(clean => clean()); 
            activeStreams.forEach(stream => stream.destroy());
            process.exit(0);
        };

        process.on('SIGINT', cleanup);

        try {
            console.log(chalk.blue(`Buscando contenedores gestionados en '${this.stack.name}'...`));

            const allContainers = await this.docker.listContainers({ 
                all: !!specificContainers?.at(0),
                filters: JSON.stringify({
                    label: [
                        'deploy-in-docker' 
                    ]
                }) 
            });

            
            let containersToShow: Docker.ContainerInfo[] = allContainers; // Por defecto, mostrar todos los gestionados
            if (specificContainers && specificContainers.length > 0) {
                console.log(chalk.blue(`Filtrando por: ${specificContainers.join(', ')}`));
                containersToShow = allContainers.filter(c => {
                    const shortId = c.Id.substring(0, 12);
                    const names = c.Names.map(n => n.replace('/', '').split("-").at(0));
                    const baseName = c.Names.map(n => n.replace('/', ''));
                    return specificContainers.some(requested =>
                        shortId === requested || names.includes(requested) || baseName.includes(requested)
                    );
                });

                if (containersToShow.length === 0) {
                    console.log(chalk.yellow(`No se encontraron contenedores gestionados que coincidan con los nombres/IDs especificados.`));
                    return;
                }
            }
            if (containersToShow.length === 0) {
                console.log(chalk.yellow(`No se encontraron contenedores gestionados (corriendo) en '${this.stack.name}'.`));
                return;
            }

            console.log(chalk.blue(`Siguiendo logs para ${containersToShow.length} contenedor(es)... (Ctrl+C para detener)`));
            console.log(chalk.dim('---'));

            containersToShow.forEach(async (containerInfo, index) => {
                const containerIdShort = containerInfo.Id.substring(0, 12);
                let containerName = containerInfo.Names.map(n => n.replace('/', '').split("-").at(0)).join(',') || containerIdShort;
                let color = COLORS[index % COLORS.length];
                let prefix = color(`[${containerName}] `);

                if(containerInfo.State !== "running"){
                    containerName = containerInfo.Names.map(n => n.replace('/', '')).join(',') || containerIdShort;
                    color = chalk.grey;
                    prefix = color(`[${containerName} ${containerInfo.State}] `);
                }

                try {
                    const container = this.docker.getContainer(containerInfo.Id);
                    const logStream = await container.logs({
                        stdout: true,
                        stderr: true,
                        follow: true,
                        tail: tail
                    });

                    if (typeof logStream?.pipe !== 'function') {
                        console.warn(chalk.yellow(`  ↳ No se pudo obtener stream de logs para ${containerName}.`));
                        return;
                    }

                    const rawStream = logStream as Readable;
                    activeStreams.push(rawStream);
                    const stdoutWithPrefix = new PassThrough();
                    const stderrWithPrefix = new PassThrough();
                    this.docker.modem.demuxStream(rawStream, stdoutWithPrefix, stderrWithPrefix);

                    const addPrefix = (stream: PassThrough, target: NodeJS.WriteStream) => {
                        let buffer = '';
                        stream.on('data', (chunk: Buffer) => {
                            buffer += chunk.toString('utf8');
                            let lines = buffer.split('\n');
                            buffer = lines.pop() || '';
                            lines.forEach(line => {
                                if (line.trim()) {
                                    target.write(prefix + line + '\n');
                                }
                            });
                        });
                        stream.on('end', () => {
                            if (buffer.trim()) { 
                                target.write(prefix + buffer + '\n');
                            }
                        });
                    };

                    addPrefix(stdoutWithPrefix, process.stdout);
                    addPrefix(stderrWithPrefix, process.stderr);

                    cleanupStreams.push(() => {
                        stdoutWithPrefix.end();
                        stderrWithPrefix.end();
                    });
                    rawStream.on('error', (err) => {
                        console.error(chalk.red(`\nError en stream de logs para ${containerName}: ${err.message}`));
                    });
                    rawStream.on('end', () => {
                        console.log(chalk.gray(`\nStream de logs para ${containerName} finalizado.`));
                    });


                } catch (logError) {
                    console.error(chalk.yellow(`\n↳ No se pudieron seguir los logs para ${containerName}: ${(logError as Error).message}`));
                }
            });

        } catch (error) {
            handleError(error);
            cleanup();
        }
    }

    showStackLogs = async (tailCount: number): Promise<void> => {

        try {

            if (isNaN(tailCount) || tailCount <= 0) {
                handleError(new Error('--tail debe ser un número positivo.'));
                return;
            }

            console.log(chalk.blue(`Buscando contenedores gestionados por 'did' en '${this.stack.name}' para obtener logs...`));

            // 1. Encontrar los contenedores relevantes (incluyendo detenidos)
            const allContainers = await this.docker.listContainers({ all: true });
            const managedContainers = allContainers.filter(container =>
                container.Labels && (container.Labels.hasOwnProperty('did') || container.Labels.hasOwnProperty('deploy-in-docker'))
            );

            if (managedContainers.length === 0) {
                console.log(chalk.yellow(`No se encontraron contenedores gestionados por 'did' en '${this.stack.name}'.`));
                return;
            }

            console.log(chalk.blue(`Obteniendo las últimas ${tailCount} líneas de logs para ${managedContainers.length} contenedor(es)...`));

            for (const containerInfo of managedContainers) {
                const containerIdShort = containerInfo.Id.substring(0, 12);
                const containerNames = containerInfo.Names.map(n => n.replace('/', '')).join(', ');
                console.log(chalk.cyan(`\n===== Logs para ${containerNames} (${containerIdShort}) =====`));
                try {
                    const container = this.docker.getContainer(containerInfo.Id);
                    let logOutput = await container.logs({
                        stdout: true,
                        stderr: true,
                        follow: false,
                        tail: tailCount
                    });

                    const logString = logOutput.toString('utf8');
                    if (logString.trim()) {
                        console.log(logString.trim());
                    } else {
                        console.log(chalk.dim('(No se encontraron logs recientes)'));
                    }
                    

                } catch (logError) {
                    console.error(chalk.yellow(`  ↳ No se pudieron obtener logs para ${containerIdShort}: ${(logError as Error).message}`));
                }
            } 

            console.log(chalk.cyan('\n===== Fin de los logs ====='));

        } catch (error) {
            handleError(error);
        }
    }

    removeStack = async (): Promise<void> => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); 

        try {
            console.log(chalk.yellow(`Searching for containers managed by 'did' on '${this.stack.name}' to remove...`));

            const containers = (await this.docker.listContainers({
                all: true,
                filters: JSON.stringify({
                    label: [
                        'deploy-in-docker' 
                    ]
                })
            }) || []).filter(container => {
                return container.Labels && Object.entries(container.Labels).find(([k, v]) => k == 'stack' && v == this.stack.name);
            });

            if (containers.length === 0) {
                console.log(chalk.green(`No containers managed by 'did' found on '${this.stack.name}'. Nothing to do.`));
                return;
            }
            console.log(chalk.red.bold(`\nWARNING! The following ${containers.length} containers on '${this.stack.name}' will be stopped and permanently removed:`));
            
            const table = new Table({
                head: [
                    chalk.cyan('ID'),
                    chalk.cyan('Nombre'),
                    chalk.cyan('Imagen'),
                    chalk.cyan('Estado'),
                    chalk.cyan('Status'),
                    chalk.cyan('Networks'),
                    chalk.cyan('Ports')
                ]
            });
            
            containers.forEach(c => {
                table.push([
                    c.Id.substring(0, 12),
                    c.Names.map(n => n.replace('/', '')).join(', '),
                    c.Image,
                    c.State,
                    c.Status,
                    Object.keys(containers[0].NetworkSettings.Networks).join(),
                    Object.values(c.Ports).reduce((acc, portInfo) => (!acc.includes(portInfo.PrivatePort)? [...acc, portInfo.PrivatePort]:[...acc]), [] as number[]).join(", ")
                ]);
            }); 

            console.log(table.toString())

            const answer = await rl.question(chalk.red('\nAre you sure you want to continue? (y/N): '));

            if (answer.toLowerCase() !== 'y') {
                console.log(chalk.yellow('Operation cancelled by user.'));
                return; 
            }

            console.log(chalk.blue(`\nProceeding to stop and remove ${containers.length} containers...`));
            let successCount = 0;
            let errorCount = 0;

            for (const containerInfo of containers) {
            const containerIdShort = containerInfo.Id.substring(0, 12);
            const containerNames = containerInfo.Names.map(n => n.replace('/', '')).join(', ');
            process.stdout.write(chalk.dim(`  Processing: ${containerNames} (${containerIdShort})... `)); // Use write to stay on the same line

            try {
                const container = this.docker.getContainer(containerInfo.Id);
                process.stdout.write(chalk.dim('Stopping... '));
                await container.stop().catch(err => {
                    if ((err as any)?.statusCode !== 304 && !err.message.includes('Container already stopped')) { // 304 = Not Modified (already stopped)
                        process.stdout.write(chalk.yellow(`(warn: ${err.message}) `)); // Show other stop errors as warnings
                    } else {
                        process.stdout.write(chalk.dim('(already stopped) '));
                    }
                });
                
                process.stdout.write(chalk.dim('Removing container... '));
                await container.remove({ force: false }); // force: false is safer, stop should have worked
                
                const image = this.docker.getImage(containerInfo.Image);
                process.stdout.write(chalk.dim('Removing Image... '));
                await image.remove({ force: true });
                console.log(chalk.green('OK.'));
                successCount++;

                } catch (containerError) {
                    console.log(chalk.red('FAIL.')); // New line after fail
                    console.error(chalk.yellow(`    ↳ Error processing ${containerIdShort}: ${(containerError as Error).message}`));
                    errorCount++;
                }
            }

            console.log(chalk.green(`\nFinished removing containers.`));
            console.log(chalk.green(`  Successfully removed: ${successCount}`));
            if (errorCount > 0) {
                console.log(chalk.red(`  Failed to remove: ${errorCount}`));
            }

        } catch (error) {
            handleError(error);
        } finally {
            rl.close();
        }
    }

    private start = async (resource: Resource) => {
        try {
            const {imageName, spec, name, version, environment, templateObj} = resource;
        
            console.log(chalk.blue(`Iniciando contenedor '${name}' con la image '${imageName}'...`));

            spec.networks ||= []
            if (spec.networks.at(0)) {
                for (const networkName of spec.networks) {
                    await this.ensureNetworkExists(networkName);
                }
            }

            environment.PORT ||= spec.port;

            
            const container = await this.docker.createContainer({
                Image: imageName,
                name: `${name}-${version}`,
                Env: this.formatEnvironment(environment),
                Hostname: spec.hostname || `${this.stack.name}.${name}`.toLowerCase(),
                ExposedPorts: spec.port ? {
                    [`${spec.port}/tcp`]: {}
                }: {},
                Labels: {
                    ...spec.label, 
                    "deploy-in-docker": "0.0.0", 
                    "stack": this.stack.name,
                    "com.docker.compose.project": this.stack.name
                },
                HostConfig: {
                    Binds: templateObj.volume ? [
                        templateObj.volume.replace('{volumeName}', `${this.stack.name}-${name}`)
                    ]: [],
                    PortBindings: spec.port ? {
                        [`${templateObj.port || spec.port}/tcp`]: [{ HostPort: `${spec.port}` }]
                    } : {},
                    RestartPolicy: {
                        Name: spec.restart || ""
                    } ,
                    CpuPeriod: 100000,
                    CpuQuota: spec.cpus ? 100000 * parseFloat(spec.cpus): undefined,
                    Memory: spec.memory ? parseInt(spec.memory) * 1024 * 1024 : undefined,
                    ExtraHosts: spec['add-host'],
                    NetworkMode: spec.networks?.[0] || undefined
                },
                Cmd: spec.cmd ? spec.cmd.split(" "): undefined
            });


            for (const networkName of spec.networks) {
                const network = this.docker.getNetwork(networkName);
                await network.connect({ Container: container.id });
                spinner.succeed(`Contenedor '${container.id.substring(0, 12)}' conectado a la red '${networkName}'.`);
            }

            await container.start();
            console.log(chalk.green(`Contenedor '${imageName}' iniciado exitosamente.`));
        } catch (error) {
            handleError(error);
        }
    }

    private formatEnvironment = (envObject?: { [key: string]: string }): string[] => {
        if (!envObject) {
            return [];
        }
        return Object.entries(envObject).map(([key, value]) => `${key}=${value}`);
    }

    private getNextVersion = async (name: string) => {
        console.log(`ℹ️  Obteniendo siguiente version para el despliegue`)
        spinner.start(`Buscando ultima versiones de '${name}'`)
        let last = 0;
        const containers = await this.docker.listContainers({ all: true, filters: { name: [ `^/${name}.*` ] }})

        if(!containers.at(0)){
          spinner.succeed(" -> No se encontraron otras versiones.")
          return last;
        }

        for (const container of containers) {
            const containerName = container.Names.at(0);
            const v = Number(containerName?.split('-').at(1))
            if(v > last) last = v
        }
        spinner.succeed(`Ultima version encontrada ${last}`)
        return last + 1
    }

    private createImage = async (resource: Resource) => {  
        console.log(`ℹ️  Creando nueva imagen para el despliegue`)
        const {templateObj} = resource;

        let dockerFile = templateObj.dockerfileTemplate;
        for (const str of ['handler', 'port', 'imageName']) {
            if (dockerFile.includes(`{${str}}`)) {
                (resource as any)[str] && (dockerFile = dockerFile.replaceAll(`{${str}}`, (resource as any)[str]));
                (resource.props as any)[str] && (dockerFile = dockerFile.replaceAll(`{${str}}`, (resource.props as any)[str]));
            }
        }
        fs.writeFileSync(path.join(resource.folder.deploy, "Dockerfile"), dockerFile);

        const imageName = `${this.stack.name}-${resource.name}:${resource.version}`.toLowerCase();
        const options :Docker.ImageBuildOptions  = {
            t: imageName,
            dockerfile: 'Dockerfile',
            labels: {"dd-cli": "0.0.0"}, 
            forcerm: true
        };
        
        if(resource.codeUri){
            this.copyDirectoryRecursive(resource.folder.code, resource.folder.deploy)
        }

        const pack = tar.pack(resource.folder.deploy, {
            
            map: (header) => {
            if (header.name === 'Dockerfile') {
                return header;
            }
            header.name = path.join('app', header.name);
            return header;
            }
        });

        spinner.start('Compilando imagen de Docker')

        try {
            const stream = await this.docker.buildImage(pack, options);
            
            const res = await new Promise((resolve, reject) => {
                this.docker.modem.followProgress(stream, (err, res) => {
                    if (err) {
                        console.log(err)
                        return reject(err);
                    }
                    resolve(res);
                });
            });
            if((res as any[]).find(i => i.error)){
                for(const e of (res as any[])){
                    if(e.stream == '\n' || typeof e.stream !== 'string') continue;
                    spinner.succeed(e.stream.replaceAll('\n', ''))
                }
                // spinner.fail((res as any[]).find(i => i.error).error)

                handleError((res as any[]).find(i => i.error).error);
            }

            spinner.succeed(`Imagen '${imageName}' compilada exitosamente.`);
            return imageName;
        } catch (err) {
            const error = err as any;
            handleError(`Error al compilar la imagen: ${error.message}`)
            return "";
        }
    }

    private clean = async (name:string, containersToKeep: number = 5) => {
        console.log(`ℹ️  Obteniendo contenedores para limpieza `)
        spinner.succeed(`Buscando contenedores con prefijo '${name}' para limpiar...`)
        const filtros = { name: [ `^/${name}-.*` ] };

        try {
            const containers = await this.docker.listContainers({ all: true, filters: filtros });

            if (!containers.at(0)) {
                spinner.info(`No se encontraron contenedores que coincidan con el nombre '${name}'.`);
                return;
            }

            console.log(`ℹ️  Deteniendo contenedores en ejecución`)
            for(const containerInfo of containers){
                const containerId = containerInfo.Id;
                const name = containerInfo.Names[0].substring(1);
                const container = this.docker.getContainer(containerId);

                if (containerInfo.State === 'running') {
                    spinner.start(`Deteniendo contenedor: ${name} (${containerId})`);
                    await container.stop();
                    spinner.succeed(`Contenedor ${name} (${containerId}) detenido exitosamente`)
                }

            }

            containers.sort((a, b) => b.Created - a.Created);

            const containersToRemove = containers.slice(5-1);

            if (!containersToRemove.at(0)) {
                spinner.succeed(chalk.green(`No hay suficientes contenedores para eliminar. Se conservan los ${containersToKeep} más recientes.`));
                return;
            }

            
            spinner.succeed(`Se encontraron ${containers.length} contenedores. Eliminando ${containersToRemove.length} más antiguos...`)

            for (const containerInfo of containersToRemove) {
                const containerId = containerInfo.Id;
                const name = containerInfo.Names[0].substring(1);
                const container = this.docker.getContainer(containerId);

                spinner.change(`Eliminando contenedor: ${name} (${containerId.substring(0, 12)})`);
                await container.remove({ force: true });
                const image = this.docker.getImage(containerInfo.Image);
                await image.remove({ force: true });
            }

            spinner.succeed(chalk.green(`Proceso completado. Se eliminaron ${containersToRemove.length} contenedores.`));

        } catch (err) {
            spinner.fail(chalk.red(`Ocurrió un error al limpiar los contenedores: ${err}`));
            console.error(err);
        }
        return true;
    }

    private ensureNetworkExists = async (networkName: string) => {
    try {
        const networks = await this.docker.listNetworks({
            filters: { name: [networkName] }
        });

        if (networks.length === 0) {
            spinner.fail(`Red '${chalk.cyan(networkName)}' no encontrada. Creándola...`);
            await this.docker.createNetwork({
                Name: networkName,
                CheckDuplicate: true // Prevenir errores si otra red con el mismo nombre es creada simultáneamente
            });
            spinner.succeed(chalk.green(`Red '${chalk.cyan(networkName)}' creada.`));
        } else {
            spinner.info(`Red '${chalk.cyan(networkName)}' ya existe.`);
        }
    } catch (err: any) {
        spinner.fail(chalk.red(`Error al verificar/crear la red '${networkName}': ${err.message}`));
        throw err;
    }
    }

    private copyDirectoryRecursive = (source: string, destination: string): void => {
        try {
            spinner.start("copiando archivos")
            if (!fs.existsSync(destination)) {
            fs.mkdirSync(destination, { recursive: true });
                console.log(chalk.dim(`  Directorio creado: ${destination}`));
            }

            const items = fs.readdirSync(source);

            items.forEach((item) => {
            const sourcePath = path.join(source, item);
            const destinationPath = path.join(destination, item);

            const stats = fs.statSync(sourcePath);

            if (stats.isDirectory()) {
                spinner.succeed(`Copiando directorio ${sourcePath}`)
                this.copyDirectoryRecursive(sourcePath, destinationPath);
            } else if (stats.isFile()) {
                
                fs.copyFileSync(sourcePath, destinationPath);
                spinner.succeed(`Archivo copiado ${sourcePath}`)
            }
            });
        } catch (error) {
            throw new Error(`Error copiando ${source} a ${destination}: ${(error as Error).message}`);
        }
    }
}