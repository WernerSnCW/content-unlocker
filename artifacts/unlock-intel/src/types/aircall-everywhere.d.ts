declare module 'aircall-everywhere' {
  interface AircallPhoneOptions {
    domToLoadWorkspace?: string;
    onLogin?: (payload: {
      user: Record<string, any> & {
        user_id?: number;
        userId?: number;
        id?: number;
        user_email?: string;
        email?: string;
        user_name?: string;
        name?: string;
      };
      settings?: Record<string, any>;
    }) => void;
    onLogout?: () => void;
    integrationToLoad?: string;
    size?: 'big' | 'small' | 'auto';
    debug?: boolean;
  }

  export default class AircallPhone {
    constructor(options?: AircallPhoneOptions);
    send(
      event: string,
      data?: Record<string, any>,
      callback?: (success: boolean, data: any) => void
    ): void;
    send(
      event: string,
      callback?: (success: boolean, data: any) => void
    ): void;
    on(event: string, callback: (data: any) => void): void;
    removeListener(event: string): boolean;
    isLoggedIn(callback: (loggedIn: boolean) => void): void;
  }
}
