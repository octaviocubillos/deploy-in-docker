import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';

const CONFIG_DIR = path.join(os.homedir(), '.config', 'oton-pilot');
const CREDENTIALS_FILE = path.join(CONFIG_DIR, 'config.yaml');

// Asegura que el directorio de configuración exista
function ensureConfigDirExists() {
    if (!fs.existsSync(CONFIG_DIR)) {
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
}

interface Configs {
    [x: string]: Config;
}

interface Config {
    name?: string
    mode: string;
    stage: string;
    host?: string;
    username?: string;
    password?: string;
    privateKeyPath?: string;
    database?: {
        username?: string;
        password?: string;
        port?: number;
    };
}

export function saveLocalConfig(config: Config): void {
    const configs: Configs = readConfigs();
    const name = config.name!;
    delete config.name;
    configs[name] = config;
    fs.writeFileSync(CREDENTIALS_FILE, yaml.dump(configs));
}

export function readConfigs(): Configs {
    ensureConfigDirExists();
    if (!fs.existsSync(CREDENTIALS_FILE)) {
        return {};
    }
    try {
        const content = fs.readFileSync(CREDENTIALS_FILE, 'utf-8');
        return (yaml.load(content) as Configs) || {};
    } catch (error) {
        // Si el archivo está corrupto, lo tratamos como si no existiera
        return {};
    }
}

export function getConfig(profile: string) {
    const configs: Configs = readConfigs();
    return configs[profile];
}
