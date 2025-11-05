
import { OptionValues } from 'commander';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import * as _ from 'lodash';

import { handleError } from './handlers';
import { Profile } from './types';
import Template, { ITemplate } from './templates';
import path from 'path';

interface Spec {
  label: {[x: string]: string};
  port: number;
  hostname: string;
  networks: string[];
  restart: string;

  cpus: string;
  memory: string;

  "add-host": string[];

  cmd?: string;
}

export interface Resource {
    name: string;
    version?: string | number;
    handler: string;
    codeUri: string;
    path: string;
    template: string;
    templateObj: ITemplate;
    environment: {[x: string]: any};
    spec: Partial<Spec>;
    props: {[x: string]: string | {[x: string]: any}};
    description?: string;
    folder: {
      deploy: string;
      proyect: string;
      code: string;
    };
    imageName?: string;
}

export class FileStack {
  options: OptionValues;
  name: string = "stack";

  stack: string;
  config: {[x: string]: any};

  templates: Template;

  constructor(globalOptions: OptionValues){
    try {
      this.options = globalOptions;
      this.stack = fs.readFileSync(globalOptions.file, 'utf-8').trim();
      this.config = yaml.load(this.stack) as {[x: string]: any};
      this.name = this.config.name;
      this.templates = new Template()
    } catch (error) {
      handleError("No se encontró archivo de stack")
      process.exit(1); 
    }
  }

  getProfile = (): Profile => {
    try {
      const profile = this.config.profile[this.options.profile];
      profile.protocol = profile.host? 'ssh' : 'local';
      if(!profile.mode) {
        console.log("WWW, profile.mode no esta definido, se agrega docker por defecto")
        profile.mode = "docker";
      }
      return profile;
    } catch (error) {      
      handleError(`No se logro obtener el perfil: ${this.options.file}`);
      process.exit(1);
    }
  }

  getResources = (resourceOptions?: Resource['name'][]):Resource[] => {
    const resources = this.config.resources  as {[x: string]: Resource};
    if(!resources) {
      handleError(`No se logro obtener los recursos: ${this.options.file}`);
    }
    resourceOptions ||= Object.keys(resources);
    return Object.entries(resources).reduce((acc, [name, resource]) => {
      if(!resourceOptions?.includes(name)) {
        return acc;
      }
      resource = _.merge({}, this.getGlobal(), resource);
      resource.name = name;
      resource.templateObj = this.templates.getTemplete(resource.template);

      // TODO: Valider template
      // template.validate(service)

      resource.path ||= "";
      
      resource.folder = {
        deploy: path.join(process.cwd(),".deploy", name),
        proyect: path.join(process.cwd(), resource.path),
        code: path.join(process.cwd(), resource.path, resource.codeUri || "")
      }
      
      fs.mkdirSync(resource.folder.deploy, { recursive: true });
      resource.environment ||= {}
      resource.spec ||= {};
      acc.push(resource)
      return acc;
    }, [] as Resource[])

  }

  getGlobal = ():Partial<Resource> => {
    const global = this.config.global;
    return global;
  }
}