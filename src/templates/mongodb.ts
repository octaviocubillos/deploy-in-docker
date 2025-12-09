import { Resource } from "../config";
import * as crypto from 'crypto';

export default new class {
    name = 'mongodb';
    port = 27017;
    requireVolume = true;
    volume = "{volumeName}:/data/db";

    imageName = "mongo:latest"

    process = (resource: Resource) => {
        
        resource.environment.MONGO_INITDB_ROOT_USERNAME ||= "root",
        resource.environment.MONGO_INITDB_ROOT_PASSWORD ||= crypto.randomBytes(16).toString('hex');
        resource.props.imageName ||= this.imageName;
        
/*         const filename = "init-mongo.js";
        const props = resource.props; */
        // if(!props || !Array.isArray(props.keys) ) {
        //     return false;
        // }

/*         props.keys = props.keys as {[x: string]: {}}

        let script = `
db = db.getSiblingDB('${(props.mongo as any)?.database || resource.name}');
db.createUser({ 
    user: '${(props.mongo as any)?.username || props.name}', 
    pwd: '${(props.mongo as any)?.password || props.name}', 
    roles: [{role: 'readWrite', db: '${(props.mongo as any)?.database || props.name}'}]
});
${(props.keys || []).reduce((acc: string, key: {[x: string]: string}) => {
    return acc + `db.${props.name}.createIndex({${key.name}: ${key.index == "asc"? 1: -1}}, ${JSON.stringify(key.options || {})});\n`;
}, '')}
        `;
        
        fs.writeFileSync(path.join(resource.folder.deploy, filename), script); */

        return true;
    }
    dockerfileTemplate = `
FROM {imageName}
ENV MONGO_INITDB_ROOT_USERNAME=admin_root
ENV MONGO_INITDB_ROOT_PASSWORD=password_root_seguro

# COPY app/init-mongo.js /docker-entrypoint-initdb.d/init-mongo.js
`
};
