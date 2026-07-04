export namespace main {
	
	export class AICommandRequest {
	    provider: string;
	    apiKey: string;
	    endpoint: string;
	    model: string;
	    prompt: string;
	
	    static createFrom(source: any = {}) {
	        return new AICommandRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.provider = source["provider"];
	        this.apiKey = source["apiKey"];
	        this.endpoint = source["endpoint"];
	        this.model = source["model"];
	        this.prompt = source["prompt"];
	    }
	}
	export class AICommandSuggestion {
	    command: string;
	    description: string;
	    category: string;
	
	    static createFrom(source: any = {}) {
	        return new AICommandSuggestion(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.command = source["command"];
	        this.description = source["description"];
	        this.category = source["category"];
	    }
	}
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

