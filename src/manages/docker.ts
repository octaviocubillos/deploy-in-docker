import chalk from 'chalk';
import Docker from 'dockerode';
import Table from 'cli-table3';
import path from 'path';
import fs from 'fs';
import readline from 'node:readline/promises';   

import { deepMergeObjects, handleError, streamToString } from '../handlers';
import { Manage, Profile } from '../types';
import { FileStack, Resource } from '../config';
import * as tar from 'tar-fs'; 

import spinner from '../spinner';
import { Readable, Writable } from 'stream'; // Importa Writable también
import { PassThrough } from 'stream'; // Para crear streams intermedios
import { exec } from 'child_process';
import { promisify } from 'util';



const COLORS = [chalk.cyan, chalk.magenta, chalk.blue, chalk.yellow, chalk.green];

type Logger = {
    (msg: string): void;
    log: (msg: string) => void;
    error: (msg: string) => void;
    info: (msg: string) => void;
    succeed: (msg: string) => void;
    fail: (msg: string) => void;
    start: (msg: string) => void;
    change: (msg: string) => void;
    warn: (msg: string) => void;
}

const createLogger = (prefix: string, color: chalk.Chalk): Logger => {
    const p = color(`[${prefix}]`);
    const logger = ((msg: string) => console.log(`${p} ${msg}`)) as Logger;
    logger.log = (msg) => console.log(`${p} ${msg}`);
    logger.error = (msg) => console.error(`${p} ${chalk.red(msg)}`);
    logger.info = (msg) => console.log(`${p} ${chalk.blue(msg)}`);
    logger.succeed = (msg) => console.log(`${p} ${chalk.green('✔ ' + msg)}`);
    logger.fail = (msg) => console.error(`${p} ${chalk.red('✖ ' + msg)}`);
    logger.start = (msg) => console.log(`${p} ${chalk.cyan('⧗ ' + msg)}`);
    logger.change = (msg) => console.log(`${p} ${chalk.cyan('⧗ ' + msg)}`);
    logger.warn = (msg) => console.log(`${p} ${chalk.yellow('⧗ ' + msg)}`);
    return logger;
}



export class DockerManage implements Manage {
    stack: FileStack;
    profile: Profile;
    docker: Docker;
    logger: {[key: string]: Logger};

    constructor(stack: FileStack) {
        this.profile = stack.profile
        this.stack = stack;
        this.docker = new Docker(this.profile.protocol == "local" ? undefined: this.profile as Docker.DockerOptions);
        
        this.logger = new Proxy({}, {
            get: (target: any, prop: string) => {
                if (prop === 'then') return undefined;
                if (!target[prop]) {
                    const color = COLORS[Object.keys(target).length % COLORS.length];
                    target[prop] = createLogger(prop, color);
                }
                return target[prop];
            }
        });
    }

    deploy = async (resourceOptions?: string[]) => {

        // await this.ensurePilotService();
        console.log(`Comenzando despliegue a: [${this.profile.protocol}]${this.profile.host || ""}`)
        const service  = this.stack.getService();
        
        const lastStatus = await service.getLast(this.stack.name);
        
        const allResources = this.stack.getResources();
        
        const targetNames = resourceOptions && resourceOptions.length > 0 
            ? resourceOptions 
            : allResources.map(r => r.name);

        const resourcesToDeploy: Resource[] = [];
        const allResourcesWithStatus: Resource[] = [];

        console.log("Calculando diferencias con el despliegue anterior...");
        
        const lastResourcesMap = new Map<string, { name: string; version?: string; extra?: any }>();

        if (lastStatus?.resources) {
            lastStatus.resources.forEach((r: { name: string; version?: string; extra?: any }) => lastResourcesMap.set(r.name, r));
        }

        const currentResourceNames = allResources.map(r => r.name);
        const missingResources = [...lastResourcesMap.values()].filter(r => !currentResourceNames.includes(r.name));
        const newResources = allResources.filter(r => !lastResourcesMap.has(r.name));

        if (missingResources.length > 0 && newResources.length > 0) {
            const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
            
            console.log(chalk.yellow('\nSe detectaron cambios en los nombres de los recursos.'));
            
            for (const newRes of newResources) {                
                for (const missingRes of missingResources) {
                    if (lastResourcesMap.has(missingRes.name)) { // Check if still available (not already mapped)
                        const answer = await rl.question(chalk.cyan(`¿El recurso '${newRes.name}' es un renombre de '${missingRes.name}'? (y/N): `));
                        if (answer.toLowerCase() === 'y') {
                            // Transfer history
                            const oldData = lastResourcesMap.get(missingRes.name)!;
                            lastResourcesMap.set(newRes.name, { ...oldData, name: newRes.name });
                            lastResourcesMap.delete(missingRes.name);
                            
                            // Mark for cleanup of old name
                            (newRes as any).previousName = missingRes.name;
                            newRes.extra = { ...newRes.extra, renamedFrom: missingRes.name }; // Persist in extra
                            
                            console.log(chalk.green(`✔ ${missingRes.name} -> ${newRes.name} (Heredando versión v${oldData.version})`));
                            console.log(chalk.yellow(`  ⚠ Los contenedores de '${missingRes.name}' serán tratados como versiones antiguas de '${newRes.name}'.`));
                            break; // Move to next new resource
                        }
                    }
                }
            }
            rl.close();
        }
        
        // Check for truly removed resources (missing and not renamed)
        const trulyRemovedResources = [...lastResourcesMap.keys()].filter(key => 
            !currentResourceNames.includes(key)
        );

        if (trulyRemovedResources.length > 0) {
            console.log(chalk.yellow('\nRecursos eliminados (no renombrados):'));
            trulyRemovedResources.forEach(name => console.log(chalk.red(`  • ${name}`)));
            
            const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
            const answer = await rl.question(chalk.yellow(`¿Desea eliminar los contenedores e imágenes de estos recursos obsoletos? (Y/n): `));
            rl.close();

            if (['y', 'yes', ''].includes(answer.toLowerCase().trim())) {
                for (const name of trulyRemovedResources) {
                    console.log(chalk.blue(`Limpiando recurso eliminado: ${name}`));
                    // Mock resource object for clean method
                    const dummyResource = {
                        name: `${name}`,
                        fullName: `${name}-${this.stack.name}`,
                        version: '1',
                        updateStatus: async (status: string, log?: string) => { /* console.log(`[${name}] Status: ${status} ${log||''}`) */ },
                        extra: {}
                    } as unknown as Resource;

                    // Ensure logger
                    if (!this.logger[name]) { 
                         const color = COLORS[name.length % COLORS.length]; 
                         this.logger[name] = createLogger(name, color);
                    }
                    
                    await this.clean(dummyResource, 0);
                    const subdomain = dummyResource.fullName;
                    const proxy = await service.getProxy(subdomain, true);
                    await service.deleteProxy(proxy?.id);
                }
            }
        }

        for (const resource of allResources) {
            const isTarget = targetNames.includes(resource.name);
            
            if (isTarget) {
                let nextVersion = 1;
                
                // 1. Check DB version
                if (lastResourcesMap.has(resource.name)) {
                    const lastResource = lastResourcesMap.get(resource.name)!;
                    nextVersion = Number(lastResource.version || 0) + 1;
                }

                // 2. Check Docker version
                const dockerNextVersion = await this.getNextVersion(resource.fullName);
                nextVersion = Math.max(nextVersion, dockerNextVersion);

                resource.version = String(nextVersion);
                resource.status = "PENDING";
                
                resourcesToDeploy.push(resource);
                allResourcesWithStatus.push(resource);
            } else {
                // SKIPPED RESOURCE
                const lastResource = lastResourcesMap.get(resource.name);
                resource.version = lastResource?.version || "0";
                resource.status = "SKIPPED";
                resource.extra = lastResource?.extra || {};
                
                allResourcesWithStatus.push(resource);
            }
        }


        const deploy = await service.create(this.stack.name, {
            status: "PROCESSING",
            resources: allResourcesWithStatus.map(r => ({
                name: r.name,
                version: r.version || "1",
                status: r.status,
                extra: r.extra
            }))
        });
        
        const rollbackStack: Array<() => Promise<void>> = [];

        try {

            let aborted = false;
            const deployPromises = resourcesToDeploy.map(async (resource, i) => {
                const logger = this.logger[resource.name];

                logger.info(`Desplegando ${resource.fullName}`);

                resource.updateStatus = async (status: string, log?: string, extraData?: object) => {
                    resource.status = status; 
                    logger.info(`Actualizando estado de ${resource.fullName} a ${status}` + (log? ` con log: ${log}` : ''));
                    await service.update({
                        stackName: this.stack.name,
                        id: deploy.id,
                        resources: (deploy.resources || []).map(r => {
                            if (r.name === resource.name) {
                                r.status = status;
                                if(log) (r as any).taskLog = [...((r as any).taskLog || []), log];
                                if(extraData) Object.assign(r, extraData);
                            }
                            return r;
                        })
                    });
                    if(status === "ERROR" || status === "FAILED") {
                        await service.update({
                            stackName: this.stack.name,
                            id: deploy.id,
                            status: status
                        });
                    }
                }
                
                const namesToCheck = [resource.name];
                if ((resource as any).previousName) namesToCheck.push((resource as any).previousName);
                
                const previousContainer = await this.getRunningContainer(namesToCheck);
                
                rollbackStack.push(async () => {
                    logger(chalk.yellow(`[Rollback] Iniciando rollback para ${resource.name}...`));
                    await resource.updateStatus("ROLLBACK", "Iniciando proceso de rollback...", { 
                        rollbackTarget: previousContainer ? previousContainer.Names[0] : 'none' 
                    });
                    
                    const newContainerName = `/${resource.fullName}-${resource.version}`;
                    
                    if (previousContainer && previousContainer.Names[0] === newContainerName) {
                         logger(chalk.red(`[Rollback] Error de seguridad: El contenedor a eliminar coincide con el anterior. Omitiendo eliminación.`));
                    } else {
                        try {
                            const containerToRemove = this.docker.getContainer(newContainerName.substring(1)); // remove leading slash
                            logger(`  [Rollback] Eliminando contenedor fallido/nuevo: ${newContainerName.substring(1)}`);
                            await containerToRemove.remove({ force: true });
                        } catch (e) {
                            // Ignore if not found (maybe it never started)
                        }
                    }

                    if (previousContainer) {
                        const prevName = previousContainer.Names[0];
                        logger(`  [Rollback] Reiniciando contenedor anterior: ${prevName}`);
                        try {
                            const containerToRestart = this.docker.getContainer(prevName.substring(1));
                            await containerToRestart.start().catch((e) => {
                                if (!e.message.includes('already started') && !e.message.includes('304')) throw e;
                            });
                            
                            // Restore proxy if needed (assuming previous container had proxy config)
                            // We might need to re-read the port/config from the previous container or assume standard
                             if (resource.extra && resource.extra.hostname) {
                                 // Re-register proxy. Note: We use the resource name. 
                                 // If it was a rename, we might need to decide if we register with OLD or NEW name.
                                 // Ideally we register with the NEW name pointing to the OLD container IP/Port.
                                 // But for now, let's just restore the proxy for the resource.
                                 // await service.addProxy(resource.name, resource.extra.hostname);
                             }
                        } catch (e) {
                            logger.error(chalk.red(`  [Rollback] Error reiniciando anterior: ${e}`));
                        }
                    }
                });
                
                await resource.updateStatus("PROCESSING");

                if (resource.preDeploy) {
                    if (aborted) return;
                    logger.info(`Ejecutando pre-deploy: ${resource.preDeploy}`);
                    logger.start(`Ejecutando: ${resource.preDeploy}`);
                    try {
                        console.log(`Ejecutando pre-deploy: ${resource.preDeploy}`);
                        console.log(resource.folder);


                        const execPromise = promisify(exec);
                        const { stdout, stderr } = await execPromise(resource.preDeploy, { cwd: resource.folder.proyect });
                        if (stdout) logger(chalk.dim(stdout));
                        if (stderr) logger.error(chalk.yellow(stderr));
                        logger.succeed(`Pre-deploy finalizado exitosamente.`);
                    } catch (error) {
                        logger.fail(`Error en pre-deploy: ${(error as Error).message}`);
                        throw new Error(`Pre-deploy failed: ${(error as Error).message}`);
                    }
                }

                const isTask = resource.templateObj.type === 'task';

                await resource.templateObj.process(resource);
        
                if (isTask) {
                    if (resource.templateObj.postProcess) {
                        await resource.templateObj.postProcess(resource);
                    }
                    logger(`Tarea ${resource.name} completada.`);
                    return; // Skip to next resource
                }
                
                if (aborted) return;
                resource.imageName = await this.createImage(resource)
                
                if (aborted) return;
                
                const namesToClean = [resource.name];
                if ((resource as any).previousName) namesToClean.push((resource as any).previousName);
                
                await this.clean(resource, 5, namesToClean)

                if (aborted) return;
                await this.start(resource);

                if (aborted) return;                
                await this.setProxy(resource);

                await resource.updateStatus("SUCCESS");
            });

            await Promise.all(deployPromises);

        await service.update({
            stackName: this.stack.name,
            id: deploy.id,
            status: "SUCCESS"
        });

        console.log("Despliegue completado y estado guardado.");
        this.printSummary(allResourcesWithStatus, "SUCCESS");

        } catch (error) {
            // aborted = true; // This would be needed if aborted was in outer scope, but here we are in the catch
            console.error(chalk.red("\nDeployment failed. Initiating rollback..."));
            spinner.fail("Deployment failed.");
            
            for (const rollbackAction of rollbackStack.reverse()) {
                await rollbackAction();
            }

            await service.update({
                stackName: this.stack.name,
                id: deploy.id,
                status: "FAILED"
            });
            
            this.printSummary(allResourcesWithStatus, "FAILED");
            // handleError(error);
            process.exit(1);
        }
    }

    private setProxy = async (resource: Resource) => {
        const service  = this.stack.getService();
        const subdomain = resource.fullName;
        const target = resource.extra.hostname;
        const proxy = await service.getProxy(subdomain, true);

        if(!proxy) {
            await service.addProxy(subdomain, target);
            await resource.updateStatus("PROCESSING", `PROXY: Proxy '${subdomain}' agregado exitosamente.`);
        } else if(proxy.subdomain == subdomain && proxy.target == target) {
            await resource.updateStatus("PROCESSING", `PROXY: Proxy '${subdomain}' no se modifico.`);
            
        } else if (proxy.subdomain == subdomain && proxy.target != target) {
            await service.updateProxy(proxy.id, subdomain, target);
            await resource.updateStatus("PROCESSING", `PROXY: Proxy '${subdomain}' actualizado exitosamente.`);
            
        }

        resource.extra ||= {};
        resource.extra.proxy = (await service.getProxy(subdomain, true))?.url;

    }

    private printSummary = (resources: Resource[], globalStatus: string) => {
        console.log(chalk.bold(`\nDeployment Summary (${globalStatus}):`));
        const table = new Table({
            head: [chalk.cyan('Resource'), chalk.cyan('Version'), chalk.cyan('Status'), chalk.cyan('URL')],
            colWidths: [30, 15, 20]
        });

        resources.forEach(r => {
            let statusColor = chalk.white;
            let statusText = r.status || 'PENDING';
            
            if (statusText === 'SUCCESS') statusColor = chalk.green;
            else if (statusText === 'FAILED' || statusText === 'ERROR') statusColor = chalk.red;
            else if (statusText === 'ROLLBACK') statusColor = chalk.yellow;
            else if (statusText === 'PROCESSING') statusColor = chalk.blue;
            else if (statusText === 'SKIPPED') statusColor = chalk.gray;

            let nameDisplay = r.name;
            if (r.extra?.renamedFrom) {
                nameDisplay += chalk.dim(` (was ${r.extra.renamedFrom})`);
            }

            table.push([nameDisplay, r.version || '-', statusColor(statusText), r.extra?.proxy || r.extra?.hostname || '-']);
        });

        console.log(table.toString());
    }

    private getStackContainers = async (all: boolean = true) => {
        const filters = {
            label: ['oton-pilot-cli']
        };
        
        const containers = await this.docker.listContainers({
            all: all,
            filters: JSON.stringify(filters)
        });
        return containers.filter(container => {
             return container.Labels && Object.entries(container.Labels).find(([k, v]) => k == 'stack' && v == this.stack.name);
        });
    }

    private createContainerTable = async (containers: Docker.ContainerInfo[]) => {
        const service = this.stack.getService();
        const table = new Table({
            head: [
                chalk.cyan('ID'),
                chalk.cyan('Nombre'),
                chalk.cyan('Imagen'),
                chalk.cyan('Estado'),
                chalk.cyan('Status'),
                chalk.cyan('Networks'),
                chalk.cyan('Url Proxy')
            ]
        });
        for (const c of containers) {        
            const fullName = String(c.Image.split(':').at(0));
            const proxy = await service.getProxy(fullName, true);
            table.push([
                c.Id.substring(0, 12),
                fullName,
                c.Image,
                c.State,
                c.Status,
                Object.keys(c.NetworkSettings.Networks).join(),
                proxy?.url || '-'
            ]);
        }
        return table;
    }

    ps = async (options: { all: boolean }) => {
        try {
            const containers = await this.getStackContainers(options.all);
    
            if (containers.length === 0) {
                console.log(chalk.yellow('No se encontraron contenedores.'));
                return;
            }

            const table = await this.createContainerTable(containers);
            console.log(table.toString());
    
        } catch (error) {
            handleError(error);
        }
    }

    followStackLogs = async (tail: number, specificResources?:string[], all?: boolean): Promise<void> => {
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

            const allContainers = await this.getStackContainers(!!specificResources?.at(0));

            
            let containersToShow: Docker.ContainerInfo[] = allContainers; // Por defecto, mostrar todos los gestionados
            if (specificResources && specificResources.length > 0) {
                console.log(chalk.blue(`Filtrando por: ${specificResources.join(', ')}`));
                containersToShow = allContainers.filter(c => {
                    const shortId = c.Id.substring(0, 12);
                    const names = c.Names.map(n => n.replace('/', '').split("-").at(0));
                    const baseName = c.Names.map(n => n.replace('/', ''));
                    return specificResources.some(requested =>
                        baseName.some(name => name.startsWith(requested)) &&
                        (all || c.State === "running")
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
                let containerName = containerInfo.Names.map(n => n.replace('/', '')).join(',') || containerIdShort;
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

    showStackLogs = async (tailCount: number, specificResources?: string[], all?: boolean): Promise<void> => {

        try {

            if (isNaN(tailCount) || tailCount <= 0) {
                handleError(new Error('--tail debe ser un número positivo.'));
                return;
            }

            console.log(chalk.blue(`Buscando contenedores gestionados por 'oton-pilot' en '${this.stack.name}' para obtener logs...`));

            const managedContainers = (await this.getStackContainers(true)).filter(containerInfo => {
                if(specificResources && !specificResources.some(requested =>
                    containerInfo.Names.some(name => name.startsWith("/"+requested)) 
                )) return false;
                if(!all && containerInfo.State !== 'running') return false;
                return true;
            });

            if (managedContainers.length === 0) {
                console.log(chalk.yellow(`No se encontraron contenedores gestionados por 'oton-pilot' en '${this.stack.name}'.`));
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
        const service = this.stack.service;
        
        try {
            console.log(chalk.yellow(`Searching for containers managed by 'oton-pilot' on '${this.stack.name}' to remove...`));

            const containers = await this.getStackContainers(true);

            if (containers.length === 0) {
                console.log(chalk.green(`No containers managed by 'oton-pilot' found on '${this.stack.name}'. Nothing to do.`));
                return;
            }
            console.log(chalk.red.bold(`\nWARNING! The following ${containers.length} containers on '${this.stack.name}' will be stopped and permanently removed:`));
            
            const table = await this.createContainerTable(containers);

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

                    process.stdout.write(chalk.dim('Removing Proxies... '));
                    for (const str of containerInfo.Names) {
                        const subdomain = str.substring(0, str.lastIndexOf('-')).replace('/', '');
                        const proxys = await service.getProxy(subdomain);
                        for(const proxy of proxys) {
                            await service.deleteProxy(proxy.id);
                        }
                    }

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


    private getRunningContainer = async (resourceNames: string[]) => {
        const containers = await this.getStackContainers(true);
        
        const matchingContainers = containers.filter(c => {
            for (const resName of resourceNames) {
                 const prefix = `/${resName}-`;
                 if (c.Names[0].startsWith(prefix)) return true;
            }
            return false;
        });

        const running = matchingContainers.filter(c => c.State === 'running');
        
        running.sort((a, b) => b.Created - a.Created);
        
        return running.at(0);
    }

    start = async (resource: Resource) => {
        const logger = this.logger[resource.name];
        try {
            const {imageName, spec, fullName, name, version, environment, templateObj} = resource;
            logger.info(`Iniciando contenedor '${fullName}' con la image '${imageName}'...`);
            const profile = this.stack.getProfile();
            spec.networks ||= [];
            resource.proxy && spec.networks.push(profile.service?.network || 'oton-pilot-proxy');
            if (spec.networks.at(0)) {
                for (const networkName of spec.networks) {
                    await this.ensureNetworkExists(networkName, logger);
                }
            }

            environment.PORT ||= spec.port;

            resource.extra = {
                ...resource.extra,
                hostname: spec.hostname || `${name}.${this.stack.name}`.toLowerCase(),
            }

            let containerName = fullName;
            if(version) containerName += `-${version}`;
            const container = await this.docker.createContainer({
                Image: imageName,
                name: containerName,
                Env: this.formatEnvironment(environment),
                Hostname: resource.extra?.hostname,
                ExposedPorts: spec.port ? {
                    [`${spec.port}/tcp`]: {}
                }: {},
                Labels: {
                    ...spec.label, 
                    "oton-pilot-cli": "0.0.1", 
                    "oton-pilot-service": "0.0.1",
                    "stack": resource.stack || this.stack.name,
                    "com.docker.compose.project": resource.stack || this.stack.name
                },
                HostConfig: {
                    Binds: templateObj.volume ? [
                        templateObj.volume.replace('{volumeName}', `${this.stack.name}-${name}`)
                    ]: [],
                    PortBindings: spec.port ? {
                        [`${templateObj.port || spec.port}/tcp`]: [{ HostPort: `${spec.port}` }]
                    } : {},
                    RestartPolicy: {
                        Name: spec.restart || "unless-stopped"
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
                logger.succeed(`Contenedor '${container.id.substring(0, 12)}' conectado a la red '${networkName}'.`);
            }

            await container.start();
            logger.succeed(`Contenedor '${imageName}' iniciado exitosamente.`);
            await resource.updateStatus("PROCESSING", `STARTED: Contenedor '${imageName}' iniciado exitosamente.`);
        } catch (error) {
            await resource.updateStatus("ERROR", `STARTED: ${ (error as Error).message}`);
            handleError(error);
        }
    }

    private formatEnvironment = (envObject?: { [key: string]: string }): string[] => {
        if (!envObject) {
            return [];
        }
        return Object.entries(envObject).map(([key, value]) => `${key}=${value}`);
    }

    private getNextVersion = async (containerNamePrefix: string) => {
        // spinner.start(`Buscando ultima versiones de '${containerNamePrefix}'`)
        let last = 0;
        // Filter by name starting with /containerNamePrefix
        const containers = await this.docker.listContainers({ all: true, filters: { name: [ `^/${containerNamePrefix}.*` ] }})

        if(!containers.at(0)){
        //   spinner.succeed(" -> No se encontraron otras versiones.")
          return 1;
        }

        for (const container of containers) {
            // Name format: /stack-resource-version
            // We want to extract 'version'.
            // containerNamePrefix is 'stack-resource'
            const name = container.Names[0]; // e.g. /test-test-15
            const parts = name.replace('/', '').split('-');
            const v = Number(parts[parts.length - 1]);
            
            if (!isNaN(v) && v > last) last = v;
        }
        // spinner.succeed(`Ultima version encontrada ${last}`)
        return last + 1
    }

    createImage = async (resource: Resource, imageName?: string) => {  
        const logger = this.logger[resource.name];
        logger.info(`Creando nueva imagen para el despliegue`)
        const {templateObj} = resource;

        let dockerFile = templateObj.dockerfileTemplate!;
        for (const str of ['handler', 'port', 'imageName']) {
            if (dockerFile.includes(`{${str}}`)) {
                (resource as any)[str] && (dockerFile = dockerFile.replaceAll(`{${str}}`, (resource as any)[str]));
                (resource.props as any)[str] && (dockerFile = dockerFile.replaceAll(`{${str}}`, (resource.props as any)[str]));
            }
        }
        fs.writeFileSync(path.join(resource.folder.deploy, "Dockerfile"), dockerFile);
        imageName ||= `${resource.fullName}:${resource.version}`.toLowerCase();
        const options :Docker.ImageBuildOptions  = {
            t: imageName,
            dockerfile: 'Dockerfile',
            labels: {"oton-pilot": "0.0.0"}, 
            forcerm: true,
            nocache: true // Forzamos rebuild sin cache
        };
        
        // if(resource.codeUri){
            this.copyDirectoryRecursive(resource.folder.code, resource.folder.deploy, logger)
        // }

        const pack = tar.pack(resource.folder.deploy, {
            
            map: (header) => {
            if (header.name === 'Dockerfile') {
                return header;
            }
            header.name = path.join('app', header.name);
            return header;
            }
        });

        logger.start('Compilando imagen de Docker')

        try {
            const stream = await this.docker.buildImage(pack, options);
            
            const res = await new Promise((resolve, reject) => {
                this.docker.modem.followProgress(stream, (err, res) => {
                    if (err) {
                        logger.error(String(err))
                        return reject(err);
                    }
                    resolve(res);
                });
            });
            if((res as any[]).find(i => i.error)){
                for(const e of (res as any[])){
                    if(e.stream == '\n' || typeof e.stream !== 'string') continue;
                    logger.succeed(e.stream.replaceAll('\n', ''))
                }
                // spinner.fail((res as any[]).find(i => i.error).error)

                handleError((res as any[]).find(i => i.error).error);
            }

            logger.succeed(`Imagen '${imageName}' compilada exitosamente.`);
            await resource.updateStatus("PROCESSING", `COMPILED: Imagen '${imageName}' compilada exitosamente.`);
            return imageName;
        } catch (err) {
            const error = err as Error;
            await resource.updateStatus("ERROR", `COMPILED: Error al compilar la imagen: ${error.message}`);
            handleError(`Error al compilar la imagen: ${error.message}`)
            return "";
        }
    }

    clean = async (resource: Resource, containersToKeep: number = 5, resourceNames: string[] = [resource.name]) => {
        const logger = this.logger[resource.name];
        logger.info(`Obteniendo contenedores para limpieza (Nombres: ${resourceNames.join(', ')})`)
        
        try {
            const allContainers = await this.getStackContainers(true);

            const prefix = `/${resource.fullName}-`;

            const matchingContainers = allContainers.filter(c => c.Names[0].startsWith(prefix));
            
            if (!matchingContainers.at(0)) {
                logger.info(`No se encontraron contenedores para limpiar.`);
                return;
            }

            logger.info(`Deteniendo contenedores en ejecución`)
            for(const containerInfo of matchingContainers){
                const containerId = containerInfo.Id;
                const name = containerInfo.Names[0].substring(1);
                const container = this.docker.getContainer(containerId);

                if (containerInfo.State === 'running') {
                    logger.start(`Deteniendo contenedor: ${name} (${containerId})`);
                    await container.stop();
                    logger.succeed(`Contenedor ${name} (${containerId}) detenido exitosamente`)
                }

            }

            matchingContainers.sort((a, b) => b.Created - a.Created);

            const containersToRemove = matchingContainers.slice(containersToKeep);

            if (!containersToRemove.at(0)) {
                logger.succeed(chalk.green(`No hay suficientes contenedores para eliminar. Se conservan los ${containersToKeep} más recientes.`));
                return;
            }

            
            logger.succeed(`Se encontraron ${matchingContainers.length} contenedores. Eliminando ${containersToRemove.length} más antiguos...`)

            for (const containerInfo of containersToRemove) {
                const containerId = containerInfo.Id;
                const name = containerInfo.Names[0].substring(1);
                const container = this.docker.getContainer(containerId);

                logger.change(`Eliminando contenedor: ${name} (${containerId.substring(0, 12)})`);
                await container.remove({ force: true });
                const image = this.docker.getImage(containerInfo.Image);
                try {
                    await image.remove({ force: true });
                    logger.succeed(`imagen ${name} (${containerId.substring(0, 12)}) eliminada exitosamente`)
                } catch (e) {
                     // Image might be used by other containers or already deleted
                }
            }
            const msg = `Proceso completado. Se eliminaron ${containersToRemove.length} contenedores.`;
            logger.succeed(chalk.green(msg));
            resource.updateStatus("PROCESSING", `CLEANUP: ${msg}`);
            return true;
        } catch (err) {
            logger.fail(chalk.red(`Ocurrió un error al limpiar los contenedores: ${err}`));
            console.error(err);
            resource.updateStatus("ERROR", `CLEANUP: Ocurrió un error al limpiar los contenedores: ${String(err)}`);
            return false;
        }
        return true;
    }

    private ensureNetworkExists = async (networkName: string, logger: Logger) => {
    try {
        const networks = await this.docker.listNetworks({
            filters: { name: [networkName] }
        });

        if (networks.length === 0) {
            logger.fail(`Red '${chalk.cyan(networkName)}' no encontrada. Creándola...`);
            await this.docker.createNetwork({
                Name: networkName,
                CheckDuplicate: true // Prevenir errores si otra red con el mismo nombre es creada simultáneamente
            });
            logger.succeed(chalk.green(`Red '${chalk.cyan(networkName)}' creada.`));
        } else {
            logger.info(`Red '${chalk.cyan(networkName)}' ya existe.`);
        }
    } catch (err: any) {
        logger.fail(chalk.red(`Error al verificar/crear la red '${networkName}': ${err.message}`));
        throw err;
    }
    }

    private copyDirectoryRecursive = (source: string, destination: string, logger?: Logger): void => {
        try {
            logger?.start("copiando archivos")
            if (!fs.existsSync(destination)) {
                fs.mkdirSync(destination, { recursive: true });
                logger?.log(chalk.dim(`  Directorio creado: ${destination}`));
            }
            const items = fs.readdirSync(source);

            items.forEach((item) => {
                const sourcePath = path.join(source, item);
                const destinationPath = path.join(destination, item);

                const stats = fs.statSync(sourcePath);

                if (stats.isDirectory()) {
                    logger?.succeed(`Copiando directorio ${sourcePath}`)
                    this.copyDirectoryRecursive(sourcePath, destinationPath, logger);
                } else if (stats.isFile()) {
                    
                    fs.copyFileSync(sourcePath, destinationPath);
                    logger?.succeed(`Archivo copiado ${sourcePath}`)
                }
            });
        } catch (error) {
            throw new Error(`Error copiando ${source} a ${destination}: ${(error as Error).message}`);
        }
    }
    
    public ensurePilotService = async () => {
        const serviceName = "oton-pilot-service";
        const template = this.stack.templates.getTemplete("service");
        const service = this.profile.service;


        const logger = this.logger[serviceName];

        const deployFolder = path.join(this.stack.projectPath, ".deploy", serviceName);
        if (!fs.existsSync(deployFolder)) {
            fs.mkdirSync(deployFolder, { recursive: true });
        }

        const resource: Resource = {
            name: serviceName,
            fullName: serviceName, 
            version: "1",
            template: "service",
            templateObj: template,
            environment: {
                HOST: service?.proxyHost || this.profile.host + ":" + (service?.port || 3000),
                PORT: service?.port || 3000,
                DB_PATH: "./oton-pilot-service.db",
                
            },
            spec: { port: service?.port || 3000, networks: [service?.network || "oton-pilot-proxy"] },
            props: {},
            folder: {
                deploy: deployFolder,
                proyect: this.stack.projectPath,
                code: "" 
            },
            extra: {},
            handler: "server.min.js", 
            codeUri: "",
            path: "",
            updateStatus: async (status: string, log?: string) => 
                logger.info(`${status}: ${log || ''}`)
        };

        try {
            logger.info("Verificando servicio oton-pilot-service...");

            const prefix = `/${resource.fullName}`;
            const containers = await this.docker.listContainers({ 
                all: true, 
                filters: { name: [ `^${prefix}` ] } 
            });

            const runningContainer = containers.find(c => ["running", "restarting"].includes(c.State));

            if (runningContainer) {
                logger.info(chalk.yellow(`Service already installed and running: ${runningContainer.Names[0]}`));
                await resource.updateStatus("SKIPPED", `Service is already running (${runningContainer.Names[0]})`);
                return true;
            }

            await resource.updateStatus("PROCESSING", "Installing service...");
            await template.process(resource)
            
            resource.imageName = await this.createImage(resource)
            await this.clean(resource, 5)
            await this.start(resource)
            await resource.updateStatus("SUCCESS", "Service installed successfully.");
            await resource.updateStatus("PROCESSING", "Waiting for service API to be ready...");
            
            fs.rmSync(deployFolder, { recursive: true, force: true });


            const service  = this.stack.getService();
            for (let i = 0; i < 3; i++) {
                await new Promise(resolve => setTimeout(resolve, 5000)); // Esperar 5 segundos
                const isRunning = await service.isServiceRunning();
                if (isRunning) {
                    await resource.updateStatus("SUCCESS", "Service API is ready.");
                    return true;    
                }
                logger.warn(`Intento ${i + 1}/3: El servicio aún no está listo. Reintentando...`);
            }
            
            await resource.updateStatus("ERROR", "Service API is not ready.");
            return false;
        } catch (error) {
            logger.error(`Error asegurando el servicio piloto: ${(error as Error).message}`);
            throw error; 
        }
    }
}
