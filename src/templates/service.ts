import path from "path";
import fs from 'fs';
import { Resource } from "../config";
import { DockerManage } from "../manages/docker";
import chalk from "chalk";

export default new class {
    name = "service";
    type: "task" | "service" = "task"; // We use 'task' to control the deployment flow manually
    port = 3000;

    process = async (resource: Resource) => {
        this.port = resource.spec?.port || this.port;
        resource.environment.PORT ||= this.port;
        resource.folder = {
            deploy: path.join(resource.folder.deploy),
            code: path.join(__dirname, 'service'),
            proyect: path.join(__dirname, 'service'),
        }
        const json: {[x: string]: any} = {
            "name": resource.name,
            "version": resource.version,
            "main": resource.handler,
            "description": resource.description || `Despliegue de ${resource.name}`,
            "dependencies": {
                "@octavio.cubillos/simple-logger-express": "^1.0.11",
                "express": "^5.1.0",
                "http-proxy-middleware": "^3.0.5",
                "sqlite": "^5.1.1",
                "sqlite3": "^5.1.7"
            }
        }

        fs.writeFileSync(path.join(resource.folder.deploy, 'package.json'), JSON.stringify(json, null, 2));
        
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
