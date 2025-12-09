import { FileStack, Resource } from "./config";

interface IDeployment {
    id: number;
    stackName: string;
    resources: Resource[];
    status: string;
    createdAt: string;
}

export default class Service {
    stack: FileStack;
    url: string;

    constructor(stack: FileStack) {
        this.stack = stack;
        const profile = stack.getProfile();
        this.url = `http://${profile.service?.host}:${profile.service?.port}`;
    }

    execute = async (method: string, path: string, body?: any) => {
        try {
            console.log(`${method} ${this.url}${path}`)
            const response = await fetch(`${this.url}${path}`, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(body),
            });
            return (await response.json());
        } catch (error) {
            console.error("Error executing request:", error);
            throw error;
        }
    }
    
    isServiceRunning = async () => {
        try {
            const response = await this.execute('GET', '/api/service/health');
            console.log({response})
            return response.success;
        } catch (error) {
            return false;
        }
    };

    getByStackName = async (stackName: string) => {
        try {
            const response = await this.execute('GET', `/api/deploy/${stackName}`);
            return response.data.at(0);
        } catch (error) {
            return null;
        }
    };

    getLast = async (stackName: string) => {
        try {
            const response = await this.execute('GET', `/api/deploy/${stackName}?last`);
            return response.data;
        } catch (error) {
            return null;
        }
    };

    create = async (stackName: string, deploymentDetails: any): Promise<IDeployment> => {
        try {
            const response = await this.execute('POST', `/api/deploy/${stackName}`, deploymentDetails);
            return response.data;
        } catch (error) {
            console.error("Error creating deployment:", error);
            throw error;
        }
    };

    update = async (deploymentDetails: any): Promise<IDeployment> => {
        try {
            const response = await this.execute('PUT', `/api/deploy/${deploymentDetails.stackName}/${deploymentDetails.id}`, deploymentDetails);
            return response.data;
        } catch (error) {
            console.error("Error updating deployment:", error);
            throw error;
        }
    };

    addProxy = async (subdomain: string, target: string): Promise<boolean> => {
        try {
            console.log(`Adding proxy for ${subdomain} -> ${target}`);
            const response = await this.execute('POST', `/api/proxy`, { subdomain, target: target + ":3000" });
            console.log({response})
            return response.success;
        } catch (error) {
            console.error("Error adding proxy:", error);
            return false;
        }
    };

    addOrUpdateProxy = async (subdomain: string, target: string): Promise<boolean> => {
        try {
            console.log(`Adding proxy for ${subdomain} -> ${target}`);
            const response = await this.execute('POST', `/api/proxy`, { subdomain, target: target + ":3000" });
            console.log({response})
            return response.success;
        } catch (error) {
            console.error("Error adding proxy:", error);
            return false;
        }
    };

}
