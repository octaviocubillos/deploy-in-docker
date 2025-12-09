import chalk from 'chalk';

const prefix = chalk.blue('[oton-pilot]');

export const logger = {
    info: (message: string) => {
        console.log(`${prefix} ${chalk.blue('ℹ️ ')} ${message}`);
    },
    success: (message: string) => {
        console.log(`${prefix} ${chalk.green('✅')} ${message}`);
    },
    warn: (message: string) => {
        console.log(`${prefix} ${chalk.yellow('⚠️ ')} ${message}`);
    },
    error: (message: string) => {
        console.error(`${prefix} ${chalk.red('❌')} ${message}`);
    },
    // Para mensajes sin icono
    raw: (message: string) => {
        console.log(message);
    }
};
