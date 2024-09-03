# hono-http2ws
寫爽的 (for fun)

原本是要拿去做自己的後台用的。這套件可以讓你的 Hono.js 應用在 Node.js 環境下支援 WebSocket。

修改自 https://github.com/honojs/middleware/tree/main/packages/node-ws


### 主要改善問題:
* WebSocket 連線的處理方法可以與一般 HTTP 請求處理方法共存了。(如果 upgradeWebSocket 是放在後面，前面仍需檢查是否請求升級)
* 不再允許客戶端 WebSocket 對不存在以及不是為 WebSocket 準備的路徑進行訪問。
* injectWebSocket 方法現在可以指定網域名稱了

### 使用範例:
```javascript
//前置作業
const Server = require('@hono/node-server');
const {Hono} = require('hono');
const { createNodeWebSocket } = require('.\\src\\hono-http2ws.js');

//建立 Hono 應用
let app = new Hono();
let { injectWebSocket, upgradeWebSocket } = createNodeWebSocket(app);

app.get('/',
    //發起 WebSocket 連線才會進入這裡
    //祥見: https://hono.dev/docs/helpers/websocket
    upgradeWebSocket(async function(conn, next ){
        return {
            onOpen(){
                console.log('ws open');
            },
            onMessage(event, ws){
                let sendData = 'ws received: ' + event.data.toString();
                console.log(sendData);
                ws.send(sendData);
            },
            onClose(){
                console.log('ws close');
            }
        }
    }),

    //其餘的請求會進來的地方
    function(c, next ){
        console.log('go normal test');
        return c.html(template({ message: "now: " + new Date() }));
    }
    
);

let server = Server.serve({
    fetch: app.fetch,
    port: 80
});

//將 Server 的 upgrade 事件轉給 http2ws 處理
//可以在第二個參數指定網域名稱 (選用)
injectWebSocket(server);
```
