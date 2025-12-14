import path from "path";
import fs from 'fs';
import { Resource } from "../config";

export default new class {
    name = "php82";
    port = 80;

    process = (resource: Resource) => {
        // PHP usually doesn't need a specific build file like package.json or requirements.txt 
        // strictly for basic setup, but we might check for composer.json later.
        // For now, we just ensure the deploy folder exists and set the port.
        
        // this.port = resource.spec?.port || this.port;
        resource.environment.PORT ||= this.port;
        
        // If composer.json exists, we might want to copy it separately if we were doing a multi-stage build with composer install
        // For this basic template, we'll assume source copy is enough or handled by codeUri
        
        return true; 
    }
    dockerfileTemplate = `
FROM php:8.2-apache
WORKDIR /var/www/html

# Enable rewrite module if needed
RUN a2enmod rewrite

# Copy application source
COPY app .

# If PORT is customizable, Apache needs configuration adjustment, but default is 80
# For simplicity in this template, we assume port 80 or mapping.
# If custom port is strictly required inside container:
# RUN sed -i 's/80/${this.port}/g' /etc/apache2/sites-available/000-default.conf /etc/apache2/ports.conf

EXPOSE ${this.port}
`
}
