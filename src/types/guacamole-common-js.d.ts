declare module "guacamole-common-js" {
  export interface GuacamoleStatus {
    code?: number
    message?: string
  }

  export interface MouseState {
    x: number
    y: number
    left: boolean
    middle: boolean
    right: boolean
    up: boolean
    down: boolean
  }

  export class WebSocketTunnel {
    constructor(url: string)
  }

  export class Display {
    getElement(): HTMLElement
    getDefaultLayer(): { width: number; height: number } | null
    onresize: ((width: number, height: number) => void) | null
  }

  export class Client {
    constructor(tunnel: WebSocketTunnel)
    onstatechange: ((state: number) => void) | null
    onerror: ((status: GuacamoleStatus) => void) | null
    connect(): void
    disconnect(): void
    sendMouseState(state: MouseState): void
    sendKeyEvent(pressed: number, keysym: number): void
    getDisplay(): Display
    static State: {
      IDLE: number
      CONNECTING: number
      WAITING: number
      CONNECTED: number
      DISCONNECTING: number
      DISCONNECTED: number
    }
  }

  export class Mouse {
    constructor(element: HTMLElement)
    onmousedown: ((state: MouseState) => void) | null
    onmouseup: ((state: MouseState) => void) | null
    onmousemove: ((state: MouseState) => void) | null
  }

  export class Keyboard {
    constructor(element: Document | HTMLElement)
    onkeydown: ((keysym: number) => void) | null
    onkeyup: ((keysym: number) => void) | null
  }

  const Guacamole: {
    Client: typeof Client
    WebSocketTunnel: typeof WebSocketTunnel
    Mouse: typeof Mouse
    Keyboard: typeof Keyboard
  }

  export default Guacamole
}
