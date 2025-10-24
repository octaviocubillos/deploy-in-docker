
import { OptionValues } from 'commander';
import * as fs from 'fs';
import * as yaml from 'js-yaml';


export class FileStack {
  options: OptionValues;

  stack: string;
  config: {[x: string]: any};

  constructor(globalOptions: OptionValues){
    try {
      console.log('getProfile', globalOptions)
      this.options = globalOptions;
      this.stack = fs.readFileSync(globalOptions.file, 'utf-8').trim();
      this.config = yaml.load(this.stack) as {[x: string]: any};
    } catch (error) {
      console.error(`Error al leer el archivo: ${globalOptions.file}`, error);
      process.exit(1); // Detén la ejecución si hay un error

    }

  }

  getProfile = () => {
    try {
      const profile = this.config.profile[this.options.profile];
      profile.protocol = profile.host? 'ssh' : 'local';
      return profile;
    } catch (error) {      
      console.error(`Error obtener profile: ${this.options.file}`, error);
      process.exit(1); // Detén la ejecución si hay un error
    }
  }

  getServices = ():{[x: string]: any} => {
    const services = this.config.services;

    return services;
  }
}