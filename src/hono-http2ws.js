//修改自 https://github.com/honojs/middleware/tree/main/packages/node-ws
//應對 hono.js 以及 http2
//主要修正問題:
//  訪問到不是為 WebSocket 設置的路徑時會中止連線。
//  進一步優化請求處理

const WebSocket = require('ws');
const HTTP = require('node:http');

class WebSocketEvents{
    constructor(events){
        if(!events) return;
        typeof events.onOpen === 'function' && (this.onOpen = events.onOpen);
        typeof events.onMessage === 'function' && (this.onMessage = events.onMessage);
        typeof events.onError === 'function' && (this.onError = events.onError);
        typeof events.onClose === 'function' && (this.onClose = events.onClose);
    }
}


let hostnameKey = Symbol('hostname');

class CloseEvent extends Event {
    #eventInitDict

    constructor(
        type,
        eventInitDict = {}
    ) {
        super(type, eventInitDict)
        this.#eventInitDict = eventInitDict
    }

    get wasClean() {
        return this.#eventInitDict.wasClean ?? false
    }

    get code() {
        return this.#eventInitDict.code ?? 0
    }

    get reason() {
        return this.#eventInitDict.reason ?? ''
    }
}

class SocketContext{
    constructor(ws, url ){
        Object.defineProperty(this, 'raw', { get: ()=>ws })
        Object.defineProperty(this, 'url', { get: ()=>new URL(url) })
    }

    get binaryType(){ return 'arraybuffer' }
    get protocol(){ return this.raw.protocol }
    get readyState(){ return this.raw.readyState }

    send(source, opts) {
        this.raw.send(source, {
            compress: opts?.compress,
        })
    }

    close(code, reason){ this.raw.close(code, reason) }

}

class NodeWebSocketServer{
    constructor(honoApp){
        this.honoApp = honoApp;
        this.wss = new WebSocket.Server({ noServer: true });
        this.injectWebSocket = this.injectWebSocket.bind(this);
        this.upgradeListener = this.upgradeListener.bind(this);
        this.upgradeWebSocket = this.upgradeWebSocket.bind(this);
    }

    injectWebSocket(server, hostname ){
        server[hostnameKey] = hostname;
        server.on('upgrade', this.upgradeListener );
    }

    async upgradeListener(incoming, socket, headRaw){
        try{
            const protocol = Boolean(socket?.ssl) ? 'https' : 'http';
            const server = socket?.server;
            const wss = this.wss;
            
            if(!server || ( server[hostnameKey] && server[hostnameKey] !== incoming?.headers?.host ) ){
                throw new Error(new Response(null,{
                    status: 400
                }));
            }
            const url = new URL(incoming.url ?? '/', app.baseUrl ?? `${protocol}://${server[hostnameKey]??'localhost'}` );
            
            const headers = new Headers();
            for (const key in incoming.headers){
                const value = incoming.headers[key];
                if(value) headers.append(key, Array.isArray(value) ? value[0] : value);
            }

            let res = app.request(
                url,
                { headers },
                { incoming, outgoing: undefined }
            )
            if( res instanceof Promise ){
                res = await new Promise(async (a,b)=>{ res.then(a).catch(b); })
            }
            if( res instanceof Response ){
                throw res;
            }
            if( !(res instanceof WebSocketEvents) ){
                throw new Response(null,{
                    status: 400
                })
            }

            const ws = await new Promise(function(a,b){
                try{wss.handleUpgrade(incoming, socket, headRaw, a)}catch(e){b(e)}
            });
            const ctx = new SocketContext(ws, url );
            res.onOpen?.(new Event('open'), ctx);
            ws.on('message', (srcData, isBinary) => {
                if(typeof res.onMessage !== 'function')return;
                for (const data of Array.isArray(srcData) ? srcData : [srcData] ){
                    res.onMessage(
                        new MessageEvent('message', { data: isBinary ? data : data.toString('utf-8') }),
                        ctx
                    )
                }
            });
            ws.on('close', () => {
                if(typeof res.onClose !== 'function')return;
                res.onClose(
                    new CloseEvent('close'),
                    ctx
                )
            });
            ws.on('error', (error) => {
                if(typeof res.onError !== 'function'){
                    console.error("Uncaptured error!");
                    console.error(error);
                    return;
                }
                res.onError(
                    new ErrorEvent('error', { error }),
                    ctx
                )
            });

        } catch(e){
            let errRes;
            if( e instanceof Response ){
                errRes = e;
                if(!HTTP.STATUS_CODES[e.status]){
                    console.error(new Error(`Code ${e.status} not exists in status codes table.`));
                    errRes = new Response(null,{
                        status: 500
                    })
                }
            } else {
                console.error(e);
                errRes = new Response(null,{
                    status: e instanceof Error && (e.name === "TimeoutError" || e.constructor.name === "TimeoutError") ? 504 : 500
                });
            }
            
            socket.write(`HTTP/1.1 ${errRes.status} ${HTTP.STATUS_CODES[e.status]}`);
            socket.destroy();
        }

    }

    upgradeWebSocket(createEvents){
        if( typeof createEvents !== 'function' ) throw new Error('createEvents must be function');
        return async function _createEvents(c, next ){
            if (c.req.header('upgrade') !== 'websocket') await next(); //TODO
            let events = new WebSocketEvents(await createEvents(c, next ));
            if (events.onMessage) return events;
        }
    }

}

module.exports = {
    createNodeWebSocket: function createNodeWebSocket(app){
        return new NodeWebSocketServer(app);
    }
}

