import path from "path";
import fs from 'fs';
import { Resource } from "../config";

export default new class {
    name = "nginx";
    filename = "nginx.conf";

    process = (resource: Resource) => {
        const filename = "nginx.conf";
        const text = `
user nginx;
worker_processes auto;
events {
    worker_connections 1024;
}
http {
    include       mime.types;
    default_type  application/octet-stream;
    sendfile        on;
    keepalive_timeout  65;
    server {
        listen ${resource.spec?.port || 80};
        server_name  localhost;
        location / {
            root   /usr/share/nginx/html;
            index  ${resource.handler || 'index.html index.htm'};
        }
    }
}`;

        fs.writeFileSync(path.join(resource.folder.deploy, filename), text);
        // TODO: Validar ejecucion completa
        return true;
    };

    dockerfileTemplate = `
FROM nginx:alpine
RUN rm -rf /usr/share/nginx/html/*
COPY app /usr/share/nginx/html
COPY app/nginx.conf /etc/nginx/nginx.conf
CMD ["nginx", "-g", "daemon off;"]
`
}