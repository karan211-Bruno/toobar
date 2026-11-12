declare module 'socket.io-client' {
  export interface Socket {
    id?: string;
    connected: boolean;
    on(event: string, listener: (...args: any[]) => void): this;
    once(event: string, listener: (...args: any[]) => void): this;
    off(event: string, listener?: (...args: any[]) => void): this;
    removeAllListeners(event?: string): this;
    emit(event: string, ...args: any[]): this;
    disconnect(): this;
    connect(): this;
  }
  export function io(uri?: string | Partial<Record<string, any>>, opts?: Record<string, any>): Socket;
}
