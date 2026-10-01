declare module 'bcryptjs' {
  const bcrypt: {
    hash(value: string, saltRounds: number): Promise<string>;
    compare(value: string, hash: string): Promise<boolean>;
  };

  export default bcrypt;
}