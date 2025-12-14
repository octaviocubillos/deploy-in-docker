import path from "path";
import fs from 'fs';
import { Resource } from "../config";

export default new class {
    name = "python311-serverless-node";
    port = 80;

    process = async (resource: Resource, manager: any) => {
        // 1. Copy source code
        if (resource.codeUri && manager && manager.copyDirectoryRecursive) {
            manager.copyDirectoryRecursive(resource.folder.code, resource.folder.deploy);
            resource.codeUri = ""; 
        }

        const [fileName, handlerName] = resource.handler.split('.');
        if (!fileName || !handlerName) {
            throw new Error("El handler debe tener el formato 'archivo.funcion' (ej: main.handler)");
        }
        
        this.port = resource.spec?.port || this.port;
        resource.environment.PORT ||= this.port;

        // 2. Prepare Node.js environment (package.json)
        const packageJson = {
            "name": "python-wrapper",
            "version": "1.0.0",
            "main": "server.js",
            "dependencies": {
                "express": "^4.18.2",
                "body-parser": "^1.20.2"
            }
        };
        fs.writeFileSync(path.join(resource.folder.deploy, 'package.json'), JSON.stringify(packageJson, null, 2));

        // 3. Create the Python Bridge (files receiving payload from Node and executing handler)
        const wrapperPath = path.join(__dirname, 'wrappers');
        const bridgePath = path.join(wrapperPath, 'python-node-bridge.py');
        const serverPath = path.join(wrapperPath, 'python-node-server.js');
        
        let bridgeContent = fs.readFileSync(bridgePath, 'utf-8');
        bridgeContent = bridgeContent.replace('{{FILENAME}}', fileName).replace('{{HANDLER_NAME}}', handlerName);
        fs.writeFileSync(path.join(resource.folder.deploy, 'bridge.py'), bridgeContent);

        // 4. Create Node.js Server Wrapper
        const serverContent = fs.readFileSync(serverPath, 'utf-8');
        fs.writeFileSync(path.join(resource.folder.deploy, 'server.js'), serverContent);

        return true;
    }

    dockerfileTemplate = `
FROM node:22-slim

# Install Python3 and pip
RUN apt-get update && apt-get install -y python3 python3-pip && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy all application files
COPY app .

# Install Node dependencies
RUN npm install --production

# Install Python requirements if they exist
# Note: On Debian/Ubuntu recent versions, pip might complain about system packages.
# We use --break-system-packages or virtualenv. For simplicity/container:
RUN if [ -f requirements.txt ]; then pip3 install --no-cache-dir --break-system-packages -r requirements.txt; fi

EXPOSE ${this.port}
CMD ["node", "server.js"]
`
}
