import chalk from 'chalk';
import Docker from 'dockerode';
import Table from 'cli-table3';
import { handleError } from '../handlers';
import { Manage } from '../types';
import { FileStack } from '../config';
import path from 'path';
import fs from 'fs';
import * as tar from 'tar-fs'; 
import templates from '../templates';
import ora from 'ora';
import spinner from '../spinner';


export class DockerManage implements Manage {
    docker: Docker;

    deployFolder: string = ".dd-cli"
    serviceFolder: string = "";

    constructor(options?: Docker.DockerOptions) {
        this.docker = new Docker(options);
    }

    deploy = async (stack: FileStack) => {
        this.serviceFolder = "";
        for( const [name, service] of Object.entries(stack.getServices())) {
            this.serviceFolder = path.join(process.cwd(), this.deployFolder, name);

            fs.mkdirSync(this.serviceFolder, { recursive: true });
            const version = await this.getNextVersion(name);
            const baseName = `${name}-${version}`;
            if (!this.processType(service.type, {
                name: name,
                version: String(version),
                handle: service.handler
            })) {
                return console.log('error, tipo invalido');
            }
            const imageName = await this.createImage({
                runtime: service.runtime,
                handler: service.handler,
                name: name,
                app: this.serviceFolder,
                version: String(version)
            })
            await this.clean(name)
            await this.start(String(imageName), baseName, (service.spec || {}));

        }
    }

    ps = async (options: { all: boolean }) => {
        try {
          const containers = await this.docker.listContainers({ all: options.all });
    
          if (containers.length === 0) {
            console.log(chalk.yellow('No se encontraron contenedores.'));
            return;
          }

          const table = new Table({
            head: [
              chalk.cyan('ID'),
              chalk.cyan('Nombre'),
              chalk.cyan('Imagen'),
              chalk.cyan('Estado'),
              chalk.cyan('Status')
            ]
          });
    
          containers.forEach(c => {
            table.push([
              c.Id.substring(0, 12),
              c.Names.map(n => n.replace('/', '')).join(', '),
              c.Image,
              c.State, // 'running' or 'exited'
              c.Status // 'Up 2 hours' or 'Exited (0) 2 days ago'
            ]);
          });
    
          console.log(table[1].toString());
    
        } catch (error) {
          handleError(error);
        }
    }

    start = async (imageName: string, name: string,  spec: any) => {
        try {
            console.log(chalk.blue(`Iniciando contenedor '${name}' con la image '${imageName}'...`));

            const networks = Array.isArray(spec.network) ? spec.network : [spec.network];

            if (networks.at(0)) {
                for (const networkName of networks) {
                    await this.ensureNetworkExists(networkName);
                }
            }

            const containerConfig = {
                Image: imageName,
                name: name,
                Hostname: spec.hostname || name,
                ExposedPorts: spec.port ? {
                    [`${spec.port}/tcp`]: {}
                }: {},
                Labels: {...spec.label, "dd-cli": "0.0.0"},
                HostConfig: {
                    PortBindings: spec.port ? {
                        [`${spec.port}/tcp`]: [{ HostPort: `${spec.port}` }]
                    } : {},
                    RestartPolicy: {
                        Name: spec.restart
                    },
                    CpuPeriod: 100000,
                    CpuQuota: 100000 * parseFloat(spec.cpus),
                    Memory: parseInt(spec.memory) * 1024 * 1024,
                    ExtraHosts: spec['add-host'],
                    NetworkMode: networks?.[0] || null
                }
            };
            
            const container = await this.docker.createContainer(containerConfig);
            for (let i = 1; i < networks.length; i++) {
                const networkName = networks[i];
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

    private processType = ( type: string, params: {[x: string]: string}) => {
      const types:{[x: string]: Function} = {
        node: () => {
          const fileName = 'package.json';
          const packagePath = path.join(process.cwd(),fileName );
          let json: {[x: string]: any} = {
            "name": params.name,
            "version": params.version,
            "main": params.handle,
            "dependencies": {}
          }
          if (fs.existsSync(packagePath)) {
            const text = fs.readFileSync(packagePath, 'utf-8');
            json = JSON.parse(text);
          }
          json.description ||= `Despliegue de ${params.name}`
          
          fs.writeFileSync(path.join(this.serviceFolder, fileName), JSON.stringify(json, null, 2));
          return true;
        }
      }
      return types[type] && types[type]();
    }

    private createImage = async (params: { [x: string]: string }) => {  
    console.log(`ℹ️  Creando nueva imagen para el despliegue`)
      let template = templates[params.runtime];
      if (!template) {
          return console.log('error al obtener template');
      }
      for (const str of [/* 'app',  */'handler']) {
          if (template.includes(`{${str}}`)) {
              template = template.replaceAll(`{${str}}`, params[str]);
          }
      }
      fs.writeFileSync(path.join(this.serviceFolder, "Dockerfile"), template);

      const imageName = `${params.name}:${params.version}`.toLowerCase();
      const options :Docker.ImageBuildOptions  = {
          t: imageName,
          dockerfile: 'Dockerfile',
          labels: {"dd-cli": "0.0.0"}, 
          forcerm: true
      };

      const pack = tar.pack(this.serviceFolder, {
        // Usar la opción `map` para modificar el nombre de cada entrada
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
          
          await new Promise((resolve, reject) => {
              this.docker.modem.followProgress(stream, (err, res) => {
                  // Aquí podrías actualizar el spinner con detalles del progreso si lo deseas
                  if (err) return reject(err);
                  resolve(res);
              });
          });

          spinner.succeed(`Imagen '${imageName}' compilada exitosamente.`);
          return imageName;
      } catch (err) {
        const error = err as any;
          spinner.fail(`Error al compilar la imagen: ${error.message}`);
          return "";
      }
    }

    private clean = async (name:string, containersToKeep: number = 5) => {
        console.log(`ℹ️  Obteniendo contenedores para limpieza `)
        spinner.succeed(`Buscando contenedores con prefijo '${name}' para limpiar...`)
        const filtros = { name: [ `^/${name}.*` ] };

        try {
            const containers = await this.docker.listContainers({ all: true, filters: filtros });

            // Si no se encuentran contenedores, detener el proceso
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
                    spinner.succeed(`Deteniendo contenedor: ${name} (${containerId.substring(0, 12)})`);
                    await container.stop();
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
}