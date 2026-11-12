declare module 'socket.io' {
  export interface Socket {
    id: string;
    handshake: any;
    on(event: string, listener: (...args: any[]) => void): this;
    emit(event: string, ...args: any[]): boolean;
    join(room: string): void | Promise<void>;
    leave(room: string): void | Promise<void>;
    to(room: string): { emit(event: string, ...args: any[]): boolean };
    disconnect(close?: boolean): this;
  }

  export class Server {
    sockets: { sockets: Map<string, Socket> };
    constructor(srv?: any, opts?: Record<string, any>);
    on(event: string, listener: (socket: Socket) => void): this;
    to(room: string): { emit(event: string, ...args: any[]): boolean };
    emit(event: string, ...args: any[]): boolean;
    close(fn?: (err?: Error) => void): void;
  }
}
