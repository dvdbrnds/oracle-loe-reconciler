declare global {
  namespace Express {
    interface User {
      id: number;
      email: string;
      name?: string;
      role: 'admin' | 'user';
      firstName?: string;
      lastName?: string;
    }
  }
}

export {};

