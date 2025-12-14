export interface ManageOptions {
    protocol: string;
    host: string;
    port: string;
    username: string;
    password: string;
}

export interface Manage {
    ps: Function
}
export interface Profile {
    host: string;
    mode: "docker";
    protocol: "ssh" | "local",
    mongodb?: {
        username: string;
        password?: string;
        host?: string;
        port?: number;
    };
    service?: {
      host: string;
      port: number;
      proxyHost?: string;
      proxyPort?: number;
      network?: string;
    }
    environment?: {[key: string]: any}; // Allow mixed types (string | object | number | boolean | null)
    resources?: {[resourceName: string]: { environment?: {[key: string]: string} }};
}