import { DurableObject } from "cloudflare:workers";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade") !== "websocket") return new Response("WebSocket required",{status:426});
      const chatId=url.searchParams.get("chat")||crypto.randomUUID();
      return env.CHAT.get(env.CHAT.idFromName(chatId)).fetch(request);
    }
    if (url.pathname === "/health") return Response.json({ok:true});
    return env.ASSETS.fetch(request);
  }
};

export class ChatRoom extends DurableObject {
  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("WebSocket required",{status:426});
    const pair=new WebSocketPair(), [client,server]=Object.values(pair);
    this.ctx.acceptWebSocket(server);
    const chatId=new URL(request.url).searchParams.get("chat")||"";
    server.serializeAttachment({role:"visitor",chatId});
    return new Response(null,{status:101,webSocket:client});
  }
  webSocketMessage(ws,message) {
    let d; try{d=JSON.parse(message)}catch{return}
    if(d.type==="join"){ws.serializeAttachment({role:d.role==="owner"?"owner":"visitor",chatId:String(d.chatId||"")});return}
    if(d.type!=="message") return;
    const a=ws.deserializeAttachment()||{}, text=String(d.text||"").trim().slice(0,2000);
    if(!text)return;
    const out=JSON.stringify({type:"message",chatId:a.chatId,sender:a.role==="owner"?"owner":"visitor",text,time:new Date().toISOString()});
    for(const c of this.ctx.getWebSockets()){const x=c.deserializeAttachment()||{};if(x.chatId===a.chatId)try{c.send(out)}catch{}}
  }
}