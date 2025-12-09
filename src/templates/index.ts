import { Resource } from "../config";
import { handleError } from "../handlers";
import collection from "./collection";
import mongodb from "./mongodb";
import nginx from "./nginx"
import node22 from "./node22"
import Docker from "dockerode";


export interface ProcessParams {
    name: string;
    version?: string|number;
    handle: string;
    folder: string;
    filename?: string;
    description?: string;
    port?: number;
    props?: {[x: string]: string | {[x: string]: string}[]}
    codeUri?: string;
}


export interface ITemplate {
    name: string;
    type?: 'service' | 'task';
    process(params: Resource, manager?: any): boolean | Promise<boolean>;
    dockerfileTemplate?: string;
    port?: number;
    requireVolume?: boolean;
    volume?: string;
    postProcess?(resource: Resource, manager?: any): Promise<void>;
}

export default class {
    templates: {[x:string]: ITemplate} = {};

    constructor() {
        this.register(nginx);
        this.register(node22);
        this.register(collection);
        this.register(mongodb)
    }

    register = (template: ITemplate): void => {
        this.templates[template.name] = template
    }

    listTemplates = (): ITemplate[] => {
        return Object.values(this.templates);
    }

    getTemplete = (name: string): ITemplate => {
        if(!this.templates[name]) {
            handleError(`Tempalte name: ${name} not found`);
        }
        return this.templates[name]
    }
}