import path from "path";
import fs from 'fs';
import { Resource } from "../config";

export default new class {
    name = "python3.11";
    port = 8000;

    process = (resource: Resource) => {
        const filename = 'requirements.txt';
        const requirementsPath = path.join(resource.folder.proyect, filename );
        this.port = resource.spec?.port || this.port;
        resource.environment.PORT ||= this.port;
        
        let content = "";
        if (fs.existsSync(requirementsPath)) {
            content = fs.readFileSync(requirementsPath, 'utf-8');
        }
        
        fs.writeFileSync(path.join(resource.folder.deploy, filename), content);
        return true; 
    }
    dockerfileTemplate = `
FROM python:3.11-alpine
WORKDIR /app
COPY app/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY app .
EXPOSE ${this.port}
CMD ["python", "{handler}"]
`
}
