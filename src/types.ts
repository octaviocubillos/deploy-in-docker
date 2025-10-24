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