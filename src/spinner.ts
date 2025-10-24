import ora, { Ora, Color } from "ora";

export default new class {
    spinner: undefined | Ora ;

    start = (msg?: string): void => {
        this.spinner = ora(msg? `${msg} ...`: undefined).start()
    }


    succeed = (msg: string): void => {
        if(!this.spinner)
            this.spinner = ora().start()
        this.spinner.succeed(msg);
    }

    fail = (msg: string): void => {
        if(!this.spinner)
            this.spinner = ora().start()
        this.spinner.fail(msg);
    }

    info = (msg: string): void => {
        if(!this.spinner)
            this.spinner = ora().start()
        this.spinner.info(msg);
    }

    change = (msg: string): void => {
        if(!this.spinner)
            this.spinner = ora().start()
        this.spinner.text = msg;

    }
}