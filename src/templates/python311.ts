import path from "path";
import fs from 'fs';
import { Resource } from "../config";

export default new class {
    name = "python311";
    port = 80;

    process = async (resource: Resource) => {
        const [fileName, handlerName] = resource.handler.split('.');
        if (!fileName || !handlerName) {
            throw new Error("El handler debe tener el formato 'archivo.funcion' (ej: main.handler)");
        }
        
        // 2. Ensure requirements.txt has Flask
        const reqFilename = 'requirements.txt';
        const reqPath = path.join(resource.folder.deploy, reqFilename); // Check in deploy folder (already copied)
        let requirements = "";
        
        if (fs.existsSync(reqPath)) {
            requirements = fs.readFileSync(reqPath, 'utf-8');
        }
        
        if (!requirements.includes('Flask')) {
            requirements += "\nFlask==3.0.0\n";
            fs.writeFileSync(reqPath, requirements);
        }
        
        this.port = resource.spec?.port || this.port;
        resource.environment.PORT ||= this.port;

        // 3. Create the Python Wrapper
        const wrapperPath = path.join(__dirname, 'wrappers', 'python-serverless.py');
        let wrapperContent = fs.readFileSync(wrapperPath, 'utf-8');
        wrapperContent = wrapperContent.replace('{{FILENAME}}', fileName).replace('{{HANDLER_NAME}}', handlerName);

        fs.writeFileSync(path.join(resource.folder.deploy, 'serverless_wrapper.py'), wrapperContent);
        
        return true;
    }

    dockerfileTemplate = `
FROM python:3.11-slim
WORKDIR /app
COPY app/requirements.txt ./
RUN pip install --no-cache-dir Flask==3.0.0
RUN pip install --no-cache-dir -r requirements.txt
COPY app .
EXPOSE ${this.port}
CMD ["python", "serverless_wrapper.py"]
`
}
