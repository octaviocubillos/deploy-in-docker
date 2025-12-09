import path from "path";
import fs from 'fs';
import { Resource } from "../config";
import { DockerManage } from "../manages/docker";
import { handleError } from "../handlers";
import spinner from "../spinner";

export default new class {
    name = "collection";
    type: 'task' = 'task';

    process = async (resource: Resource, manager?: DockerManage) => {
        if (!manager) {
            return handleError("Manager no proporcionado al template 'collection'");
        }

        const props = resource.props as any;
        props.targetService ||= 'oton-pilot-db';
        if (!props || !Array.isArray(props.keys) || !props.targetService) {
            return handleError(`El recurso 'collection' ${resource.name} requiere las propiedades 'targetService' y 'keys'.`);
        }

        // 1. Encontrar el recurso de la base de datos de destino
        // const targetService = manager.stack.getResources().find(r => r.name === props.targetService);
        // if (!targetService) {
        //     return handleError(`El servicio de destino '${props.targetService}' no se encontró en el stack.`);
        // }

     

        const network = 'oton'; // Assuming a default network for the internal DB
        const dbUser = manager.profile.mongodb?.username;
        const dbPassword = manager.profile.mongodb?.password;
        const dbHost = 'oton-pilot-db'; // Internal container name

        if (!network) {
            return handleError(`El servicio de destino '${props.targetService}' no tiene una red definida o no se pudo determinar la red para oton-pilot-db.`);
        }
        if (!dbPassword) {
            return handleError(`El password para la base de datos de destino '${props.targetService}' no fue encontrado.`);
        }
        if (!dbUser) {
            return handleError(`El usuario para la base de datos de destino '${props.targetService}' no fue encontrado.`);
        }


        const dbName = props.database || resource.name;

        // 2. Generar el script de inicialización
        const filename = "init-mongo.js";
        let script = `
        db = db.getSiblingDB('${dbName}');
        db.createUser({
            user: '${props.username || resource.name}',
            pwd: '${props.password || resource.name}',
            roles: [{role: 'readWrite', db: '${dbName}'}]
        });
        ${props.keys.reduce((acc: string, key: any) => {
            return acc + `db.${props.collectionName}.createIndex({${key.name}: ${key.index == "asc"? 1: -1}}, ${JSON.stringify(key.options || {})});\n`;
        }, '')}
                `;

        if (!fs.existsSync(resource.folder.deploy)) {
            fs.mkdirSync(resource.folder.deploy, { recursive: true });
        }
        fs.writeFileSync(path.join(resource.folder.deploy, filename), script);

        // 3. Ejecutar el contenedor temporal
        const imageName = props.imageName || "mongo:latest";
        const scriptPath = path.join(resource.folder.deploy, filename);
        const connectionString = `mongodb://${dbUser}:${dbPassword}@${dbHost}:27017/${dbName}?authSource=admin`;

        spinner.start(`Ejecutando tarea de configuración de colección en '${dbName}'...`);

        try {
            const [output, container] = await manager.docker.run(imageName,
                [
                    'mongosh',
                    connectionString,
                    '--file',
                    `/data/script/${filename}`
                ],
                process.stdout,
                {
                    HostConfig: {
                        Binds: [`${scriptPath}:/data/script/${filename}`],
                        NetworkMode: network,
                        AutoRemove: true
                    }
                }
            );

            if (output.StatusCode !== 0) {
                handleError(`La tarea de configuración de la colección falló con el código de estado: ${output.StatusCode}`);
                return false;
            }

            spinner.succeed("Tarea de configuración de colección completada exitosamente.");
            return true;
        } catch (error) {
            handleError(error);
            return false;
        }
    }
};