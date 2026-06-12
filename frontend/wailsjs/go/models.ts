export namespace main {
	
	export class ConnectionOptions {
	    sessionId: string;
	    host: string;
	    port: number;
	    username: string;
	    authMethod: string;
	    password: string;
	    privateKeyPath: string;
	    privateKeyPassphrase: string;
	
	    static createFrom(source: any = {}) {
	        return new ConnectionOptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.sessionId = source["sessionId"];
	        this.host = source["host"];
	        this.port = source["port"];
	        this.username = source["username"];
	        this.authMethod = source["authMethod"];
	        this.password = source["password"];
	        this.privateKeyPath = source["privateKeyPath"];
	        this.privateKeyPassphrase = source["privateKeyPassphrase"];
	    }
	}
	export class TerminalSettings {
	    backgroundColorHex: string;
	    backgroundOpacity: number;
	
	    static createFrom(source: any = {}) {
	        return new TerminalSettings(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.backgroundColorHex = source["backgroundColorHex"];
	        this.backgroundOpacity = source["backgroundOpacity"];
	    }
	}

}

