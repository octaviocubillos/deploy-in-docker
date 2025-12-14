import path from "path";
import fs from 'fs';
import { Resource } from "../config";

export default new class {
    name = "node22";
    port = 3000;

    process = (resource: Resource) => {
        const filename = 'package.json';
        const packagePath = path.join(resource.folder.proyect, filename );
        this.port = resource.spec?.port || this.port;
        resource.environment.PORT ||= this.port;
        const json: {[x: string]: any} = {
            "name": resource.name,
            "version": resource.version,
            "main": resource.handler,
            "dependencies": {}
        }
        if (fs.existsSync(packagePath)) {
            const text = fs.readFileSync(packagePath, 'utf-8');
            const local = JSON.parse(text);
            json.name = local.name || json.name;
            json.version = local.version || json.version;
            json.dependencies = local.dependencies || json.dependencies;

        }
        json.description ||= resource.description || `Despliegue de ${resource.name}`
        
        fs.writeFileSync(path.join(resource.folder.deploy, filename), JSON.stringify(json, null, 2));
        // TODO: Validar ejecucion completa
        return true; 
    }
    dockerfileTemplate = `
FROM node:22-alpine AS builder
WORKDIR /app
COPY app/package*.json ./
RUN npm install --only=production && npm cache clean --force
COPY app .

FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app .
EXPOSE ${this.port}
CMD ["node", "{handler}"]
`
}