
import { OptionValues } from 'commander';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import * as _ from 'lodash';

import { handleError } from './handlers';
import { Profile } from './types';
import Template, { ITemplate } from './templates';
import path from 'path';

import { getConfig, readConfigs } from './user-config';
import Service from './service';

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
    fullName: string;
    version?: string | number;
    proxy?: boolean;
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
    stack?: string;
    status?: string;
    updateStatus: (status: string, log?: string, extraData?: object) => Promise<void>;
    extra: {[x: string]: string};
    preDeploy?: string;
}

export class FileStack {
  options!: OptionValues;
  name: string = "stack";

  stack!: string;
  config!: {[x: string]: any};

  templates!: Template;

  service!: Service;
  projectPath!: string;
  profile!: Profile;

  constructor(globalOptions: OptionValues){
    this.options = globalOptions;
    console.log('obteniendo stack...');
    try {
      this.stack = fs.readFileSync(globalOptions.file, 'utf-8').trim();
      this.projectPath = path.dirname(path.resolve(globalOptions.file));
      this.config = yaml.load(this.stack) as {[x: string]: any};

      // Load external profile.yaml if exists and merge
      const stackDir = path.dirname(path.resolve(globalOptions.file));
      const profilePath = path.join(stackDir, 'profile.yaml');
      if (fs.existsSync(profilePath)) {
          try {
            const profileContent = fs.readFileSync(profilePath, 'utf-8');
            const externalProfile = yaml.load(profileContent) as any;
            this.config.profile = _.merge(this.config.profile || {}, externalProfile);
          } catch (e) {
            console.warn("Could not load profile.yaml:", e);
          }
      }

      this.config.profile = _.merge({}, readConfigs(), this.config.profile)
      this.name = this.config.name;
      this.templates = new Template()
    } catch (error) {
      handleError("No se encontró archivo de stack");
      throw new Error("Failed to initialize FileStack"); // Re-throw after handleError
    }
  }

  getProfile = (): Profile => {
    
    const profileName = this.options.profile;

    if(this.profile) {
      return this.profile;
    }
    const profile = this.config.profile[profileName];
    profile.name = profileName;
    if (!profile) {
      handleError(`Perfil no encontrado: ${profileName}`);
    }

    profile.protocol = profile.host? 'ssh' : 'local';
    if(!profile.mode) {
      console.log("profile.mode no esta definido, se agrega docker por defecto")
      profile.mode = "docker";
    }
    profile.service = {
      host: profile.host || "service.localhost",
      port: profile.service?.port || 3000,
      proxyHost: profile.service?.proxyHost || profile.host,
      proxyPort: profile.service?.port || 3000,
    }
    this.profile = profile;
    return profile;
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
      
      const profile = this.getProfile();
      
      resource.fullName ||= `${name}-${this.name}`;
      resource.version ||= "1";
      if(resource.proxy == undefined) {
        resource.proxy = true;
      }


      // Process mixed environment block
      if (profile.environment) {
        const globalEnv: {[key: string]: string} = {};
        const resourceEnv: {[key: string]: any} = {};

        for (const [key, value] of Object.entries(profile.environment)) {
            if (typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date)) {
                // It's a Resource Configuration
                resourceEnv[key] = value;
            } else {
                // It's a Global Environment Variable
                let envValue = "";
                if (value === null) {
                    envValue = "";
                } else if (Array.isArray(value)) {
                    envValue = JSON.stringify(value);
                } else if (value instanceof Date) {
                    envValue = value.toISOString();
                } else {
                    envValue = String(value);
                }
                globalEnv[key] = envValue;
            }
        }

        // 1. Merge global profile environment
        resource.environment = _.merge({}, resource.environment, globalEnv);

        // 2. Merge resource-specific profile environment (from mixed block)
        if (resourceEnv[name]) {
             // User confirmed: If it's an object matching the resource name, 
             // it must be merged into the resource's ENVIRONMENT.
             resource.environment = _.merge({}, resource.environment, resourceEnv[name]);
        }
      }

      // 3. Merge legacy resource-specific profile environment (if we still support the old structure)
      if (profile.resources && profile.resources[name]) {
         // This might overlap, but let's keep it for safety if defined
         resource = _.merge(resource, profile.resources[name]);
      }

      resource.name = name;
      resource.templateObj = this.templates.getTemplete(resource.template);

      // TODO: Valider template
      // template.validate(service)

      resource.path ||= "";
      
      resource.folder = {
        deploy: path.join(this.projectPath,".deploy", name),
        proyect: path.join(this.projectPath, resource.path),
        code: path.join(this.projectPath, resource.path, resource.codeUri || "")
      }
      resource.props ||= {};
      
      fs.mkdirSync(resource.folder.deploy, { recursive: true });
      resource.environment ||= {}
      resource.spec ||= {};
      resource.updateStatus ||= async (status: string, log?: string, extraData?: object) => {};
      resource.extra ||= {};
      acc.push(resource)
      return acc;
    }, [] as Resource[])

  }

  getGlobal = ():Partial<Resource> => {
    const global = this.config.global;
    return global;
  }

  getService = ():Service => {
    this.service = new Service(this);
    return this.service; 
  }
}