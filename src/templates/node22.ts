import path from "path";
import fs from 'fs';
import { Resource } from "../config";

export default new class {
    name = "node22";
    port = 80;

    process = (resource: Resource) => {
        // En serverless, el handler suele ser "archivo.funcion"
        // Aquí asumiremos que si viene "index.handler", cargamos index.js y ejecutamos exports.handler
        
        const [fileName, handlerName] = resource.handler.split('.');
        if (!fileName || !handlerName) {
            throw new Error("El handler debe tener el formato 'archivo.funcion' (ej: index.handler)");
        }

        const filename = 'package.json';
        const packagePath = path.join(resource.folder.proyect, filename );
        this.port = resource.spec?.port || this.port;
        resource.environment.PORT ||= this.port;
        
        // Creamos un package.json si no existe, o lo extendemos
        const json: {[x: string]: any} = {
            "name": resource.name,
            "version": resource.version,
            "main": "serverless-wrapper.js", // El punto de entrada será nuestro wrapper
            "dependencies": {
                // No necesitamos dependencias para el wrapper nativo
            }
        }
        
        if (fs.existsSync(packagePath)) {
            const text = fs.readFileSync(packagePath, 'utf-8');
            const local = JSON.parse(text);
            json.name = local.name || json.name;
            json.version = local.version || json.version;
            json.dependencies = { ...json.dependencies, ...local.dependencies };
        }
        
        fs.writeFileSync(path.join(resource.folder.deploy, filename), JSON.stringify(json, null, 2));

        // Creamos el wrapper que simula el entorno serverless
        const wrapperPath = path.join(__dirname, 'wrappers', 'node-serverless-native.js');
        let wrapperContent = fs.readFileSync(wrapperPath, 'utf-8');
        wrapperContent = wrapperContent.replace('{{FILENAME}}', fileName).replace('{{HANDLER_NAME}}', handlerName);
        fs.writeFileSync(path.join(resource.folder.deploy, 'serverless-wrapper.js'), wrapperContent);

        return true; 
    }
    
    dockerfileTemplate = `
FROM node:22-alpine
WORKDIR /app
COPY app/package*.json ./
RUN npm install --production
COPY app .
EXPOSE ${this.port}
CMD ["node", "serverless-wrapper.js"]
`
}
