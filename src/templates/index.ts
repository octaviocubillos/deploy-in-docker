import { Resource } from "../config";
import { handleError } from "../handlers";
import collection from "./collection";
import nginx from "./nginx"
import node22 from "./node22"


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
    process(params: Resource): boolean;
    dockerfileTemplate: string;
    port?: number;
    requireVolume?: boolean;
    volume?: string;
}

export default class {
    templates: {[x:string]: ITemplate} = {};

    constructor() {
        this.register(nginx);
        this.register(node22);
        this.register(collection);
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